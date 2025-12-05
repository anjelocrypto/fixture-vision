// ============================================================================
// stats-refresh Edge Function (BATCH MODE)
// ============================================================================
// Refreshes team statistics cache in small resumable batches.
// Each invocation processes up to 150 teams with oldest/stale stats.
// 
// Redesigned 2025-11-22: Batch processing to avoid Edge function timeouts
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { computeLastFiveAverages } from "../_shared/stats.ts";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

// Validation schema for admin request parameters
const AdminRequestSchema = z.object({
  window_hours: z.number().int().min(1).max(720).optional(),
  stats_ttl_hours: z.number().int().min(1).max(168).optional(),
  force: z.boolean().optional(),
});

// Batch size per invocation (tuned to stay under 60s Edge Function timeout)
// With ~1.25s per team, 25 teams = ~31s (safe margin)
// Updated 2025-11-22: Added season-aware stats fetching with enhanced debug logging
// Updated 2025-12-05: Added TOP_LEAGUE priority to ensure 100% coverage for major leagues
const BATCH_SIZE = 25;

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

// Simple delay helper
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// P1 FIX: Improved retry logic with more attempts and longer delays for better rate limit handling
async function computeWithRetry(teamId: number, supabase: any, retries = 5) {
  let attempt = 0;
  while (true) {
    try {
      return await computeLastFiveAverages(teamId, supabase);
    } catch (e) {
      if (attempt < retries) {
        // Longer base delay (2000ms vs 800ms) for better rate limit handling
        const delay = 2000 * Math.pow(2, attempt) + Math.floor(Math.random() * 1000);
        console.warn(`[stats-refresh] compute team ${teamId} failed (attempt ${attempt + 1}/${retries}), retrying in ${delay}ms`);
        await sleep(delay);
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? null;
  
  // Debug: Log every request
  console.log(`[stats-refresh] Request: ${req.method}, origin: ${origin || '(none)'}`);
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    console.log('[stats-refresh] OPTIONS preflight');
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

    // Parse and validate request body
    let window_hours = 120;
    let stats_ttl_hours = 24;
    let force = false;
    
    try {
      const body = await req.json().catch(() => ({}));
      const parsed = AdminRequestSchema.parse(body);
      
      if (parsed.window_hours !== undefined) window_hours = parsed.window_hours;
      if (parsed.stats_ttl_hours !== undefined) stats_ttl_hours = parsed.stats_ttl_hours;
      if (parsed.force !== undefined) force = parsed.force;
      
      console.log(`[stats-refresh] window_hours=${window_hours}, stats_ttl_hours=${stats_ttl_hours}, force=${force}`);
    } catch (e: any) {
      if (e.errors) {
        // Zod validation error
        console.error("[stats-refresh] Invalid request body:", e.errors);
        return new Response(
          JSON.stringify({
            error: "Invalid request body",
            details: e.errors,
          }),
          {
            status: 422,
            headers: { ...getCorsHeaders(origin, req), "Content-Type": "application/json" },
          }
        );
      }
      // JSON parse error - use defaults
      console.log('[stats-refresh] Using defaults (invalid JSON)');
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
      // Join with league_id to enable priority sorting
      const { data: upcomingFixtures } = await supabase
        .from("fixtures")
        .select("id, league_id, teams_home, teams_away")
        .gte("timestamp", Math.floor(now.getTime() / 1000))
        .lte("timestamp", Math.floor(windowEnd.getTime() / 1000));

      // Extract unique team IDs with league info for priority sorting
      const teamLeagueMap = new Map<number, Set<number>>(); // team_id -> Set of league_ids
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

      const teamIds = new Set<number>(teamLeagueMap.keys());
      console.log(`[stats-refresh] Found ${teamIds.size} teams in window`);

      // Query stats_cache to find teams needing refresh
      const { data: cachedTeams } = await supabase
        .from("stats_cache")
        .select("team_id, computed_at, sample_size")
        .in("team_id", Array.from(teamIds))
        .order("computed_at", { ascending: true, nullsFirst: true });

      const cacheMap = new Map((cachedTeams || []).map(t => [t.team_id, t]));
      
      // Helper: Check if team is in TOP leagues
      const isTopLeagueTeam = (teamId: number): boolean => {
        const leagues = teamLeagueMap.get(teamId);
        if (!leagues) return false;
        return TOP_LEAGUE_IDS.some(lid => leagues.has(lid));
      };

      // Helper: Check if team needs refresh
      const needsRefresh = (teamId: number): boolean => {
        const cached = cacheMap.get(teamId);
        if (!cached) return true; // No cache
        if (force) return true;
        if (!cached.computed_at) return true;
        if (new Date(cached.computed_at) < statsTTL) return true;
        return false;
      };

      // Helper: Check if team has weak stats (sample < 5)
      const hasWeakStats = (teamId: number): boolean => {
        const cached = cacheMap.get(teamId);
        return !cached || cached.sample_size < 5;
      };

      // NEW PRIORITY ORDER:
      // 1. TOP league teams with NO cache or weak stats (sample < 5)
      // 2. TOP league teams with stale cache
      // 3. Other teams with no cache
      // 4. Other teams with stale cache
      const teamsToProcess: number[] = [];
      const addedTeams = new Set<number>();

      // Priority 1: TOP league teams needing cache or with weak stats
      for (const teamId of teamIds) {
        if (teamsToProcess.length >= BATCH_SIZE) break;
        if (isTopLeagueTeam(teamId) && (needsRefresh(teamId) || hasWeakStats(teamId))) {
          teamsToProcess.push(teamId);
          addedTeams.add(teamId);
        }
      }

      const topLeagueTeamsAdded = teamsToProcess.length;
      console.log(`[stats-refresh] Priority 1 (TOP leagues needing refresh): ${topLeagueTeamsAdded} teams`);

      // Priority 2: Other teams with no cache
      if (teamsToProcess.length < BATCH_SIZE) {
        for (const teamId of teamIds) {
          if (teamsToProcess.length >= BATCH_SIZE) break;
          if (addedTeams.has(teamId)) continue;
          if (!cacheMap.has(teamId)) {
            teamsToProcess.push(teamId);
            addedTeams.add(teamId);
          }
        }
      }

      // Priority 3: Other teams with stale cache (oldest first)
      if (teamsToProcess.length < BATCH_SIZE) {
        const sortedStale = (cachedTeams || [])
          .filter(t => !addedTeams.has(t.team_id) && needsRefresh(t.team_id))
          .sort((a, b) => {
            if (!a.computed_at) return -1;
            if (!b.computed_at) return 1;
            return new Date(a.computed_at).getTime() - new Date(b.computed_at).getTime();
          });

        for (const cached of sortedStale) {
          if (teamsToProcess.length >= BATCH_SIZE) break;
          teamsToProcess.push(cached.team_id);
          addedTeams.add(cached.team_id);
        }
      }

      console.log(`[stats-refresh] Selected ${teamsToProcess.length} teams to process (max batch size: ${BATCH_SIZE}, ~${Math.ceil(teamsToProcess.length * 1.25)}s estimated)`);

      // Process selected teams
      for (let i = 0; i < teamsToProcess.length; i++) {
        const teamId = teamsToProcess[i];
        
        try {
          // Rate limit: ~1.3s between requests
          if (i > 0 && i % 10 === 0) {
            await sleep(1300);
          }

          const stats = await computeWithRetry(teamId, supabase);

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
