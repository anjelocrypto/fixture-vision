/**
 * AUTO-BACKFILL-RESULTS: Self-healing cron job to automatically backfill missing fixture results
 * 
 * RUNS: Every 30 minutes via cron
 * PURPOSE: Find fixtures that kicked off >3h ago but are missing from fixture_results, and fetch their results
 * 
 * This function uses the new get_fixtures_missing_results RPC to find gaps and fills them automatically.
 * Zero manual intervention required.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { fetchAPIFootball, fetchFixtureStatistics as fetchStats, getRateLimiterStats } from "../_shared/api_football.ts";

const SUPPORTED_LEAGUES = [39, 40, 78, 140, 135, 61, 2, 3, 848, 45, 48, 66, 81, 137, 143];
const BATCH_SIZE = 30; // Process 30 fixtures per run to stay within timeout
const LOOKBACK_DAYS = 14; // Look back 14 days for missing results

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

    // Auth check
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    let isAuthorized = false;

    if (authHeader === `Bearer ${serviceRoleKey}`) {
      isAuthorized = true;
      console.log("[auto-backfill] Authorized via service role");
    }

    if (!isAuthorized && cronKeyHeader) {
      const { data: dbKey } = await supabase.rpc("get_cron_internal_key").single();
      if (dbKey && cronKeyHeader === dbKey) {
        isAuthorized = true;
        console.log("[auto-backfill] Authorized via X-CRON-KEY");
      }
    }

    if (!isAuthorized && authHeader) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (anonKey) {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } }
        });
        const { data: isWhitelisted } = await userClient.rpc("is_user_whitelisted").single();
        if (isWhitelisted) {
          isAuthorized = true;
          console.log("[auto-backfill] Authorized via user whitelist");
        }
      }
    }

    if (!isAuthorized) {
      console.error("[auto-backfill] Authorization failed");
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

    // Use the new RPC function to find missing fixtures
    console.log(`[auto-backfill] Calling get_fixtures_missing_results(lookback_days=${LOOKBACK_DAYS}, batch_limit=${BATCH_SIZE})`);
    
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

    if (!missingFixtures || missingFixtures.length === 0) {
      console.log("[auto-backfill] No missing fixtures found - all results up to date!");
      await finalizePipelineLog(supabase, pipelineLogId, true, 0, 0, [], { message: "No missing fixtures" });
      return jsonResponse({ 
        success: true, 
        missing_count: 0, 
        processed: 0, 
        inserted: 0, 
        message: "All results up to date" 
      }, origin, 200, req);
    }

    console.log(`[auto-backfill] Found ${missingFixtures.length} fixtures missing results`);

    // Track leagues
    const leagueSet = new Set<number>();
    for (const f of missingFixtures) {
      leagueSet.add(f.fixture_league_id);
    }
    leaguesCovered.push(...leagueSet);
    console.log(`[auto-backfill] Leagues affected: ${leaguesCovered.join(", ")}`);

    // Process each fixture
    const results: FixtureResultRow[] = [];
    const errors: { fixture_id: number; error: string }[] = [];
    const statusUpdates: { id: number; status: string }[] = [];

    for (const fixture of missingFixtures) {
      processed++;
      console.log(`[auto-backfill] Processing ${processed}/${missingFixtures.length}: fixture ${fixture.fixture_id} (league ${fixture.fixture_league_id})`);

      try {
        const apiFixture = await fetchFixtureById(fixture.fixture_id);
        
        if (!apiFixture || !apiFixture.teams) {
          errors.push({ fixture_id: fixture.fixture_id, error: "No data from API" });
          failed++;
          continue;
        }

        const apiStatus = apiFixture.fixture?.status?.short || "NS";
        const isFinished = ["FT", "AET", "PEN", "AWD", "WO"].includes(apiStatus);
        
        // Update fixture status if different
        if (fixture.fixture_status !== apiStatus) {
          statusUpdates.push({ id: fixture.fixture_id, status: apiStatus });
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

    // Batch upsert results
    if (results.length > 0) {
      console.log(`[auto-backfill] Upserting ${results.length} results`);
      const { error: upsertError } = await supabase
        .from("fixture_results")
        .upsert(results, { onConflict: "fixture_id" });

      if (upsertError) {
        console.error("[auto-backfill] Upsert error:", upsertError);
        await finalizePipelineLog(supabase, pipelineLogId, false, processed, failed, leaguesCovered, { upsert_error: upsertError.message }, upsertError.message);
        return errorResponse(`Upsert failed: ${upsertError.message}`, origin, 500, req);
      }

      inserted = results.length;
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
      missing_found: missingFixtures.length,
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
      scanned: missingFixtures.length,
      upserted: inserted,
      skipped: 0,
      failed,
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: duration,
      notes: errors.length > 0 ? `Errors: ${JSON.stringify(errors.slice(0, 5))}` : "Clean run",
    });

    console.log("[auto-backfill] ===== FUNCTION END =====");

    return jsonResponse({
      success: true,
      missing_found: missingFixtures.length,
      processed,
      inserted,
      failed,
      status_updates: statusUpdateCount,
      leagues_covered: leaguesCovered,
      duration_ms: duration,
      rate_limiter: getRateLimiterStats(),
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
