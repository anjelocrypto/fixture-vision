import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchTeamLast5FixtureIds, computeLastFiveAverages } from "../_shared/stats.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const apiKey = Deno.env.get("API_FOOTBALL_KEY");

    if (!supabaseUrl || !supabaseKey || !apiKey) {
      throw new Error("Missing required environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("[stats-refresh] Starting stats refresh job");

    // Get upcoming fixtures (next 72 hours)
    const now = new Date();
    const startedAt = now;
    const next72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);

    const { data: upcomingFixtures, error: fixturesError } = await supabase
      .from("fixtures")
      .select("teams_home, teams_away")
      .gte("timestamp", Math.floor(now.getTime() / 1000))
      .lte("timestamp", Math.floor(next72h.getTime() / 1000));

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
    let apiCalls = 0;
    let failures = 0;

    // Process each team
    for (const teamId of teamIds) {
      teamsScanned++;
      
      try {
        // Check current cache
        const { data: cached } = await supabase
          .from("stats_cache")
          .select("*")
          .eq("team_id", teamId)
          .single();

        // Fetch current last-5 fixture IDs
        const currentFixtureIds = await fetchTeamLast5FixtureIds(teamId);
        apiCalls++;

        // Compare with cached IDs - need refresh if IDs changed
        const cachedIds = cached?.last_five_fixture_ids || [];
        const needsRefresh = 
          !cached || 
          cachedIds.length !== currentFixtureIds.length ||
          !cachedIds.every((id: number, idx: number) => id === currentFixtureIds[idx]);

        if (needsRefresh) {
          console.log(`[stats-refresh] Refreshing team ${teamId} (window changed)`);
          
          const stats = await computeLastFiveAverages(teamId);
          apiCalls += stats.sample_size * 2; // Approximate API calls made

          // Upsert with new columns
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
          console.log(`[stats-refresh] Team ${teamId} cache is fresh (same last-5 window)`);
        }
      } catch (error) {
        console.error(`[stats-refresh] Failed to process team ${teamId}:`, error);
        failures++;
      }
    }

    console.log("[stats-refresh] Job complete", {
      teamsScanned,
      teamsRefreshed,
      apiCalls,
      failures,
    });

    // Log run to optimizer_run_logs
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    
    await supabase.from("optimizer_run_logs").insert({
      id: crypto.randomUUID(),
      run_type: "stats-refresh",
      window_start: now.toISOString(),
      window_end: next72h.toISOString(),
      scope: { teams: teamIds.size },
      scanned: teamsScanned,
      with_odds: 0,
      upserted: teamsRefreshed,
      skipped: teamsScanned - teamsRefreshed - failures,
      failed: failures,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: durationMs,
    });

    return new Response(
      JSON.stringify({
        success: true,
        teamsScanned,
        teamsRefreshed,
        apiCalls,
        failures,
        duration_ms: durationMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[stats-refresh] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
