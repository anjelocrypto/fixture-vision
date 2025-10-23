import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TeamStats {
  goals: number;
  cards: number;
  offsides: number;
  corners: number;
  fouls: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fixtureId } = await req.json();
    
    const API_KEY = Deno.env.get("API_FOOTBALL_KEY");
    if (!API_KEY) {
      throw new Error("API_FOOTBALL_KEY not configured");
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Check analysis cache (2h)
    const { data: cachedAnalysis } = await supabaseClient
      .from("analysis_cache")
      .select("*")
      .eq("fixture_id", fixtureId)
      .gte("computed_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .single();

    if (cachedAnalysis) {
      console.log("Returning cached analysis");
      return new Response(
        JSON.stringify(cachedAnalysis.summary_json),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get fixture details
    const { data: fixture } = await supabaseClient
      .from("fixtures")
      .select("*")
      .eq("id", fixtureId)
      .single();

    if (!fixture) {
      throw new Error("Fixture not found");
    }

    const homeTeamId = fixture.teams_home.id;
    const awayTeamId = fixture.teams_away.id;

    // Fetch last 5 matches for each team
    console.log(`Fetching last 5 matches for teams ${homeTeamId} and ${awayTeamId}`);
    
    const [homeStats, awayStats] = await Promise.all([
      fetchTeamLast5Stats(homeTeamId, API_KEY),
      fetchTeamLast5Stats(awayTeamId, API_KEY),
    ]);

    // Compute combined stats
    const combined: TeamStats = {
      goals: (homeStats.goals + awayStats.goals) / 2,
      cards: (homeStats.cards + awayStats.cards) / 2,
      offsides: (homeStats.offsides + awayStats.offsides) / 2,
      corners: (homeStats.corners + awayStats.corners) / 2,
      fouls: (homeStats.fouls + awayStats.fouls) / 2,
    };

    const analysis = {
      home: {
        name: fixture.teams_home.name,
        logo: fixture.teams_home.logo,
        stats: homeStats,
      },
      away: {
        name: fixture.teams_away.name,
        logo: fixture.teams_away.logo,
        stats: awayStats,
      },
      combined,
      computed_at: new Date().toISOString(),
    };

    // Cache the analysis
    await supabaseClient
      .from("analysis_cache")
      .upsert(
        {
          fixture_id: fixtureId,
          summary_json: analysis,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "fixture_id" }
      );

    return new Response(
      JSON.stringify(analysis),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in analyze-fixture:", error);
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

async function fetchTeamLast5Stats(teamId: number, apiKey: string): Promise<TeamStats> {
  try {
    // Fetch last 5 completed fixtures for the team
    const response = await fetch(
      `https://v3.football.api-sports.io/fixtures?team=${teamId}&last=5&status=FT`,
      {
        headers: {
          "x-apisports-key": apiKey,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`API-Football error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.response || data.response.length === 0) {
      // Return zeros if no data
      return { goals: 0, cards: 0, offsides: 0, corners: 0, fouls: 0 };
    }

    let totalGoals = 0;
    let totalCards = 0;
    let totalOffsides = 0;
    let totalCorners = 0;
    let totalFouls = 0;
    let count = 0;

    for (const match of data.response) {
      const isHome = match.teams.home.id === teamId;
      const teamStats = isHome ? match.teams.home : match.teams.away;
      
      // Get statistics
      const statsResponse = await fetch(
        `https://v3.football.api-sports.io/fixtures/statistics?fixture=${match.fixture.id}`,
        {
          headers: {
            "x-apisports-key": apiKey,
          },
        }
      );

      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        if (statsData.response && statsData.response.length > 0) {
          const teamStatsData = statsData.response.find(
            (s: any) => s.team.id === teamId
          );
          
          if (teamStatsData && teamStatsData.statistics) {
            const stats = teamStatsData.statistics;
            
            // Extract stats
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
      return { goals: 0, cards: 0, offsides: 0, corners: 0, fouls: 0 };
    }

    return {
      goals: totalGoals / count,
      cards: totalCards / count,
      offsides: totalOffsides / count,
      corners: totalCorners / count,
      fouls: totalFouls / count,
    };
  } catch (error) {
    console.error(`Error fetching stats for team ${teamId}:`, error);
    return { goals: 0, cards: 0, offsides: 0, corners: 0, fouls: 0 };
  }
}

function getStatValue(stats: any[], type: string): number {
  const stat = stats.find((s) => s.type === type);
  if (!stat || stat.value === null) return 0;
  return parseInt(stat.value) || 0;
}
