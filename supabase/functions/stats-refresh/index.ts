// ============================================================================
// stats-refresh Edge Function (SAFE MACHINE MODE v2)
// ============================================================================
// Refreshes team statistics cache in small, predictable batches.
// Designed to ALWAYS complete within Edge Function limits and ALWAYS log.
// 
// Safe Machine Mode v2 (2025-12-05):
// - MAX_TEAMS_PER_RUN = 8 (reduced from 15 - each team takes ~5-10s)
// - SOFT_TIME_LIMIT_MS = 50000 (increased to 50s for better utilization)
// - ALWAYS logs to optimizer_run_logs (even on partial success or failure)
// - DETAILED timing logs for debugging
// - Gradual, reliable progress toward 100% coverage
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { computeLastFiveAverages } from "../_shared/stats.ts";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { UPCOMING_WINDOW_HOURS } from "../_shared/config.ts";

// =============================================================================
// SAFE MACHINE MODE v2 CONFIGURATION
// =============================================================================
// CRITICAL: Each team takes 5-10 seconds due to multiple API calls per fixture
// - fetchTeamLast20FixtureIds: 1 API call (~30-50ms)
// - Per fixture: 2 API calls (fixture details + statistics) × ~5-10 fixtures = 10-20 calls
// - Total per team: ~15-25 API calls × 30-50ms = 5-10 seconds per team
// =============================================================================

/** Maximum teams per run - REDUCED because each team takes 5-10 seconds */
const MAX_TEAMS_PER_RUN = 8;

/** Stop processing new teams after 50s (gives 10s buffer before 60s timeout) */
const SOFT_TIME_LIMIT_MS = 50_000;

/** Delay between teams in ms for rate limiting */
const INTER_TEAM_DELAY_MS = 100;

// TOP 10 LEAGUES - These get processed FIRST to ensure 100% coverage
const TOP_LEAGUE_IDS = [
  39,   // Premier League
  140,  // La Liga
  135,  // Serie A
  78,   // Bundesliga
  61,   // Ligue 1
  40,   // Championship
  136,  // Serie B
  79,   // 2. Bundesliga
  88,   // Eredivisie
  89,   // Eerste Divisie
];

// Validation schema for admin request parameters
const AdminRequestSchema = z.object({
  window_hours: z.number().int().min(1).max(720).optional(),
  stats_ttl_hours: z.number().int().min(1).max(168).optional(),
  force: z.boolean().optional(),
});

// Simple delay helper
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Retry logic with exponential backoff (reduced retries for faster failure)
async function computeWithRetry(
  teamId: number, 
  supabase: any, 
  retries = 2,
  startedAt: number
): Promise<{ result: any; attempts: number; durationMs: number }> {
  let attempt = 0;
  const computeStart = Date.now();
  
  while (true) {
    try {
      console.log(`[stats-refresh] 🔄 Team ${teamId}: starting compute (attempt ${attempt + 1}/${retries + 1}, elapsed=${Date.now() - startedAt}ms)`);
      
      const result = await computeLastFiveAverages(teamId, supabase);
      
      const durationMs = Date.now() - computeStart;
      console.log(`[stats-refresh] ✅ Team ${teamId}: compute SUCCESS in ${durationMs}ms (sample=${result.sample_size})`);
      
      return { result, attempts: attempt + 1, durationMs };
      
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      console.warn(`[stats-refresh] ⚠️ Team ${teamId}: attempt ${attempt + 1} FAILED: ${errMsg.slice(0, 100)}`);
      
      if (attempt < retries) {
        const delay = 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
        console.log(`[stats-refresh] Team ${teamId}: retrying in ${delay}ms...`);
        await sleep(delay);
        attempt++;
        continue;
      }
      
      console.error(`[stats-refresh] ❌ Team ${teamId}: ALL ${retries + 1} attempts FAILED`);
      throw e;
    }
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? null;
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return handlePreflight(origin, req);
  }

  // ==========================================================================
  // SAFE MACHINE MODE v2: Track everything from the start
  // ==========================================================================
  const startedAt = Date.now();
  const softDeadline = startedAt + SOFT_TIME_LIMIT_MS;
  
  // Counters for logging (tracked throughout execution)
  let scanned = 0;
  let upserted = 0;
  let failed = 0;
  const notes: string[] = [];
  
  // Timing tracking
  const teamTimings: Array<{ teamId: number; durationMs: number; attempts: number; success: boolean }> = [];
  
  // Request parameters (set defaults, overwritten after parsing)
  let window_hours = UPCOMING_WINDOW_HOURS;
  let stats_ttl_hours = 24;
  let force = false;
  
  // Track state for finally block
  let lockAcquired = false;
  let supabase: any = null;
  let windowStart: Date | null = null;
  let windowEnd: Date | null = null;
  let earlyExit = false;
  let earlyExitReason = "";
  let teamsToProcessCount = 0;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseKey || !supabaseAnonKey) {
      return errorResponse("Missing required environment variables", origin, 500, req);
    }

    supabase = createClient(supabaseUrl, supabaseKey);

    // Parse and validate request body
    try {
      const body = await req.json().catch(() => ({}));
      const parsed = AdminRequestSchema.parse(body);
      
      if (parsed.window_hours !== undefined) window_hours = parsed.window_hours;
      if (parsed.stats_ttl_hours !== undefined) stats_ttl_hours = parsed.stats_ttl_hours;
      if (parsed.force !== undefined) force = parsed.force;
    } catch (e: any) {
      if (e.errors) {
        console.error("[stats-refresh] Invalid request body:", e.errors);
        return new Response(
          JSON.stringify({ error: "Invalid request body", details: e.errors }),
          { status: 422, headers: { ...getCorsHeaders(origin, req), "Content-Type": "application/json" } }
        );
      }
      // JSON parse error - use defaults
    }

    // ==========================================================================
    // DETAILED CONFIG LOGGING
    // ==========================================================================
    console.log(`[stats-refresh] ═══════════════════════════════════════════════════`);
    console.log(`[stats-refresh] 🚀 SAFE MACHINE MODE v2 STARTING`);
    console.log(`[stats-refresh] Config: MAX_TEAMS=${MAX_TEAMS_PER_RUN}, SOFT_LIMIT=${SOFT_TIME_LIMIT_MS}ms`);
    console.log(`[stats-refresh] Params: window=${window_hours}h, ttl=${stats_ttl_hours}h, force=${force}`);
    console.log(`[stats-refresh] ═══════════════════════════════════════════════════`);

    // Auth check
    const cronKeyHeader = req.headers.get('x-cron-key');
    const authHeader = req.headers.get('authorization');
    let isAuthorized = false;

    if (cronKeyHeader) {
      const { data: dbKey } = await supabase.rpc("get_cron_internal_key").single();
      if (dbKey && cronKeyHeader === dbKey) {
        isAuthorized = true;
        console.log("[stats-refresh] ✓ Authorized via X-CRON-KEY");
      }
    }

    if (!isAuthorized && authHeader) {
      if (authHeader === `Bearer ${supabaseKey}`) {
        isAuthorized = true;
        console.log("[stats-refresh] ✓ Authorized via service role");
      } else {
        const userClient = createClient(
          supabaseUrl,
          supabaseAnonKey,
          { global: { headers: { Authorization: authHeader } } }
        );
        const { data: isWhitelisted } = await userClient.rpc('is_user_whitelisted').single();
        if (isWhitelisted) {
          isAuthorized = true;
          console.log("[stats-refresh] ✓ Authorized via admin user");
        }
      }
    }

    if (!isAuthorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }

    // Acquire lock
    const { data: gotLock, error: lockError } = await supabase.rpc("acquire_cron_lock", {
      p_job_name: "stats-refresh",
      p_duration_minutes: 5, // Shorter lock since runs are faster now
    });

    if (lockError) {
      notes.push("lock_error");
      return errorResponse("Failed to acquire lock", origin, 500, req);
    }

    if (!gotLock) {
      console.log("[stats-refresh] ⏳ Lock held by another run, exiting");
      return jsonResponse({
        ok: true,
        job: "stats-refresh",
        mode: "safe-machine-v2",
        result: "already-running",
        reason: "LOCK_HELD",
      }, origin, 200, req);
    }

    lockAcquired = true;
    const lockAcquiredAt = Date.now();
    console.log(`[stats-refresh] 🔒 Lock acquired at ${lockAcquiredAt - startedAt}ms`);

    // Calculate time window
    const now = new Date();
    windowStart = now;
    windowEnd = new Date(now.getTime() + window_hours * 60 * 60 * 1000);
    const statsTTL = new Date(now.getTime() - stats_ttl_hours * 60 * 60 * 1000);

    // Get upcoming fixtures
    const { data: upcomingFixtures, error: fixturesError } = await supabase
      .from("fixtures")
      .select("id, league_id, teams_home, teams_away")
      .gte("timestamp", Math.floor(now.getTime() / 1000))
      .lte("timestamp", Math.floor(windowEnd.getTime() / 1000));

    if (fixturesError) {
      notes.push(`fixtures_error: ${fixturesError.message}`);
      throw new Error(`Failed to fetch fixtures: ${fixturesError.message}`);
    }

    console.log(`[stats-refresh] 📊 Found ${(upcomingFixtures || []).length} fixtures in ${window_hours}h window`);

    // Extract unique team IDs with league info
    const teamLeagueMap = new Map<number, Set<number>>();
    for (const fixture of upcomingFixtures || []) {
      const homeId = (fixture as any).teams_home?.id;
      const awayId = (fixture as any).teams_away?.id;
      const leagueId = fixture.league_id;
      
      if (homeId) {
        const id = Number(homeId);
        if (!teamLeagueMap.has(id)) teamLeagueMap.set(id, new Set());
        if (leagueId) teamLeagueMap.get(id)!.add(leagueId);
      }
      if (awayId) {
        const id = Number(awayId);
        if (!teamLeagueMap.has(id)) teamLeagueMap.set(id, new Set());
        if (leagueId) teamLeagueMap.get(id)!.add(leagueId);
      }
    }

    const allTeamIds = Array.from(teamLeagueMap.keys());
    console.log(`[stats-refresh] 👥 Extracted ${allTeamIds.length} unique teams`);

    // Query stats_cache
    const { data: cachedTeams } = await supabase
      .from("stats_cache")
      .select("team_id, computed_at, sample_size")
      .in("team_id", allTeamIds)
      .order("computed_at", { ascending: true, nullsFirst: true });

    // Type for cached team data
    type CachedTeam = { team_id: number; computed_at: string | null; sample_size: number };
    const cacheMap = new Map<number, CachedTeam>(
      (cachedTeams || []).map((t: CachedTeam) => [t.team_id, t])
    );

    // Helper functions
    const isTopLeagueTeam = (teamId: number): boolean => {
      const leagues = teamLeagueMap.get(teamId);
      return leagues ? TOP_LEAGUE_IDS.some(lid => leagues.has(lid)) : false;
    };

    const needsRefresh = (teamId: number): boolean => {
      const cached = cacheMap.get(teamId);
      if (!cached || !cached.computed_at) return true;
      if (force) return true;
      return new Date(cached.computed_at) < statsTTL;
    };

    const hasWeakStats = (teamId: number): boolean => {
      const cached = cacheMap.get(teamId);
      return !cached || cached.sample_size < 5;
    };

    // Build prioritized list (same priority order as before)
    let teamsToProcess: number[] = [];
    const addedTeams = new Set<number>();

    // Priority 1: TOP league teams needing refresh or with weak stats
    for (const teamId of allTeamIds) {
      if (isTopLeagueTeam(teamId) && (needsRefresh(teamId) || hasWeakStats(teamId))) {
        teamsToProcess.push(teamId);
        addedTeams.add(teamId);
      }
    }
    const p1Count = teamsToProcess.length;

    // Priority 2: Other teams with no cache
    for (const teamId of allTeamIds) {
      if (addedTeams.has(teamId)) continue;
      if (!cacheMap.has(teamId)) {
        teamsToProcess.push(teamId);
        addedTeams.add(teamId);
      }
    }
    const p2Count = teamsToProcess.length - p1Count;

    // Priority 3: Other teams with stale cache (oldest first)
    const sortedStale = ((cachedTeams || []) as CachedTeam[])
      .filter((t: CachedTeam) => !addedTeams.has(t.team_id) && needsRefresh(t.team_id))
      .sort((a: CachedTeam, b: CachedTeam) => {
        if (!a.computed_at) return -1;
        if (!b.computed_at) return 1;
        return new Date(a.computed_at).getTime() - new Date(b.computed_at).getTime();
      });

    for (const cached of sortedStale) {
      teamsToProcess.push(cached.team_id);
      addedTeams.add(cached.team_id);
    }
    const p3Count = teamsToProcess.length - p1Count - p2Count;

    // =========================================================================
    // SAFE MACHINE MODE v2: Enforce strict team cap
    // =========================================================================
    const totalCandidates = teamsToProcess.length;
    teamsToProcess = teamsToProcess.slice(0, MAX_TEAMS_PER_RUN);
    teamsToProcessCount = teamsToProcess.length;
    
    console.log(`[stats-refresh] ═══════════════════════════════════════════════════`);
    console.log(`[stats-refresh] 📋 PRIORITY BREAKDOWN:`);
    console.log(`[stats-refresh]    P1 (top league): ${p1Count} teams`);
    console.log(`[stats-refresh]    P2 (no cache):   ${p2Count} teams`);
    console.log(`[stats-refresh]    P3 (stale):      ${p3Count} teams`);
    console.log(`[stats-refresh]    TOTAL NEEDING:   ${totalCandidates} teams`);
    console.log(`[stats-refresh]    PROCESSING:      ${teamsToProcess.length} (cap=${MAX_TEAMS_PER_RUN})`);
    console.log(`[stats-refresh] ═══════════════════════════════════════════════════`);

    // =========================================================================
    // MAIN PROCESSING LOOP with soft time limit
    // =========================================================================
    for (let i = 0; i < teamsToProcess.length; i++) {
      const teamId = teamsToProcess[i];
      const loopStartMs = Date.now();
      const elapsedMs = loopStartMs - startedAt;
      const remainingMs = softDeadline - loopStartMs;
      
      scanned++;

      console.log(`[stats-refresh] ───────────────────────────────────────────────────`);
      console.log(`[stats-refresh] 🏃 Team ${i + 1}/${teamsToProcess.length}: ${teamId}`);
      console.log(`[stats-refresh]    Elapsed: ${elapsedMs}ms, Remaining: ${remainingMs}ms`);

      // SOFT TIME LIMIT CHECK: Stop gracefully if running long
      if (loopStartMs > softDeadline) {
        earlyExit = true;
        earlyExitReason = `soft_time_limit_at_team_${i}_of_${teamsToProcess.length}`;
        notes.push(`early_exit: hit ${SOFT_TIME_LIMIT_MS}ms limit at team ${i}/${teamsToProcess.length}`);
        console.warn(`[stats-refresh] ⏱️ SOFT EXIT: Time limit reached at team ${i}/${teamsToProcess.length}`);
        console.warn(`[stats-refresh]    Elapsed: ${elapsedMs}ms, Limit: ${SOFT_TIME_LIMIT_MS}ms`);
        break;
      }

      try {
        // Inter-team delay for rate limiting
        if (i > 0) {
          await sleep(INTER_TEAM_DELAY_MS);
        }

        const { result: stats, attempts, durationMs } = await computeWithRetry(teamId, supabase, 2, startedAt);

        const upsertStart = Date.now();
        const { error: upsertError } = await supabase.from("stats_cache").upsert({
          team_id: teamId,
          goals: stats.goals,
          cards: stats.cards,
          offsides: stats.offsides,
          corners: stats.corners,
          fouls: stats.fouls,
          sample_size: stats.sample_size,
          last_five_fixture_ids: stats.last_five_fixture_ids,
          last_final_fixture: stats.last_final_fixture,
          computed_at: new Date().toISOString(),
          source: "api-football",
        });
        const upsertDuration = Date.now() - upsertStart;

        const teamTotalMs = Date.now() - loopStartMs;
        
        if (upsertError) {
          failed++;
          teamTimings.push({ teamId, durationMs: teamTotalMs, attempts, success: false });
          notes.push(`team_${teamId}: upsert_error`);
          console.error(`[stats-refresh] ❌ Team ${teamId}: upsert FAILED (${upsertError.message})`);
        } else {
          upserted++;
          teamTimings.push({ teamId, durationMs: teamTotalMs, attempts, success: true });
          console.log(`[stats-refresh] ✅ Team ${teamId}: DONE in ${teamTotalMs}ms (compute=${durationMs}ms, upsert=${upsertDuration}ms)`);
        }

      } catch (error: any) {
        failed++;
        const teamTotalMs = Date.now() - loopStartMs;
        teamTimings.push({ teamId, durationMs: teamTotalMs, attempts: 3, success: false });
        const errMsg = error?.message || String(error);
        notes.push(`team_${teamId}: ${errMsg.slice(0, 50)}`);
        console.error(`[stats-refresh] ❌ Team ${teamId}: FAILED after ${teamTotalMs}ms: ${errMsg.slice(0, 100)}`);
      }
    }

    // =========================================================================
    // TIMING SUMMARY
    // =========================================================================
    if (teamTimings.length > 0) {
      const successTimings = teamTimings.filter(t => t.success);
      const avgMs = successTimings.length > 0 
        ? Math.round(successTimings.reduce((s, t) => s + t.durationMs, 0) / successTimings.length)
        : 0;
      const minMs = successTimings.length > 0 ? Math.min(...successTimings.map(t => t.durationMs)) : 0;
      const maxMs = successTimings.length > 0 ? Math.max(...successTimings.map(t => t.durationMs)) : 0;
      
      console.log(`[stats-refresh] ═══════════════════════════════════════════════════`);
      console.log(`[stats-refresh] 📊 TIMING SUMMARY:`);
      console.log(`[stats-refresh]    Successful: ${successTimings.length}/${teamTimings.length}`);
      console.log(`[stats-refresh]    Min/Avg/Max: ${minMs}ms / ${avgMs}ms / ${maxMs}ms`);
      console.log(`[stats-refresh] ═══════════════════════════════════════════════════`);
    }

    // Calculate remaining work estimate
    const { count: freshCount } = await supabase
      .from("stats_cache")
      .select("*", { count: "exact", head: true })
      .in("team_id", allTeamIds)
      .gte("computed_at", statsTTL.toISOString());

    const remaining = Math.max(0, allTeamIds.length - (freshCount || 0));
    const coveragePct = allTeamIds.length > 0 ? Math.round(((freshCount || 0) / allTeamIds.length) * 100) : 0;

    const durationMs = Date.now() - startedAt;
    
    console.log(`[stats-refresh] ═══════════════════════════════════════════════════`);
    console.log(`[stats-refresh] 🏁 BATCH COMPLETE`);
    console.log(`[stats-refresh]    Upserted: ${upserted}, Failed: ${failed}`);
    console.log(`[stats-refresh]    Remaining: ${remaining} teams (${coveragePct}% coverage)`);
    console.log(`[stats-refresh]    Duration: ${durationMs}ms`);
    console.log(`[stats-refresh]    Early Exit: ${earlyExit ? 'YES - ' + earlyExitReason : 'NO'}`);
    console.log(`[stats-refresh] ═══════════════════════════════════════════════════`);

    return jsonResponse({
      ok: true,
      job: "stats-refresh",
      mode: "safe-machine-v2",
      config: {
        max_teams_per_run: MAX_TEAMS_PER_RUN,
        soft_time_limit_ms: SOFT_TIME_LIMIT_MS,
        window_hours,
        stats_ttl_hours,
        force,
      },
      result: {
        scanned,
        upserted,
        failed,
        early_exit: earlyExit,
        early_exit_reason: earlyExitReason || null,
        remaining_estimate: remaining,
        coverage_pct: coveragePct,
        duration_ms: durationMs,
        timing_stats: teamTimings.length > 0 ? {
          min_ms: Math.min(...teamTimings.map(t => t.durationMs)),
          max_ms: Math.max(...teamTimings.map(t => t.durationMs)),
          avg_ms: Math.round(teamTimings.reduce((s, t) => s + t.durationMs, 0) / teamTimings.length),
        } : null,
      },
      message: earlyExit 
        ? `Stopped early (${earlyExitReason}): ${upserted} processed, ${remaining} remaining`
        : `Processed ${upserted} teams, ~${remaining} remaining (${coveragePct}% coverage)`,
    }, origin, 200, req);

  } catch (error: any) {
    const errMsg = error?.message || String(error);
    notes.push(`global_error: ${errMsg.slice(0, 100)}`);
    console.error("[stats-refresh] ❌ HANDLER ERROR:", errMsg);
    return errorResponse(`Stats refresh failed: ${errMsg}`, origin, 500, req);

  } finally {
    // =========================================================================
    // SAFE MACHINE MODE v2: ALWAYS log to optimizer_run_logs
    // =========================================================================
    if (supabase && windowStart && windowEnd) {
      try {
        const finishedAt = new Date();
        const durationMs = Date.now() - startedAt;

        const { error: logError } = await supabase.from("optimizer_run_logs").insert({
          id: crypto.randomUUID(),
          run_type: "stats-refresh-batch",
          window_start: windowStart.toISOString(),
          window_end: windowEnd.toISOString(),
          scope: {
            mode: "safe-machine-v2",
            max_teams_per_run: MAX_TEAMS_PER_RUN,
            soft_time_limit_ms: SOFT_TIME_LIMIT_MS,
            window_hours,
            stats_ttl_hours,
            force,
            early_exit: earlyExit,
            early_exit_reason: earlyExitReason || null,
            teams_attempted: teamsToProcessCount,
            timing_samples: teamTimings.slice(0, 5).map(t => ({
              team: t.teamId,
              ms: t.durationMs,
              ok: t.success
            })),
          },
          scanned,
          with_odds: 0,
          upserted,
          skipped: scanned - upserted - failed,
          failed,
          started_at: new Date(startedAt).toISOString(),
          finished_at: finishedAt.toISOString(),
          duration_ms: durationMs,
          notes: notes.length > 0 ? notes.slice(0, 10).join(" | ") : null,
        });

        if (logError) {
          console.error("[stats-refresh] ⚠️ Failed to write run log:", logError.message);
        } else {
          console.log(`[stats-refresh] 📝 Run logged: scanned=${scanned}, upserted=${upserted}, failed=${failed}, duration=${durationMs}ms`);
        }
      } catch (logErr: any) {
        console.error("[stats-refresh] ⚠️ Exception writing log:", logErr.message);
      }
    } else {
      console.warn("[stats-refresh] ⚠️ Cannot log run: missing supabase/windowStart/windowEnd");
    }

    // Release lock if acquired
    if (lockAcquired && supabase) {
      try {
        await supabase.rpc("release_cron_lock", { p_job_name: "stats-refresh" });
        console.log("[stats-refresh] 🔓 Lock released");
      } catch (releaseErr: any) {
        console.error("[stats-refresh] ⚠️ Failed to release lock:", releaseErr.message);
      }
    }
  }
});
