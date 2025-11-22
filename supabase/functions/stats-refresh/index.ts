// ============================================================================
// stats-refresh Edge Function (BATCH MODE)
// ============================================================================
// Refreshes team statistics cache in small resumable batches.
// Each invocation processes up to 150 teams with oldest/stale stats.
// 
// Redesigned 2025-11-22: Batch processing to avoid Edge function timeouts
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeLastFiveAverages } from "../_shared/stats.ts";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

// Batch size per invocation (tuned to stay under ~50s execution time)
const BATCH_SIZE = 150;

// Simple delay helper
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Compute with retry wrapper
async function computeWithRetry(teamId: number, retries = 3) {
  let attempt = 0;
  while (true) {
    try {
      return await computeLastFiveAverages(teamId);
    } catch (e) {
      if (attempt < retries) {
        const delay = 800 * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
        console.warn(`[stats-refresh] compute team ${teamId} failed, retrying in ${delay}ms`);
        await sleep(delay);
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return handlePreflight(origin, req);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseKey || !supabaseAnonKey) {
      return errorResponse("Missing required environment variables", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request body
    let window_hours = 120;
    let stats_ttl_hours = 24;
    let force = false;
    
    try {
      const body = await req.json();
      if (body.window_hours) window_hours = parseInt(body.window_hours);
      if (body.stats_ttl_hours) stats_ttl_hours = parseInt(body.stats_ttl_hours);
      if (typeof body.force === 'boolean') force = body.force;
      console.log(`[stats-refresh] window_hours=${window_hours}, stats_ttl_hours=${stats_ttl_hours}, force=${force}`);
    } catch (e) {
      console.log('[stats-refresh] Using defaults');
    }

    // Auth check
    const cronKeyHeader = req.headers.get('x-cron-key');
    const authHeader = req.headers.get('authorization');
    
    let isAuthorized = false;

    if (cronKeyHeader) {
      const { data: dbKey } = await supabase.rpc("get_cron_internal_key").single();
      if (dbKey && cronKeyHeader === dbKey) {
        isAuthorized = true;
        console.log("[stats-refresh] Authorized via X-CRON-KEY");
      }
    }

    if (!isAuthorized && authHeader) {
      if (authHeader === `Bearer ${supabaseKey}`) {
        isAuthorized = true;
        console.log("[stats-refresh] Authorized via service role");
      } else {
        const userClient = createClient(
          supabaseUrl,
          supabaseAnonKey,
          { global: { headers: { Authorization: authHeader } } }
        );

        const { data: isWhitelisted, error: whitelistError } = await userClient
          .rpc('is_user_whitelisted')
          .single();

        if (whitelistError || !isWhitelisted) {
          return errorResponse("Forbidden: Admin access required", origin, 403, req);
        }

        isAuthorized = true;
        console.log("[stats-refresh] Authorized via admin user");
      }
    }

    if (!isAuthorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }

    // Acquire lock
    const { data: lockAcquired, error: lockError } = await supabase.rpc("acquire_cron_lock", {
      p_job_name: "stats-refresh",
      p_duration_minutes: 15,
    });

    if (lockError) {
      return errorResponse("Failed to acquire lock", origin, 500, req);
    }

    if (!lockAcquired) {
      return jsonResponse(
        {
          ok: true,
          job: "stats-refresh",
          mode: "batch",
          statsResult: "already-running",
          reason: "LOCK_HELD",
          message: "Stats refresh is already running",
        },
        origin,
        200,
        req,
      );
    }

    // Lock acquired - process batch
    const startTime = Date.now();
    let processed = 0;
    let failed = 0;

    try {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + window_hours * 60 * 60 * 1000);
      const statsTTL = new Date(now.getTime() - stats_ttl_hours * 60 * 60 * 1000);

      // Get upcoming fixtures to identify teams we care about
      const { data: upcomingFixtures } = await supabase
        .from("fixtures")
        .select("id, teams_home, teams_away")
        .gte("timestamp", Math.floor(now.getTime() / 1000))
        .lte("timestamp", Math.floor(windowEnd.getTime() / 1000));

      // Extract unique team IDs
      const teamIds = new Set<number>();
      for (const fixture of upcomingFixtures || []) {
        const homeId = (fixture as any).teams_home?.id;
        const awayId = (fixture as any).teams_away?.id;
        if (homeId) teamIds.add(homeId);
        if (awayId) teamIds.add(awayId);
      }

      console.log(`[stats-refresh] Found ${teamIds.size} teams in window`);

      // Query stats_cache to find teams needing refresh
      // Priority: teams with no cache OR oldest cache first
      const { data: cachedTeams } = await supabase
        .from("stats_cache")
        .select("team_id, computed_at")
        .in("team_id", Array.from(teamIds))
        .order("computed_at", { ascending: true, nullsFirst: true });

      const cachedTeamIds = new Set((cachedTeams || []).map(t => t.team_id));
      
      // Teams to process: uncached + stale cached (up to BATCH_SIZE)
      const teamsToProcess: number[] = [];

      // First, add teams with no cache
      for (const teamId of teamIds) {
        if (!cachedTeamIds.has(teamId)) {
          teamsToProcess.push(teamId);
          if (teamsToProcess.length >= BATCH_SIZE) break;
        }
      }

      // Then add stale cached teams (oldest first)
      if (teamsToProcess.length < BATCH_SIZE) {
        for (const cached of cachedTeams || []) {
          if (teamsToProcess.length >= BATCH_SIZE) break;
          
          const needsRefresh = force || 
            !cached.computed_at || 
            new Date(cached.computed_at) < statsTTL;
          
          if (needsRefresh) {
            teamsToProcess.push(cached.team_id);
          }
        }
      }

      console.log(`[stats-refresh] Selected ${teamsToProcess.length} teams to process (batch size: ${BATCH_SIZE})`);

      // Process selected teams
      for (let i = 0; i < teamsToProcess.length; i++) {
        const teamId = teamsToProcess[i];
        
        try {
          // Rate limit: ~1.3s between requests
          if (i > 0 && i % 10 === 0) {
            await sleep(1300);
          }

          const stats = await computeWithRetry(teamId);

          await supabase.from("stats_cache").upsert({
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

          processed++;
          
          if (processed % 20 === 0) {
            console.log(`[stats-refresh] Progress: ${processed}/${teamsToProcess.length}`);
          }
        } catch (error) {
          console.error(`[stats-refresh] Failed team ${teamId}:`, error);
          failed++;
        }
      }

      // Estimate remaining work
      const { count: totalCached } = await supabase
        .from("stats_cache")
        .select("*", { count: "exact", head: true })
        .in("team_id", Array.from(teamIds))
        .gte("computed_at", statsTTL.toISOString());

      const remaining = Math.max(0, teamIds.size - (totalCached || 0));

      const duration = Date.now() - startTime;
      console.log(`[stats-refresh] Batch complete: ${processed} processed, ${failed} failed, ~${remaining} remaining, ${duration}ms`);

      // Log to optimizer_run_logs
      await supabase.from("optimizer_run_logs").insert({
        id: crypto.randomUUID(),
        run_type: "stats-refresh-batch",
        window_start: now.toISOString(),
        window_end: windowEnd.toISOString(),
        scope: { 
          batch_size: BATCH_SIZE,
          window_hours, 
          stats_ttl_hours,
          force,
        },
        scanned: teamsToProcess.length,
        with_odds: 0,
        upserted: processed,
        skipped: 0,
        failed: failed,
        started_at: now.toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: duration,
      });

      return jsonResponse(
        {
          ok: true,
          job: "stats-refresh",
          mode: "batch",
          window_hours,
          stats_ttl_hours,
          force,
          processed,
          failed,
          remaining_estimate: remaining,
          duration_ms: duration,
          message: `Processed ${processed} teams, ~${remaining} remaining for this window`,
        },
        origin,
        200,
        req,
      );

    } catch (error) {
      console.error("[stats-refresh] Batch job error:", error);
      return errorResponse(`Batch job failed: ${error}`, origin, 500, req);
    } finally {
      // Always release lock
      try {
        await supabase.rpc("release_cron_lock", { p_job_name: "stats-refresh" });
        console.log("[stats-refresh] Released lock");
      } catch (e) {
        console.error("[stats-refresh] Failed to release lock:", e);
      }
    }

  } catch (error) {
    console.error("[stats-refresh] Handler error:", error);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
