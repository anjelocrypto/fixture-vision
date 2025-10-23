import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_TEAMS_PER_RUN = 400;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const API_KEY = Deno.env.get("API_FOOTBALL_KEY");
    if (!API_KEY) {
      throw new Error("API_FOOTBALL_KEY not configured");
    }

    // Detect if this is a RapidAPI key
    const isRapidAPI = API_KEY.includes("jsn") || API_KEY.length > 40;

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log("[stats-refresh] Starting stats refresh job");

    // Get fixtures in the next 72 hours
    const nowDate = new Date();
    const in72Hours = new Date(nowDate.getTime() + 72 * 60 * 60 * 1000);
    
    const { data: upcomingFixtures, error: fixturesError } = await supabaseClient
      .from("fixtures")
      .select("*")
      .gte("date", nowDate.toISOString().split('T')[0])
      .lte("date", in72Hours.toISOString().split('T')[0]);

    if (fixturesError) {
      throw fixturesError;
    }

    if (!upcomingFixtures || upcomingFixtures.length === 0) {
      console.log("[stats-refresh] No upcoming fixtures found");
      return new Response(
        JSON.stringify({ message: "No upcoming fixtures", teams_scanned: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract unique team IDs
    const teamIds = new Set<number>();
    for (const fixture of upcomingFixtures) {
      teamIds.add(fixture.teams_home.id);
      teamIds.add(fixture.teams_away.id);
    }

    const uniqueTeams = Array.from(teamIds).slice(0, MAX_TEAMS_PER_RUN);

    console.log(`[stats-refresh] Found ${uniqueTeams.length} unique teams to process`);

    let teamsRefreshed = 0;
    let apiCallsMade = 0;
    let failures = 0;

    // Process each team
    for (const teamId of uniqueTeams) {
      try {
        // Check if cache is stale (>2h old)
        const { data: existingStats } = await supabaseClient
          .from("stats_cache")
          .select("*")
          .eq("team_id", teamId)
          .single();

        const isStale = !existingStats || 
          new Date(existingStats.computed_at).getTime() < Date.now() - 2 * 60 * 60 * 1000;

        if (!isStale) {
          console.log(`[stats-refresh] Team ${teamId} cache is fresh, skipping`);
          continue;
        }

        // Fetch and compute stats
        const stats = await computeTeamStats(teamId, API_KEY, isRapidAPI);
        apiCallsMade += stats.api_calls || 0;

        // Upsert to cache
        await supabaseClient
          .from("stats_cache")
          .upsert(
            {
              team_id: teamId,
              goals: stats.goals,
              cards: stats.cards,
              offsides: stats.offsides,
              corners: stats.corners,
              fouls: stats.fouls,
              sample_size: stats.sample_size,
              computed_at: new Date().toISOString(),
            },
            { onConflict: "team_id" }
          );

        teamsRefreshed++;
        console.log(`[stats-refresh] Refreshed team ${teamId}`);
      } catch (error) {
        console.error(`[stats-refresh] Failed to refresh team ${teamId}:`, error);
        failures++;
      }
    }

    const summary = {
      teams_scanned: uniqueTeams.length,
      teams_refreshed: teamsRefreshed,
      api_calls_made: apiCallsMade,
      failures,
      completed_at: new Date().toISOString(),
    };

    console.log("[stats-refresh] Job complete:", summary);

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[stats-refresh] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function computeTeamStats(teamId: number, apiKey: string, isRapidAPI: boolean) {
  let apiCalls = 0;
  
  try {
    // Fetch last 5 completed fixtures
    const url = isRapidAPI
      ? `https://api-football-v1.p.rapidapi.com/v3/fixtures?team=${teamId}&last=5&status=FT`
      : `https://v3.football.api-sports.io/fixtures?team=${teamId}&last=5&status=FT`;
    
    const headers: Record<string, string> = isRapidAPI
      ? {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": "api-football-v1.p.rapidapi.com"
        }
      : {
          "x-apisports-key": apiKey
        };
    
    const response = await fetch(url, { headers });
    apiCalls++;

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.response || data.response.length === 0) {
      return { goals: 0, cards: 0, offsides: 0, corners: 0, fouls: 0, sample_size: 0, api_calls: apiCalls };
    }

    let totalGoals = 0;
    let totalCards = 0;
    let totalOffsides = 0;
    let totalCorners = 0;
    let totalFouls = 0;
    let count = 0;

    for (const match of data.response) {
      const isHome = match.teams.home.id === teamId;
      
      const statsUrl = isRapidAPI
        ? `https://api-football-v1.p.rapidapi.com/v3/fixtures/statistics?fixture=${match.fixture.id}`
        : `https://v3.football.api-sports.io/fixtures/statistics?fixture=${match.fixture.id}`;
      
      const statsResponse = await fetch(statsUrl, { headers });
      apiCalls++;

      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        if (statsData.response && statsData.response.length > 0) {
          const teamStatsData = statsData.response.find(
            (s: any) => s.team.id === teamId
          );
          
          if (teamStatsData && teamStatsData.statistics) {
            const stats = teamStatsData.statistics;
            
            const goals = match.goals[isHome ? "home" : "away"] || 0;
            const cards = getStatValue(stats, "Yellow Cards") + getStatValue(stats, "Red Cards");
            const offsides = getStatValue(stats, "Offsides");
            const corners = getStatValue(stats, "Corner Kicks");
            const fouls = getStatValue(stats, "Fouls");
            
            totalGoals += goals;
            totalCards += cards;
            totalOffsides += offsides;
            totalCorners += corners;
            totalFouls += fouls;
            count++;
          }
        }
      }
    }

    if (count === 0) {
      return { goals: 0, cards: 0, offsides: 0, corners: 0, fouls: 0, sample_size: 0, api_calls: apiCalls };
    }

    return {
      goals: totalGoals / count,
      cards: totalCards / count,
      offsides: totalOffsides / count,
      corners: totalCorners / count,
      fouls: totalFouls / count,
      sample_size: count,
      api_calls: apiCalls,
    };
  } catch (error) {
    console.error(`Error computing stats for team ${teamId}:`, error);
    return { goals: 0, cards: 0, offsides: 0, corners: 0, fouls: 0, sample_size: 0, api_calls: apiCalls };
  }
}

function getStatValue(stats: any[], type: string): number {
  const stat = stats.find((s) => s.type === type);
  if (!stat || stat.value === null) return 0;
  return parseInt(stat.value) || 0;
}
