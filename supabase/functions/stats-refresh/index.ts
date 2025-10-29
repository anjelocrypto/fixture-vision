import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchTeamLast5FixtureIds, computeLastFiveAverages } from "../_shared/stats.ts";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return handlePreflight(origin, req);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const apiKey = Deno.env.get("API_FOOTBALL_KEY");
    const cronKey = Deno.env.get("CRON_INTERNAL_KEY");

    if (!supabaseUrl || !supabaseKey || !apiKey) {
      throw new Error("Missing required environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request body for configurable params
    let window_hours = 120;
    let stats_ttl_hours = 24;
    
    try {
      const body = await req.json();
      if (body.window_hours) window_hours = parseInt(body.window_hours);
      if (body.stats_ttl_hours) stats_ttl_hours = parseInt(body.stats_ttl_hours);
    } catch {
      // Use defaults if no body or invalid JSON
    }

    // Authentication: Either internal cron call or whitelisted admin
    const authHeader = req.headers.get('authorization');
    const cronKeyHeader = req.headers.get('x-cron-key');
    
    let isAuthorized = false;

    // Check if it's an internal cron call
    if (cronKeyHeader && cronKey && cronKeyHeader === cronKey) {
      console.log("[stats-refresh] Authorized via CRON_INTERNAL_KEY");
      isAuthorized = true;
    } else if (authHeader) {
      // Check if user is whitelisted admin
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: userError } = await supabase.auth.getUser(token);
      
      if (userError || !user) {
        console.error("[stats-refresh] Auth failed:", userError?.message);
        return errorResponse("Unauthorized", origin, 401, req);
      }

      const { data: isWhitelisted, error: whitelistError } = await supabase
        .rpc('is_user_whitelisted');

      if (whitelistError || !isWhitelisted) {
        console.error("[stats-refresh] User not whitelisted");
        return errorResponse("Forbidden: Admin access required", origin, 403, req);
      }

      console.log("[stats-refresh] Authorized via whitelisted admin");
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return errorResponse("Unauthorized: Missing credentials", origin, 401, req);
    }

    console.log(`[stats-refresh] Starting stats refresh job (${window_hours}h window, ${stats_ttl_hours}h TTL)`);

    // Acquire mutex to prevent concurrent runs
    const { data: lockAcquired } = await supabase.rpc('acquire_cron_lock', {
      p_job_name: 'stats-refresh',
      p_duration_minutes: 15
    });

    if (!lockAcquired) {
      console.log("[stats-refresh] Another instance is already running, skipping");
      return jsonResponse({ 
        success: true, 
        skipped: true,
        reason: "Another stats-refresh is already running"
      }, origin, 200, req);
    }

    // Get upcoming fixtures
    const now = new Date();
    const startedAt = now;
    const windowEnd = new Date(now.getTime() + window_hours * 60 * 60 * 1000);
    const statsTTL = new Date(now.getTime() - stats_ttl_hours * 60 * 60 * 1000);

    const { data: upcomingFixtures, error: fixturesError } = await supabase
      .from("fixtures")
      .select("teams_home, teams_away")
      .gte("timestamp", Math.floor(now.getTime() / 1000))
      .lte("timestamp", Math.floor(windowEnd.getTime() / 1000));

    if (fixturesError) {
      throw fixturesError;
    }

    // Collect unique team IDs
    const teamIds = new Set<number>();
    for (const fixture of upcomingFixtures || []) {
      const homeId = fixture.teams_home?.id;
      const awayId = fixture.teams_away?.id;
      if (homeId) teamIds.add(homeId);
      if (awayId) teamIds.add(awayId);
    }

    console.log(`[stats-refresh] Found ${teamIds.size} unique teams in ${upcomingFixtures?.length || 0} upcoming fixtures`);

    let teamsScanned = 0;
    let teamsRefreshed = 0;
    let skippedTTL = 0;
    let apiCalls = 0;
    let failures = 0;

    // Process each team
    for (const teamId of teamIds) {
      teamsScanned++;
      
      try {
        // Check current cache with TTL
        const { data: cached } = await supabase
          .from("stats_cache")
          .select("*")
          .eq("team_id", teamId)
          .single();

        // Skip if updated within TTL window
        if (cached?.computed_at) {
          const lastUpdate = new Date(cached.computed_at);
          if (lastUpdate > statsTTL) {
            console.log(`[stats-refresh] Team ${teamId} cache is fresh (within ${stats_ttl_hours}h TTL)`);
            skippedTTL++;
            continue;
          }
        }

        // Fetch current last-5 fixture IDs
        const currentFixtureIds = await fetchTeamLast5FixtureIds(teamId);
        apiCalls++;

        // Compare with cached IDs - need refresh if IDs changed or missing
        const cachedIds = cached?.last_five_fixture_ids || [];
        const needsRefresh = 
          !cached || 
          cachedIds.length !== currentFixtureIds.length ||
          !cachedIds.every((id: number, idx: number) => id === currentFixtureIds[idx]);

        if (needsRefresh) {
          console.log(`[stats-refresh] Refreshing team ${teamId} (window changed or missing)`);
          
          const stats = await computeLastFiveAverages(teamId);
          apiCalls += stats.sample_size * 2; // Approximate API calls made

          // Upsert with updated_at timestamp
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
            source: 'api-football'
          });

          teamsRefreshed++;
        } else {
          console.log(`[stats-refresh] Team ${teamId} cache unchanged (same last-5 window)`);
          skippedTTL++;
        }
      } catch (error) {
        console.error(`[stats-refresh] Failed to process team ${teamId}:`, error);
        failures++;
      }
    }

    console.log("[stats-refresh] Job complete", {
      teamsScanned,
      teamsRefreshed,
      skippedTTL,
      apiCalls,
      failures,
    });

    // Release mutex
    await supabase.rpc('release_cron_lock', { p_job_name: 'stats-refresh' });

    // Log run to optimizer_run_logs
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    
    await supabase.from("optimizer_run_logs").insert({
      id: crypto.randomUUID(),
      run_type: "stats-refresh",
      window_start: now.toISOString(),
      window_end: windowEnd.toISOString(),
      scope: { 
        teams: teamIds.size, 
        window_hours, 
        stats_ttl_hours 
      },
      scanned: teamsScanned,
      with_odds: 0,
      upserted: teamsRefreshed,
      skipped: skippedTTL,
      failed: failures,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: durationMs,
    });

    return jsonResponse({
      success: true,
      window_hours,
      stats_ttl_hours,
      teamsScanned,
      teamsRefreshed,
      skippedTTL,
      apiCalls,
      failures,
      duration_ms: durationMs,
    }, origin, 200, req);

  } catch (error) {
    console.error("[stats-refresh] Error:", error);
    
    // Release mutex on error
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && supabaseKey) {
        const supabaseCleanup = createClient(supabaseUrl, supabaseKey);
        await supabaseCleanup.rpc('release_cron_lock', { p_job_name: 'stats-refresh' });
      }
    } catch (e) {
      console.error("[stats-refresh] Failed to release lock:", e);
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(errorMessage, origin, 500, req);
  }
});
