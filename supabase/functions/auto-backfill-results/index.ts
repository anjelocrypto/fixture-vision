/**
 * AUTO-BACKFILL-RESULTS: Self-healing cron job to automatically backfill missing fixture results
 * 
 * RUNS: Every 5 minutes via cron (drain mode) / every 30 minutes (steady state)
 * PURPOSE: Find fixtures that kicked off >3h ago but are missing from fixture_results, and fetch their results
 * CHAINS: Automatically triggers score-ticket-legs after inserting results
 * 
 * This function uses the new get_fixtures_missing_results RPC to find gaps and fills them automatically.
 * Zero manual intervention required.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { fetchAPIFootball, fetchFixtureStatistics as fetchStats, getRateLimiterStats } from "../_shared/api_football.ts";

const SUPPORTED_LEAGUES = [39, 40, 78, 140, 135, 61, 2, 3, 848, 45, 48, 66, 81, 137, 143];
const DEFAULT_BATCH_SIZE = 50; // Process 50 fixtures per run (drain mode)
const WATCHDOG_CONSECUTIVE_ZERO_THRESHOLD = 3;
const DEFAULT_LOOKBACK_DAYS = 30; // Look back 30 days (matches get_pending_ticket_fixture_ids)

interface FixtureResultRow {
  fixture_id: number;
  league_id: number;
  kickoff_at: string;
  finished_at: string;
  goals_home: number;
  goals_away: number;
  corners_home?: number;
  corners_away?: number;
  cards_home?: number;
  cards_away?: number;
  fouls_home?: number;
  fouls_away?: number;
  offsides_home?: number;
  offsides_away?: number;
  status: string;
  source: string;
  fetched_at: string;
}

// Fetch fixture by ID
async function fetchFixtureById(fixtureId: number): Promise<any | null> {
  const result = await fetchAPIFootball(`/fixtures?id=${fixtureId}`, { logPrefix: "[auto-backfill]" });
  return result.ok && result.data?.length ? result.data[0] : null;
}

// Fetch detailed statistics for a fixture
async function fetchFixtureStatistics(fixtureId: number): Promise<any> {
  const stats = await fetchStats(fixtureId);
  return stats.length > 0 ? stats : null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  
  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const startTime = Date.now();
  console.log("[auto-backfill] ===== FUNCTION START =====");

  // Parse request body for optional overrides
  let requestBody: { batch_size?: number; lookback_days?: number } = {};
  try {
    if (req.body) {
      requestBody = await req.json();
    }
  } catch {
    // No body or invalid JSON - use defaults
  }

  // Use request params or defaults
  const BATCH_SIZE = requestBody.batch_size ?? DEFAULT_BATCH_SIZE;
  const LOOKBACK_DAYS = requestBody.lookback_days ?? DEFAULT_LOOKBACK_DAYS;

  console.log(`[auto-backfill] Using batch_size=${BATCH_SIZE}, lookback_days=${LOOKBACK_DAYS}`);

  // Track for logging
  let pipelineLogId: number | null = null;
  let processed = 0;
  let inserted = 0;
  let failed = 0;
  const leaguesCovered: number[] = [];

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[auto-backfill] Missing environment variables");
      return errorResponse("Missing configuration", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Auth check - normalize header names (case-insensitive)
    const cronKeyHeader = req.headers.get("x-cron-key") ?? req.headers.get("X-CRON-KEY");
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    let isAuthorized = false;

    // Method 1: Direct service role key in Authorization header
    if (authHeader === `Bearer ${serviceRoleKey}`) {
      isAuthorized = true;
      console.log("[auto-backfill] Authorized via service role bearer");
    }

    // Method 2: X-CRON-KEY header matching app_settings value
    if (!isAuthorized && cronKeyHeader) {
      // Don't use .single() on scalar RPC - just await the response directly
      const { data: dbKey, error: keyError } = await supabase.rpc("get_cron_internal_key");
      
      if (keyError) {
        console.error("[auto-backfill] get_cron_internal_key error:", keyError);
        // Don't fail auth entirely, just log and continue to other methods
      } else {
        // Ensure both are strings and trimmed for safe comparison
        const expectedKey = String(dbKey || "").trim();
        const providedKey = String(cronKeyHeader || "").trim();
        
        console.log("[auto-backfill] providedKey:", providedKey ? providedKey.slice(0, 8) + "..." : "null");
        console.log("[auto-backfill] expectedKey:", expectedKey ? expectedKey.slice(0, 8) + "..." : "null");
        
        if (providedKey && expectedKey && providedKey === expectedKey) {
          isAuthorized = true;
          console.log("[auto-backfill] Authorized via X-CRON-KEY");
        }
      }
    }

    // Method 3: Admin user via JWT
    if (!isAuthorized && authHeader) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (anonKey) {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } }
        });
        const { data: isWhitelisted } = await userClient.rpc("is_user_whitelisted");
        if (isWhitelisted) {
          isAuthorized = true;
          console.log("[auto-backfill] Authorized via user whitelist");
        }
      }
    }

    if (!isAuthorized) {
      console.error("[auto-backfill] Authorization failed - no valid auth method matched");
      return errorResponse("Unauthorized", origin, 401, req);
    }

    // Insert initial pipeline log entry
    const { data: logData } = await supabase
      .from("pipeline_run_logs")
      .insert({
        job_name: "auto-backfill-results",
        run_started: new Date().toISOString(),
        success: false,
        mode: "auto",
        processed: 0,
        failed: 0,
        leagues_covered: [],
        details: { status: "started" },
      })
      .select("id")
      .single();
    
    pipelineLogId = logData?.id || null;

    // PASS 1: Standard RPC - find missing fixtures from SUPPORTED_LEAGUES
    console.log(`[auto-backfill] PASS 1: Calling get_fixtures_missing_results(lookback_days=${LOOKBACK_DAYS}, batch_limit=${BATCH_SIZE})`);
    
    const { data: missingFixtures, error: rpcError } = await supabase.rpc("get_fixtures_missing_results", {
      lookback_days: LOOKBACK_DAYS,
      supported_leagues: SUPPORTED_LEAGUES,
      batch_limit: BATCH_SIZE,
    });

    if (rpcError) {
      console.error("[auto-backfill] RPC error:", rpcError);
      await finalizePipelineLog(supabase, pipelineLogId, false, 0, 0, [], { error: rpcError.message }, rpcError.message);
      return errorResponse(`RPC error: ${rpcError.message}`, origin, 500, req);
    }

    // PASS 2: Targeted backfill - find fixtures referenced by PENDING ticket legs
    // that are missing from fixture_results (regardless of league)
    const remainingSlots = Math.max(0, BATCH_SIZE - (missingFixtures?.length || 0));
    let ticketMissingFixtures: Array<{ fixture_id: number; kickoff_at: string; league_id: number }> = [];
    
    if (remainingSlots > 0) {
      console.log(`[auto-backfill] PASS 2: Calling get_pending_ticket_fixture_ids(${remainingSlots})`);
      const { data: ticketFixtures, error: ticketRpcError } = await supabase.rpc("get_pending_ticket_fixture_ids", {
        batch_limit: remainingSlots,
      });
      
      if (ticketRpcError) {
        console.warn("[auto-backfill] get_pending_ticket_fixture_ids error (non-fatal):", ticketRpcError.message);
      } else if (ticketFixtures && ticketFixtures.length > 0) {
        // Deduplicate against pass 1 results
        const pass1Ids = new Set((missingFixtures || []).map((f: any) => f.fixture_id));
        ticketMissingFixtures = ticketFixtures.filter((f: any) => !pass1Ids.has(f.fixture_id));
        console.log(`[auto-backfill] PASS 2: Found ${ticketFixtures.length} ticket-referenced missing fixtures, ${ticketMissingFixtures.length} new after dedup`);
      }
    }

    // Merge both passes into a unified list
    const allMissing = [
      ...(missingFixtures || []).map((f: any) => ({
        fixture_id: f.fixture_id,
        fixture_league_id: f.fixture_league_id,
        fixture_timestamp: f.fixture_timestamp,
        fixture_status: f.fixture_status,
        source: "pass1_supported_leagues" as const,
      })),
      ...ticketMissingFixtures.map((f: any) => ({
        fixture_id: f.fixture_id,
        fixture_league_id: f.league_id,
        fixture_timestamp: f.kickoff_at ? Math.floor(new Date(f.kickoff_at).getTime() / 1000) : null,
        fixture_status: null as string | null,
        source: "pass2_ticket_legs" as const,
      })),
    ];

    if (allMissing.length === 0) {
      console.log("[auto-backfill] No missing fixtures found - all results up to date!");
      await finalizePipelineLog(supabase, pipelineLogId, true, 0, 0, [], { message: "No missing fixtures" });
      return jsonResponse({ 
        success: true, 
        missing_count: 0, 
        processed: 0, 
        inserted: 0, 
        message: "All results up to date",
        pass1_count: missingFixtures?.length || 0,
        pass2_count: ticketMissingFixtures.length,
      }, origin, 200, req);
    }

    console.log(`[auto-backfill] Total missing: ${allMissing.length} (pass1=${missingFixtures?.length || 0}, pass2=${ticketMissingFixtures.length})`);

    // Track leagues
    const leagueSet = new Set<number>();
    for (const f of allMissing) {
      if (f.fixture_league_id) leagueSet.add(f.fixture_league_id);
    }
    leaguesCovered.push(...leagueSet);
    console.log(`[auto-backfill] Leagues affected: ${leaguesCovered.join(", ")}`);

    // Process each fixture
    const results: FixtureResultRow[] = [];
    const errors: { fixture_id: number; error: string }[] = [];
    const statusUpdates: { id: number; status: string }[] = [];

    for (const fixture of allMissing) {
      processed++;
      console.log(`[auto-backfill] Processing ${processed}/${allMissing.length}: fixture ${fixture.fixture_id} (league ${fixture.fixture_league_id}, source=${fixture.source})`);

      try {
        const apiFixture = await fetchFixtureById(fixture.fixture_id);
        
        if (!apiFixture || !apiFixture.teams) {
          errors.push({ fixture_id: fixture.fixture_id, error: "No data from API" });
          failed++;
          continue;
        }

        const apiStatus = apiFixture.fixture?.status?.short || "NS";
        const isFinished = ["FT", "AET", "PEN", "AWD", "WO"].includes(apiStatus);
        
        // Skip postponed, cancelled, or abandoned matches - these are expected, not failures
        const isSkippable = ["PST", "CANC", "ABD", "TBD", "SUSP", "INT"].includes(apiStatus);
        
        // Update fixture status if different (important for PST matches so DB reflects reality)
        if (fixture.fixture_status !== apiStatus) {
          statusUpdates.push({ id: fixture.fixture_id, status: apiStatus });
        }

        if (isSkippable) {
          // Log as info, not error - these are expected scenarios
          console.log(`[auto-backfill] Fixture ${fixture.fixture_id}: Skipping (${apiStatus}) - ${apiStatus === 'PST' ? 'Postponed' : apiStatus === 'CANC' ? 'Cancelled' : 'Not playable'}`);
          continue; // Don't count as failure, just skip
        }

        if (!isFinished) {
          errors.push({ fixture_id: fixture.fixture_id, error: `Status ${apiStatus} not finished` });
          failed++;
          continue;
        }

        const goalsHome = apiFixture.goals?.home ?? apiFixture.score?.fulltime?.home ?? 0;
        const goalsAway = apiFixture.goals?.away ?? apiFixture.score?.fulltime?.away ?? 0;

        // Fetch statistics
        let cornersHome: number | null = null, cornersAway: number | null = null;
        let cardsHome: number | null = null, cardsAway: number | null = null;
        let foulsHome: number | null = null, foulsAway: number | null = null;
        let offsidesHome: number | null = null, offsidesAway: number | null = null;

        const statsData = await fetchFixtureStatistics(fixture.fixture_id);
        
        if (statsData && Array.isArray(statsData) && statsData.length === 2) {
          const homeStats = statsData.find((s: any) => s.team?.id === apiFixture.teams?.home?.id);
          const awayStats = statsData.find((s: any) => s.team?.id === apiFixture.teams?.away?.id);
          
          if (homeStats?.statistics) {
            cornersHome = homeStats.statistics.find((st: any) => st.type === "Corner Kicks" || st.type === "Corners")?.value ?? null;
            const yellowCards = homeStats.statistics.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
            const redCards = homeStats.statistics.find((st: any) => st.type === "Red Cards")?.value ?? 0;
            cardsHome = (yellowCards || 0) + (redCards || 0);
            foulsHome = homeStats.statistics.find((st: any) => st.type === "Fouls")?.value ?? null;
            offsidesHome = homeStats.statistics.find((st: any) => st.type === "Offsides")?.value ?? null;
          }
          
          if (awayStats?.statistics) {
            cornersAway = awayStats.statistics.find((st: any) => st.type === "Corner Kicks" || st.type === "Corners")?.value ?? null;
            const yellowCards = awayStats.statistics.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
            const redCards = awayStats.statistics.find((st: any) => st.type === "Red Cards")?.value ?? 0;
            cardsAway = (yellowCards || 0) + (redCards || 0);
            foulsAway = awayStats.statistics.find((st: any) => st.type === "Fouls")?.value ?? null;
            offsidesAway = awayStats.statistics.find((st: any) => st.type === "Offsides")?.value ?? null;
          }
        }

        results.push({
          fixture_id: fixture.fixture_id,
          league_id: fixture.fixture_league_id,
          kickoff_at: new Date(fixture.fixture_timestamp * 1000).toISOString(),
          finished_at: new Date().toISOString(),
          goals_home: goalsHome,
          goals_away: goalsAway,
          corners_home: cornersHome ?? undefined,
          corners_away: cornersAway ?? undefined,
          cards_home: cardsHome ?? undefined,
          cards_away: cardsAway ?? undefined,
          fouls_home: foulsHome ?? undefined,
          fouls_away: foulsAway ?? undefined,
          offsides_home: offsidesHome ?? undefined,
          offsides_away: offsidesAway ?? undefined,
          status: apiStatus,
          source: "api-football",
          fetched_at: new Date().toISOString(),
        });

        console.log(`[auto-backfill] Fixture ${fixture.fixture_id}: ${goalsHome}-${goalsAway} ✓`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[auto-backfill] Fixture ${fixture.fixture_id}: ${errMsg}`);
        errors.push({ fixture_id: fixture.fixture_id, error: errMsg });
        failed++;
      }

      // Small delay
      await new Promise(r => setTimeout(r, 50));
    }

    // Deduplicate results by fixture_id (keep last occurrence)
    const deduped = new Map<number, FixtureResultRow>();
    for (const r of results) {
      deduped.set(r.fixture_id, r);
    }
    const uniqueResults = Array.from(deduped.values());

    // Batch upsert results
    if (uniqueResults.length > 0) {
      console.log(`[auto-backfill] Upserting ${uniqueResults.length} results (${results.length - uniqueResults.length} duplicates removed)`);
      const { error: upsertError } = await supabase
        .from("fixture_results")
        .upsert(uniqueResults, { onConflict: "fixture_id" });

      if (upsertError) {
        console.error("[auto-backfill] Upsert error:", upsertError);
        await finalizePipelineLog(supabase, pipelineLogId, false, processed, failed, leaguesCovered, { upsert_error: upsertError.message }, upsertError.message);
        return errorResponse(`Upsert failed: ${upsertError.message}`, origin, 500, req);
      }

      inserted = uniqueResults.length;
      console.log(`[auto-backfill] Successfully upserted ${inserted} results`);
    }

    // Update fixture statuses
    let statusUpdateCount = 0;
    if (statusUpdates.length > 0) {
      console.log(`[auto-backfill] Updating ${statusUpdates.length} fixture statuses`);
      for (const update of statusUpdates) {
        const { error } = await supabase
          .from("fixtures")
          .update({ status: update.status })
          .eq("id", update.id);
        if (!error) statusUpdateCount++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[auto-backfill] COMPLETE: ${inserted} inserted, ${failed} failed, ${statusUpdateCount} status updates, ${duration}ms`);

    // Finalize pipeline log
    await finalizePipelineLog(supabase, pipelineLogId, true, processed, failed, leaguesCovered, {
      missing_found: allMissing.length,
      pass1_count: missingFixtures?.length || 0,
      pass2_count: ticketMissingFixtures.length,
      inserted,
      status_updates: statusUpdateCount,
      duration_ms: duration,
      errors: errors.slice(0, 10),
    });

    // Also log to optimizer_run_logs for consistency
    await supabase.from("optimizer_run_logs").insert({
      run_type: "auto-backfill-results",
      window_start: new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString(),
      window_end: new Date().toISOString(),
      scope: { leagues: SUPPORTED_LEAGUES, lookback_days: LOOKBACK_DAYS },
      scanned: allMissing.length,
      upserted: inserted,
      skipped: 0,
      failed,
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: duration,
      notes: errors.length > 0 ? `Errors: ${JSON.stringify(errors.slice(0, 5))}` : "Clean run",
    });

    // ===== CHAIN: Trigger scorer if we inserted results =====
    let scorerResult: any = null;
    if (inserted > 0) {
      console.log(`[auto-backfill] Chaining score-ticket-legs after ${inserted} inserts...`);
      try {
        const scoreUrl = `${supabaseUrl}/functions/v1/score-ticket-legs`;
        const scoreResp = await fetch(scoreUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ batch_size: 500 }),
        });
        scorerResult = await scoreResp.json();
        console.log(`[auto-backfill] Scorer result: scored=${scorerResult?.scored_legs ?? 0}, tickets=${scorerResult?.updated_tickets ?? 0}`);
      } catch (scoreErr) {
        console.error("[auto-backfill] Scorer chain error:", scoreErr);
        scorerResult = { error: String(scoreErr) };
      }
    }

    // ===== WATCHDOG: Detect consecutive zero-insert runs =====
    if (inserted === 0 && allMissing.length > 0) {
      // Check last N runs for consecutive zeros
      const { data: recentRuns } = await supabase
        .from("pipeline_run_logs")
        .select("id, details")
        .eq("job_name", "auto-backfill-results")
        .eq("success", true)
        .order("run_started", { ascending: false })
        .limit(WATCHDOG_CONSECUTIVE_ZERO_THRESHOLD);
      
      const consecutiveZeros = (recentRuns || []).filter(
        (r: any) => r.details && (r.details.inserted === 0 || r.details.inserted === null)
      ).length;

      if (consecutiveZeros >= WATCHDOG_CONSECUTIVE_ZERO_THRESHOLD - 1) {
        // This run is also zero, so total = threshold
        console.warn(`[auto-backfill] WATCHDOG: ${WATCHDOG_CONSECUTIVE_ZERO_THRESHOLD} consecutive zero-insert runs with ${allMissing.length} missing fixtures!`);
        await supabase.from("pipeline_alerts").insert({
          alert_type: "backfill_stalled",
          severity: "warning",
          message: `Auto-backfill inserted 0 results for ${WATCHDOG_CONSECUTIVE_ZERO_THRESHOLD} consecutive runs despite ${allMissing.length} missing fixtures`,
          details: {
            consecutive_zeros: WATCHDOG_CONSECUTIVE_ZERO_THRESHOLD,
            missing_fixtures: allMissing.length,
            last_errors: errors.slice(0, 5),
          },
        });
      }
    }

    console.log("[auto-backfill] ===== FUNCTION END =====");

    return jsonResponse({
      success: true,
      missing_found: allMissing.length,
      pass1_count: missingFixtures?.length || 0,
      pass2_count: ticketMissingFixtures.length,
      processed,
      inserted,
      failed,
      status_updates: statusUpdateCount,
      leagues_covered: leaguesCovered,
      duration_ms: duration,
      rate_limiter: getRateLimiterStats(),
      scorer: scorerResult ? {
        scored_legs: scorerResult.scored_legs ?? 0,
        updated_tickets: scorerResult.updated_tickets ?? 0,
      } : null,
    }, origin, 200, req);

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[auto-backfill] Handler error:", errMsg);
    
    // Attempt to finalize log even on error
    if (pipelineLogId) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        await finalizePipelineLog(supabase, pipelineLogId, false, processed, failed, leaguesCovered, {}, errMsg);
      } catch (e) {
        console.error("[auto-backfill] Failed to finalize log on error:", e);
      }
    }
    
    return errorResponse("Internal server error", origin, 500, req);
  }
});

// Helper to finalize pipeline log
async function finalizePipelineLog(
  supabase: any,
  id: number | null,
  success: boolean,
  processed: number,
  failed: number,
  leagues: number[],
  details: any,
  errorMessage?: string
): Promise<void> {
  if (!id) return;
  try {
    await supabase
      .from("pipeline_run_logs")
      .update({
        run_finished: new Date().toISOString(),
        success,
        processed,
        failed,
        leagues_covered: leagues,
        details,
        error_message: errorMessage || null,
      })
      .eq("id", id);
  } catch (e) {
    console.error("[auto-backfill] Failed to update pipeline log:", e);
  }
}
