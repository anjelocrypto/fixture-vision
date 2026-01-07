// Fetch final match results and upsert into fixture_results
// CRITICAL FIX: Also updates fixtures.status from NS to FT for finished matches
// Uses centralized API-Football rate limiter for safe, automated operation
// HARDENED: Logs all runs to pipeline_run_logs for observability
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { fetchAPIFootball, fetchFixtureStatistics as fetchStats, getRateLimiterStats } from "../_shared/api_football.ts";

interface RequestBody {
  window_hours?: number;
  retention_months?: number;
  backfill_mode?: boolean;
  batch_size?: number;
  // Targeted backfill mode (supports multiple leagues)
  epl_backfill?: boolean;
  league_id?: number;
  backfill_league_ids?: number[];  // NEW: Multiple league backfill
  backfill_since?: string;         // NEW: Start date for backfill
  // Pagination for large backfills
  offset?: number;
  limit?: number;
}

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

// Pipeline logging helper - writes to pipeline_run_logs
async function logPipelineRun(
  supabase: any,
  params: {
    job_name: string;
    run_started: Date;
    run_finished?: Date;
    success: boolean;
    mode: string;
    processed: number;
    failed: number;
    leagues_covered: number[];
    details: any;
    error_message?: string;
  }
) {
  try {
    await supabase.from("pipeline_run_logs").insert({
      job_name: params.job_name,
      run_started: params.run_started.toISOString(),
      run_finished: params.run_finished?.toISOString() || new Date().toISOString(),
      success: params.success,
      mode: params.mode,
      processed: params.processed,
      failed: params.failed,
      leagues_covered: params.leagues_covered,
      details: params.details,
      error_message: params.error_message || null,
    });
  } catch (e) {
    console.error("[results-refresh] Failed to log pipeline run:", e);
  }
}

// Insert initial pipeline log row
async function insertPipelineLog(
  supabase: any,
  mode: string,
  leagues: number[]
): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from("pipeline_run_logs")
      .insert({
        job_name: "results-refresh",
        run_started: new Date().toISOString(),
        success: false,
        mode,
        processed: 0,
        failed: 0,
        leagues_covered: leagues,
        details: { status: "started" },
      })
      .select("id")
      .single();
    
    if (error) {
      console.error("[results-refresh] Failed to insert pipeline log:", error);
      return null;
    }
    return data?.id || null;
  } catch (e) {
    console.error("[results-refresh] Exception inserting pipeline log:", e);
    return null;
  }
}

// Update pipeline log row at end of run
async function updatePipelineLog(
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
    console.error("[results-refresh] Failed to update pipeline log:", e);
  }
}

// Fetch fixture by ID using centralized client
async function fetchFixtureById(fixtureId: number): Promise<any | null> {
  const result = await fetchAPIFootball(`/fixtures?id=${fixtureId}`, { logPrefix: "[results-refresh]" });
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
  console.log("[results-refresh] ===== FUNCTION START =====");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[results-refresh] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return errorResponse("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Auth check using shared helper (NO .single() on scalar RPCs!)
    const cronKeyHeader = req.headers.get("x-cron-key") ?? req.headers.get("X-CRON-KEY");
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    let isAuthorized = false;

    // Check service role key first (highest priority)
    if (authHeader === `Bearer ${serviceRoleKey}`) {
      isAuthorized = true;
      console.log("[results-refresh] Authorized via service role bearer");
    }

    // Check cron key - NO .single() on scalar RPC!
    if (!isAuthorized && cronKeyHeader) {
      const { data: dbKey, error: keyError } = await supabase.rpc("get_cron_internal_key");
      if (keyError) {
        console.error("[results-refresh] get_cron_internal_key error:", keyError);
      } else {
        const expectedKey = String(dbKey || "").trim();
        const providedKey = String(cronKeyHeader || "").trim();
        if (providedKey && expectedKey && providedKey === expectedKey) {
          isAuthorized = true;
          console.log("[results-refresh] Authorized via X-CRON-KEY");
        }
      }
    }

    // Check user whitelist - NO .single() on scalar RPC!
    if (!isAuthorized && authHeader) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (anonKey) {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } }
        });
        
        const { data: isWhitelisted, error: wlError } = await userClient.rpc("is_user_whitelisted");
        if (wlError) {
          console.error("[results-refresh] is_user_whitelisted error:", wlError);
        } else if (isWhitelisted === true) {
          isAuthorized = true;
          console.log("[results-refresh] Authorized via user whitelist");
        }
      }
    }

    if (!isAuthorized) {
      console.error("[results-refresh] Authorization failed - no valid credentials");
      return errorResponse("Unauthorized", origin, 401, req);
    }

    // Parse request body
    const body: RequestBody = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const windowHours = body.window_hours ?? 6;
    const retentionMonths = body.retention_months;
    const isCleanup = req.headers.get("x-cleanup") === "1";
    const isEplBackfill = body.epl_backfill === true;
    const isMultiLeagueBackfill = Array.isArray(body.backfill_league_ids) && body.backfill_league_ids.length > 0;
    const targetLeagueId = body.league_id;
    const batchLimit = body.limit || 15;
    const batchOffset = body.offset || 0;
    const backfillSince = body.backfill_since || "2025-08-01";

    // Determine run mode for logging
    const runMode = isMultiLeagueBackfill ? 'multi_league_backfill' : 
                    isEplBackfill ? 'epl_backfill' : 
                    isCleanup ? 'cleanup' : 
                    body.backfill_mode ? 'backfill' : 'cron';

    console.log(`[results-refresh] Mode: ${runMode.toUpperCase()}`);
    console.log(`[results-refresh] Parameters: window_hours=${windowHours}, batch_size=${body.batch_size}, league_id=${targetLeagueId || 'all'}, limit=${batchLimit}, offset=${batchOffset}`);
    if (isMultiLeagueBackfill) {
      console.log(`[results-refresh] Multi-league backfill leagues: ${body.backfill_league_ids!.join(", ")}, since: ${backfillSince}`);
    }

    // Insert initial pipeline log entry
    const pipelineLogId = await insertPipelineLog(supabase, runMode, []);

    // Handle cleanup mode
    if (isCleanup && retentionMonths) {
      console.log(`[results-refresh] Running cleanup: retention_months=${retentionMonths}`);
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);
      
      await supabase.from("fixture_results").delete().lt("finished_at", cutoffDate.toISOString());
      await updatePipelineLog(supabase, pipelineLogId, true, 0, 0, [], { retention_months: retentionMonths });
      return jsonResponse({ success: true, mode: "cleanup", retention_months: retentionMonths }, origin, 200, req);
    }

    // Auto-cleanup past selections
    console.log("[results-refresh] Auto-cleanup: removing past/finished selections");
    const { data: pastFixtures } = await supabase
      .from("fixtures")
      .select("id")
      .or(`timestamp.lt.${Math.floor(Date.now() / 1000)},status.not.in.(NS,TBD)`);
    
    if (pastFixtures && pastFixtures.length > 0) {
      const pastFixtureIds = pastFixtures.map((f: any) => f.id);
      await supabase.from("optimized_selections").delete().in("fixture_id", pastFixtureIds);
      await supabase.from("outcome_selections").delete().in("fixture_id", pastFixtureIds);
      console.log(`[results-refresh] Cleaned up selections for ${pastFixtureIds.length} past fixtures`);
    }

    // ======= MULTI-LEAGUE BACKFILL MODE =======
    if (isMultiLeagueBackfill) {
      const leagueIds = body.backfill_league_ids!;
      console.log(`[results-refresh] MULTI-LEAGUE BACKFILL: Finding missing results for leagues [${leagueIds.join(", ")}] since ${backfillSince}`);

      // Find FT fixtures without results for all target leagues
      const { data: allMissingFixtures, error: missingError } = await supabase
        .from("fixtures")
        .select("id, league_id, timestamp, status, teams_home, teams_away")
        .in("league_id", leagueIds)
        .eq("status", "FT")
        .gte("date", backfillSince)
        .order("date", { ascending: true });

      if (missingError) {
        console.error("[results-refresh] Error fetching missing fixtures:", missingError);
        await updatePipelineLog(supabase, pipelineLogId, false, 0, 0, leagueIds, {}, missingError.message);
        return errorResponse(`Failed to fetch fixtures: ${missingError.message}`, origin, 500, req);
      }

      if (!allMissingFixtures || allMissingFixtures.length === 0) {
        console.log("[results-refresh] No FT fixtures found for multi-league backfill");
        await updatePipelineLog(supabase, pipelineLogId, true, 0, 0, leagueIds, { message: "No FT fixtures found" });
        return jsonResponse({ success: true, mode: "multi_league_backfill", scanned: 0, inserted: 0, message: "No FT fixtures found" }, origin, 200, req);
      }

      console.log(`[results-refresh] Found ${allMissingFixtures.length} FT fixtures across ${leagueIds.length} leagues`);

      // Check which already have results
      const fixtureIds = allMissingFixtures.map((f: any) => f.id);
      const { data: existingResults } = await supabase
        .from("fixture_results")
        .select("fixture_id")
        .in("fixture_id", fixtureIds);

      const existingIds = new Set((existingResults || []).map((r: any) => r.fixture_id));
      const missingFixtures = allMissingFixtures.filter((f: any) => !existingIds.has(f.id));
      
      // Apply pagination
      const fixturesToProcess = missingFixtures.slice(batchOffset, batchOffset + batchLimit);
      const hasMore = batchOffset + batchLimit < missingFixtures.length;

      console.log(`[results-refresh] Already have results for ${existingIds.size} fixtures`);
      console.log(`[results-refresh] Total missing: ${missingFixtures.length}, Processing batch: offset=${batchOffset}, limit=${batchLimit}, count=${fixturesToProcess.length}`);

      if (fixturesToProcess.length === 0) {
        await updatePipelineLog(supabase, pipelineLogId, true, 0, 0, leagueIds, { 
          total_ft_fixtures: allMissingFixtures.length,
          already_have: existingIds.size,
          message: "All fixtures already have results"
        });
        return jsonResponse({ 
          success: true, 
          mode: "multi_league_backfill",
          leagues: leagueIds,
          total_fixtures: allMissingFixtures.length,
          already_have: existingIds.size,
          total_missing: missingFixtures.length,
          inserted: 0,
          has_more: false,
          message: "All fixtures already have results"
        }, origin, 200, req);
      }

      // Count by league for logging
      const leagueCounts: Record<number, number> = {};
      for (const f of fixturesToProcess) {
        leagueCounts[f.league_id] = (leagueCounts[f.league_id] || 0) + 1;
      }
      console.log("[results-refresh] Fixtures by league:", JSON.stringify(leagueCounts));

      // Process fixtures
      const results: FixtureResultRow[] = [];
      const errors: { fixture_id: number; error: string }[] = [];
      let processed = 0;

      for (const fixture of fixturesToProcess) {
        processed++;
        const homeName = fixture.teams_home?.name || "Unknown";
        const awayName = fixture.teams_away?.name || "Unknown";
        
        console.log(`[results-refresh] Processing ${processed}/${fixturesToProcess.length}: fixture ${fixture.id} (league ${fixture.league_id}) ${homeName} vs ${awayName}`);

        try {
          const apiFixture = await fetchFixtureById(fixture.id);
          
          if (!apiFixture || !apiFixture.teams) {
            errors.push({ fixture_id: fixture.id, error: "API returned no fixture/teams data" });
            continue;
          }

          const apiStatus = apiFixture.fixture?.status?.short || "NS";
          const isFinished = ["FT", "AET", "PEN", "AWD", "WO"].includes(apiStatus);
          
          if (!isFinished) {
            errors.push({ fixture_id: fixture.id, error: `API status is ${apiStatus}, not finished` });
            continue;
          }

          const goalsHome = apiFixture.goals?.home ?? apiFixture.score?.fulltime?.home ?? 0;
          const goalsAway = apiFixture.goals?.away ?? apiFixture.score?.fulltime?.away ?? 0;

          // Fetch statistics
          const statsData = await fetchFixtureStatistics(fixture.id);
          let cornersHome: number | null = null, cornersAway: number | null = null;
          let cardsHome: number | null = null, cardsAway: number | null = null;
          let foulsHome: number | null = null, foulsAway: number | null = null;
          let offsidesHome: number | null = null, offsidesAway: number | null = null;

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
            fixture_id: fixture.id,
            league_id: fixture.league_id,
            kickoff_at: new Date(fixture.timestamp * 1000).toISOString(),
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

          console.log(`[results-refresh] Fixture ${fixture.id}: ${goalsHome}-${goalsAway} ✓`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[results-refresh] Fixture ${fixture.id}: Exception - ${errMsg}`);
          errors.push({ fixture_id: fixture.id, error: errMsg });
        }

        await new Promise(r => setTimeout(r, 50));
      }

      // Batch upsert
      let inserted = 0;
      if (results.length > 0) {
        const { error: upsertError } = await supabase
          .from("fixture_results")
          .upsert(results, { onConflict: "fixture_id" });

        if (upsertError) {
          console.error("[results-refresh] Upsert error:", upsertError);
          await updatePipelineLog(supabase, pipelineLogId, false, results.length, errors.length, leagueIds, {}, upsertError.message);
          return errorResponse(`Failed to upsert results: ${upsertError.message}`, origin, 500, req);
        }
        inserted = results.length;
        console.log(`[results-refresh] Successfully upserted ${inserted} results`);
      }

      const duration = Date.now() - startTime;
      console.log(`[results-refresh] MULTI-LEAGUE BACKFILL COMPLETE: ${inserted} inserted, ${errors.length} errors, ${duration}ms`);

      await updatePipelineLog(supabase, pipelineLogId, true, inserted, errors.length, leagueIds, {
        leagues: leagueIds,
        total_ft_fixtures: allMissingFixtures.length,
        already_have: existingIds.size,
        total_missing: missingFixtures.length,
        batch_offset: batchOffset,
        batch_limit: batchLimit,
        attempted: fixturesToProcess.length,
        error_details: errors.slice(0, 10),
        duration_ms: duration,
      });

      // Also log to optimizer_run_logs for consistency
      await supabase.from("optimizer_run_logs").insert({
        run_type: "results-refresh-multi-league-backfill",
        window_start: backfillSince,
        window_end: new Date().toISOString(),
        scope: { leagues: leagueIds, league_counts: leagueCounts },
        scanned: fixturesToProcess.length,
        upserted: inserted,
        skipped: 0,
        failed: errors.length,
        started_at: new Date(startTime).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: duration,
        notes: errors.length > 0 ? `Errors: ${JSON.stringify(errors.slice(0, 10))}` : null
      });

      return jsonResponse({
        success: true,
        mode: "multi_league_backfill",
        leagues: leagueIds,
        total_ft_fixtures: allMissingFixtures.length,
        already_have: existingIds.size,
        total_missing: missingFixtures.length,
        batch_offset: batchOffset,
        batch_limit: batchLimit,
        attempted: fixturesToProcess.length,
        inserted,
        errors: errors.length,
        has_more: hasMore,
        next_offset: hasMore ? batchOffset + batchLimit : null,
        error_details: errors.slice(0, 10),
        duration_ms: duration,
        rate_limiter: getRateLimiterStats()
      }, origin, 200, req);
    }

    // ======= TARGETED EPL BACKFILL MODE =======
    if (isEplBackfill) {
      const leagueId = targetLeagueId || 39; // Default to EPL
      const seasonStart = "2025-08-01";
      
      console.log(`[results-refresh] EPL BACKFILL MODE: Finding missing results for league ${leagueId} since ${seasonStart}`);

      // Find FT fixtures without results
      const { data: missingFixtures, error: missingError } = await supabase
        .from("fixtures")
        .select("id, league_id, timestamp, status, teams_home, teams_away")
        .eq("league_id", leagueId)
        .eq("status", "FT")
        .gte("date", seasonStart)
        .order("date", { ascending: true });

      if (missingError) {
        console.error("[results-refresh] Error fetching missing fixtures:", missingError);
        return errorResponse(`Failed to fetch fixtures: ${missingError.message}`, origin, 500, req);
      }

      if (!missingFixtures || missingFixtures.length === 0) {
        console.log("[results-refresh] No FT fixtures found for EPL backfill");
        return jsonResponse({ success: true, mode: "epl_backfill", scanned: 0, inserted: 0, message: "No FT fixtures found" }, origin, 200, req);
      }

      console.log(`[results-refresh] Found ${missingFixtures.length} FT fixtures in league ${leagueId}`);

      // Check which already have results
      const fixtureIds = missingFixtures.map((f: any) => f.id);
      const { data: existingResults } = await supabase
        .from("fixture_results")
        .select("fixture_id")
        .in("fixture_id", fixtureIds);

      const existingIds = new Set((existingResults || []).map((r: any) => r.fixture_id));
      const allMissingFixtures = missingFixtures.filter((f: any) => !existingIds.has(f.id));
      
      // Apply pagination to missing fixtures
      const fixturesToProcess = allMissingFixtures.slice(batchOffset, batchOffset + batchLimit);
      const hasMore = batchOffset + batchLimit < allMissingFixtures.length;

      console.log(`[results-refresh] Already have results for ${existingIds.size} fixtures`);
      console.log(`[results-refresh] Total missing: ${allMissingFixtures.length}, Processing batch: offset=${batchOffset}, limit=${batchLimit}, count=${fixturesToProcess.length}, hasMore=${hasMore}`);

      if (fixturesToProcess.length === 0) {
        console.log("[results-refresh] No fixtures to process in this batch");
        return jsonResponse({ 
          success: true, 
          mode: "epl_backfill",
          league_id: leagueId,
          total_fixtures: missingFixtures.length,
          already_have: existingIds.size,
          total_missing: allMissingFixtures.length,
          inserted: 0,
          has_more: false,
          next_offset: null,
          message: "All fixtures already have results"
        }, origin, 200, req);
      }

      // Log which teams are affected
      const teamCounts: Record<string, number> = {};
      for (const f of fixturesToProcess) {
        const homeName = f.teams_home?.name || "Unknown";
        const awayName = f.teams_away?.name || "Unknown";
        teamCounts[homeName] = (teamCounts[homeName] || 0) + 1;
        teamCounts[awayName] = (teamCounts[awayName] || 0) + 1;
      }
      console.log("[results-refresh] Teams with missing results:", JSON.stringify(teamCounts));

      // Process each fixture
      const results: FixtureResultRow[] = [];
      const errors: { fixture_id: number; error: string }[] = [];
      let processed = 0;

      for (const fixture of fixturesToProcess) {
        processed++;
        const homeName = fixture.teams_home?.name || "Unknown";
        const awayName = fixture.teams_away?.name || "Unknown";
        
        console.log(`[results-refresh] Processing ${processed}/${fixturesToProcess.length}: fixture ${fixture.id} (${homeName} vs ${awayName})`);

        try {
          const apiFixture = await fetchFixtureById(fixture.id);
          
          if (!apiFixture || !apiFixture.teams) {
            const errMsg = "API returned no fixture or teams data";
            console.error(`[results-refresh] Fixture ${fixture.id}: ${errMsg}`);
            errors.push({ fixture_id: fixture.id, error: errMsg });
            continue;
          }

          const apiStatus = apiFixture.fixture?.status?.short || "NS";
          const isFinished = ["FT", "AET", "PEN", "AWD", "WO"].includes(apiStatus);
          
          if (!isFinished) {
            const errMsg = `API status is ${apiStatus}, not finished`;
            console.warn(`[results-refresh] Fixture ${fixture.id}: ${errMsg}`);
            errors.push({ fixture_id: fixture.id, error: errMsg });
            continue;
          }

          const goalsHome = apiFixture.goals?.home ?? apiFixture.score?.fulltime?.home ?? 0;
          const goalsAway = apiFixture.goals?.away ?? apiFixture.score?.fulltime?.away ?? 0;
          
          console.log(`[results-refresh] Fixture ${fixture.id}: Score ${goalsHome}-${goalsAway}`);

          // Fetch statistics
          let cornersHome: number | null = null;
          let cornersAway: number | null = null;
          let cardsHome: number | null = null;
          let cardsAway: number | null = null;
          let foulsHome: number | null = null;
          let foulsAway: number | null = null;
          let offsidesHome: number | null = null;
          let offsidesAway: number | null = null;

          const statsData = await fetchFixtureStatistics(fixture.id);
          
          if (statsData && Array.isArray(statsData) && statsData.length === 2) {
            const homeStats = statsData.find((s: any) => s.team?.id === apiFixture.teams?.home?.id);
            const awayStats = statsData.find((s: any) => s.team?.id === apiFixture.teams?.away?.id);
            
            if (homeStats?.statistics) {
              const cornersStat = homeStats.statistics.find((st: any) => 
                st.type === "Corner Kicks" || st.type === "Corners"
              );
              cornersHome = cornersStat?.value ?? null;
              
              const yellowCards = homeStats.statistics.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
              const redCards = homeStats.statistics.find((st: any) => st.type === "Red Cards")?.value ?? 0;
              cardsHome = (yellowCards || 0) + (redCards || 0);
              
              foulsHome = homeStats.statistics.find((st: any) => st.type === "Fouls")?.value ?? null;
              offsidesHome = homeStats.statistics.find((st: any) => st.type === "Offsides")?.value ?? null;
            }
            
            if (awayStats?.statistics) {
              const cornersStat = awayStats.statistics.find((st: any) => 
                st.type === "Corner Kicks" || st.type === "Corners"
              );
              cornersAway = cornersStat?.value ?? null;
              
              const yellowCards = awayStats.statistics.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
              const redCards = awayStats.statistics.find((st: any) => st.type === "Red Cards")?.value ?? 0;
              cardsAway = (yellowCards || 0) + (redCards || 0);
              
              foulsAway = awayStats.statistics.find((st: any) => st.type === "Fouls")?.value ?? null;
              offsidesAway = awayStats.statistics.find((st: any) => st.type === "Offsides")?.value ?? null;
            }
            
            console.log(`[results-refresh] Fixture ${fixture.id}: Stats - corners ${cornersHome}-${cornersAway}, cards ${cardsHome}-${cardsAway}`);
          } else {
            console.warn(`[results-refresh] Fixture ${fixture.id}: No detailed statistics available`);
          }

          const result: FixtureResultRow = {
            fixture_id: fixture.id,
            league_id: fixture.league_id,
            kickoff_at: new Date(fixture.timestamp * 1000).toISOString(),
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
          };

          results.push(result);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[results-refresh] Fixture ${fixture.id}: Exception - ${errMsg}`);
          errors.push({ fixture_id: fixture.id, error: errMsg });
        }

        // Small delay to respect rate limits
        await new Promise(r => setTimeout(r, 50));
      }

      // Batch upsert results
      let inserted = 0;
      if (results.length > 0) {
        console.log(`[results-refresh] Upserting ${results.length} results into fixture_results`);
        
        const { error: upsertError } = await supabase
          .from("fixture_results")
          .upsert(results, { onConflict: "fixture_id" });

        if (upsertError) {
          console.error("[results-refresh] Upsert error:", upsertError);
          return errorResponse(`Failed to upsert results: ${upsertError.message}`, origin, 500, req);
        }

        inserted = results.length;
        console.log(`[results-refresh] Successfully upserted ${inserted} results`);
      }

      const duration = Date.now() - startTime;
      console.log(`[results-refresh] EPL BACKFILL COMPLETE: ${inserted} inserted, ${errors.length} errors, ${duration}ms`);

      // Log to optimizer_run_logs
      await supabase.from("optimizer_run_logs").insert({
        run_type: "results-refresh-epl-backfill",
        window_start: seasonStart,
        window_end: new Date().toISOString(),
        scope: { league_id: leagueId, epl_backfill: true, team_counts: teamCounts },
        scanned: fixturesToProcess.length,
        upserted: inserted,
        skipped: 0,
        failed: errors.length,
        started_at: new Date(startTime).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: duration,
        notes: errors.length > 0 ? `Errors: ${JSON.stringify(errors.slice(0, 10))}` : null
      });

      console.log("[results-refresh] ===== EPL BACKFILL END =====");

      return jsonResponse({
        success: true,
        mode: "epl_backfill",
        league_id: leagueId,
        total_ft_fixtures: missingFixtures.length,
        already_have: existingIds.size,
        total_missing: allMissingFixtures.length,
        batch_offset: batchOffset,
        batch_limit: batchLimit,
        attempted: fixturesToProcess.length,
        inserted,
        errors: errors.length,
        has_more: hasMore,
        next_offset: hasMore ? batchOffset + batchLimit : null,
        error_details: errors.slice(0, 10),
        duration_ms: duration,
        rate_limiter: getRateLimiterStats()
      }, origin, 200, req);
    }

    // ======= NORMAL / BACKFILL MODE =======
    const maxLookbackDays = body.backfill_mode ? 365 : 30;
    const lookbackLimit = new Date(Date.now() - maxLookbackDays * 24 * 3600 * 1000);
    const finishedThreshold = Math.floor((Date.now() - 2 * 3600 * 1000) / 1000);
    
    console.log(`[results-refresh] Finding fixtures that kicked off >2h ago (lookback: ${maxLookbackDays} days)`);

    const batchSize = body.batch_size || (body.backfill_mode ? 100 : 400);
    
    let fixturesQuery = supabase
      .from("fixtures")
      .select("id, league_id, timestamp, status, teams_home, teams_away")
      .lt("timestamp", finishedThreshold)
      .order("timestamp", { ascending: false })
      .limit(batchSize * 3);
    
    if (!body.backfill_mode) {
      fixturesQuery = fixturesQuery.gte("timestamp", Math.floor(lookbackLimit.getTime() / 1000));
    }
    
    const { data: allFixtures, error: fixturesError } = await fixturesQuery;

    if (fixturesError) {
      console.error("[results-refresh] Error fetching fixtures:", fixturesError);
      return errorResponse(`Failed to fetch fixtures: ${fixturesError.message}`, origin, 500, req);
    }

    if (!allFixtures || allFixtures.length === 0) {
      console.log("[results-refresh] No fixtures found to process");
      return jsonResponse({
        success: true, 
        window_hours: windowHours,
        scanned: 0, 
        inserted: 0, 
        skipped: 0,
        errors: 0,
        status_updates: 0,
        rate_limiter: getRateLimiterStats()
      }, origin, 200, req);
    }

    console.log(`[results-refresh] Found ${allFixtures.length} past fixtures to check`);

    // Check which fixtures already have results
    const fixtureIds = allFixtures.map((f: any) => f.id);
    const { data: existingResults } = await supabase
      .from("fixture_results")
      .select("fixture_id")
      .in("fixture_id", fixtureIds);
    
    const existingIds = new Set((existingResults || []).map((r: any) => r.fixture_id));
    const fixtures = allFixtures.filter((f: any) => !existingIds.has(f.id)).slice(0, batchSize);
    
    console.log(`[results-refresh] Total past fixtures: ${allFixtures.length}, Already have results: ${existingIds.size}, Need results: ${fixtures.length}`);

    if (fixtures.length === 0) {
      console.log("[results-refresh] All fixtures already have results");
      return jsonResponse({ 
        success: true, 
        window_hours: windowHours,
        scanned: 0, 
        inserted: 0, 
        skipped: 0,
        errors: 0,
        status_updates: 0,
        rate_limiter: getRateLimiterStats()
      }, origin, 200, req);
    }

    // Process fixtures
    const results: FixtureResultRow[] = [];
    const statusUpdates: { id: number; status: string }[] = [];
    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const fixture of fixtures) {
      const homeName = fixture.teams_home?.name || "Unknown";
      const awayName = fixture.teams_away?.name || "Unknown";
      
      try {
        console.log(`[results-refresh] Processing fixture ${fixture.id} (league ${fixture.league_id}): ${homeName} vs ${awayName}`);
        
        const apiFixture = await fetchFixtureById(fixture.id);
        
        if (!apiFixture || !apiFixture.teams) {
          console.warn(`[results-refresh] Fixture ${fixture.id}: No data from API, skipping`);
          skipped++;
          continue;
        }

        const apiStatus = apiFixture.fixture?.status?.short || "NS";
        const isFinished = ["FT", "AET", "PEN", "AWD", "WO"].includes(apiStatus);
        
        if (!isFinished) {
          console.log(`[results-refresh] Fixture ${fixture.id}: Status ${apiStatus}, not finished, skipping`);
          if (fixture.status !== apiStatus) {
            statusUpdates.push({ id: fixture.id, status: apiStatus });
          }
          skipped++;
          continue;
        }

        if (fixture.status !== apiStatus) {
          statusUpdates.push({ id: fixture.id, status: apiStatus });
        }

        const goalsHome = apiFixture.goals?.home ?? apiFixture.score?.fulltime?.home ?? 0;
        const goalsAway = apiFixture.goals?.away ?? apiFixture.score?.fulltime?.away ?? 0;
        
        console.log(`[results-refresh] Fixture ${fixture.id}: Score ${goalsHome}-${goalsAway}`);

        // Fetch statistics
        let cornersHome: number | null = null;
        let cornersAway: number | null = null;
        let cardsHome: number | null = null;
        let cardsAway: number | null = null;
        let foulsHome: number | null = null;
        let foulsAway: number | null = null;
        let offsidesHome: number | null = null;
        let offsidesAway: number | null = null;

        const statsData = await fetchFixtureStatistics(fixture.id);
        
        if (statsData && Array.isArray(statsData) && statsData.length === 2) {
          const homeStats = statsData.find((s: any) => s.team?.id === apiFixture.teams?.home?.id);
          const awayStats = statsData.find((s: any) => s.team?.id === apiFixture.teams?.away?.id);
          
          if (homeStats?.statistics) {
            const cornersStat = homeStats.statistics.find((st: any) => 
              st.type === "Corner Kicks" || st.type === "Corners"
            );
            cornersHome = cornersStat?.value ?? null;
            
            const yellowCards = homeStats.statistics.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
            const redCards = homeStats.statistics.find((st: any) => st.type === "Red Cards")?.value ?? 0;
            cardsHome = (yellowCards || 0) + (redCards || 0);
            
            foulsHome = homeStats.statistics.find((st: any) => st.type === "Fouls")?.value ?? null;
            offsidesHome = homeStats.statistics.find((st: any) => st.type === "Offsides")?.value ?? null;
          }
          
          if (awayStats?.statistics) {
            const cornersStat = awayStats.statistics.find((st: any) => 
              st.type === "Corner Kicks" || st.type === "Corners"
            );
            cornersAway = cornersStat?.value ?? null;
            
            const yellowCards = awayStats.statistics.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
            const redCards = awayStats.statistics.find((st: any) => st.type === "Red Cards")?.value ?? 0;
            cardsAway = (yellowCards || 0) + (redCards || 0);
            
            foulsAway = awayStats.statistics.find((st: any) => st.type === "Fouls")?.value ?? null;
            offsidesAway = awayStats.statistics.find((st: any) => st.type === "Offsides")?.value ?? null;
          }
        }

        const result: FixtureResultRow = {
          fixture_id: fixture.id,
          league_id: fixture.league_id,
          kickoff_at: new Date(fixture.timestamp * 1000).toISOString(),
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
        };

        results.push(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[results-refresh] Fixture ${fixture.id}: Exception - ${errMsg}`);
        errors++;
      }
    }

    // Batch upsert results
    if (results.length > 0) {
      console.log(`[results-refresh] Upserting ${results.length} results`);
      
      const { error: upsertError } = await supabase
        .from("fixture_results")
        .upsert(results, { onConflict: "fixture_id" });

      if (upsertError) {
        console.error("[results-refresh] Upsert error:", upsertError);
        return errorResponse(`Failed to upsert results: ${upsertError.message}`, origin, 500, req);
      }

      inserted = results.length;
      console.log(`[results-refresh] Successfully upserted ${inserted} results`);
    }

    // Update fixture statuses
    let statusUpdateCount = 0;
    if (statusUpdates.length > 0) {
      console.log(`[results-refresh] Updating ${statusUpdates.length} fixture statuses`);
      for (const update of statusUpdates) {
        const { error } = await supabase
          .from("fixtures")
          .update({ status: update.status })
          .eq("id", update.id);
        if (!error) statusUpdateCount++;
      }
      console.log(`[results-refresh] Updated ${statusUpdateCount} fixture statuses`);
    }

    const duration = Date.now() - startTime;
    console.log(`[results-refresh] COMPLETE: ${inserted} inserted, ${skipped} skipped, ${errors} errors, ${statusUpdateCount} status updates, ${duration}ms`);

    // Collect leagues covered for logging
    const leaguesCovered = [...new Set(fixtures.map((f: any) => f.league_id))];

    // Update pipeline_run_logs with success status
    await updatePipelineLog(supabase, pipelineLogId, true, inserted, errors, leaguesCovered, {
      window_hours: windowHours,
      batch_size: batchSize,
      backfill_mode: body.backfill_mode ?? false,
      scanned: fixtures.length,
      skipped,
      status_updates: statusUpdateCount,
      duration_ms: duration,
    });

    // Log to optimizer_run_logs
    await supabase.from("optimizer_run_logs").insert({
      run_type: "results-refresh",
      window_start: lookbackLimit.toISOString(),
      window_end: new Date().toISOString(),
      scope: { window_hours: windowHours, batch_size: batchSize, backfill_mode: body.backfill_mode ?? false },
      scanned: fixtures.length,
      upserted: inserted,
      skipped: skipped,
      failed: errors,
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: duration,
      notes: `status_updates: ${statusUpdateCount}`
    });

    console.log("[results-refresh] ===== FUNCTION END =====");

    return jsonResponse({
      success: true,
      window_hours: windowHours,
      scanned: fixtures.length,
      inserted,
      skipped,
      errors,
      status_updates: statusUpdateCount,
      duration_ms: duration,
      rate_limiter: getRateLimiterStats()
    }, origin, 200, req);

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[results-refresh] Handler error:", errMsg);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
