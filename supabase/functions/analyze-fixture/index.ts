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
  sample_size: number;
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

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log(`[analyze-fixture] Analyzing fixture ${fixtureId}`);

    // Check analysis cache (2h TTL)
    const { data: cachedAnalysis } = await supabaseClient
      .from("analysis_cache")
      .select("*")
      .eq("fixture_id", fixtureId)
      .gte("computed_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .single();

    if (cachedAnalysis) {
      console.log(`[analyze-fixture] Cache hit for fixture ${fixtureId}`);
      return new Response(
        JSON.stringify({ ...cachedAnalysis.summary_json, cache_hit: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[analyze-fixture] Cache miss for fixture ${fixtureId}`);

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

    console.log(`[analyze-fixture] Fetching stats for teams ${homeTeamId} and ${awayTeamId}`);

    // Fetch stats from cache or compute
    const [homeStats, awayStats] = await Promise.all([
      getTeamStats(homeTeamId, supabaseClient, API_KEY),
      getTeamStats(awayTeamId, supabaseClient, API_KEY),
    ]);

    // Compute combined stats
    const combined: Omit<TeamStats, 'sample_size'> = {
      goals: (homeStats.goals + awayStats.goals) / 2,
      cards: (homeStats.cards + awayStats.cards) / 2,
      offsides: (homeStats.offsides + awayStats.offsides) / 2,
      corners: (homeStats.corners + awayStats.corners) / 2,
      fouls: (homeStats.fouls + awayStats.fouls) / 2,
    };

    // Determine staleness
    const minSampleSize = Math.min(homeStats.sample_size, awayStats.sample_size);
    const isStale = minSampleSize < 5;

    const analysis = {
      home: {
        id: homeTeamId,
        name: fixture.teams_home.name,
        logo: fixture.teams_home.logo,
        stats: homeStats,
      },
      away: {
        id: awayTeamId,
        name: fixture.teams_away.name,
        logo: fixture.teams_away.logo,
        stats: awayStats,
      },
      combined,
      is_stale: isStale,
      computed_at: new Date().toISOString(),
      cache_hit: false,
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

    console.log(`[analyze-fixture] Analysis complete for fixture ${fixtureId}`);

    return new Response(
      JSON.stringify(analysis),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[analyze-fixture] Error:", error);
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

async function getTeamStats(
  teamId: number,
  supabaseClient: any,
  apiKey: string
): Promise<TeamStats> {
  // Check stats cache first (2h TTL, min sample size 3)
  const { data: cachedStats } = await supabaseClient
    .from("stats_cache")
    .select("*")
    .eq("team_id", teamId)
    .gte("computed_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .single();

  if (cachedStats && cachedStats.sample_size >= 3) {
    console.log(`[getTeamStats] Cache hit for team ${teamId}`);
    return {
      goals: Number(cachedStats.goals),
      cards: Number(cachedStats.cards),
      offsides: Number(cachedStats.offsides),
      corners: Number(cachedStats.corners),
      fouls: Number(cachedStats.fouls),
      sample_size: cachedStats.sample_size,
    };
  }

  console.log(`[getTeamStats] Cache miss for team ${teamId}, computing from API`);

  // Compute from API-Football
  const stats = await computeTeamStatsFromAPI(teamId, apiKey);

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

  return stats;
}

async function computeTeamStatsFromAPI(teamId: number, apiKey: string): Promise<TeamStats> {
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
      return { goals: 0, cards: 0, offsides: 0, corners: 0, fouls: 0, sample_size: 0 };
    }

    let totalGoals = 0;
    let totalCards = 0;
    let totalOffsides = 0;
    let totalCorners = 0;
    let totalFouls = 0;
    let count = 0;

    for (const match of data.response) {
      const isHome = match.teams.home.id === teamId;
      
      // Get statistics for this match
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
            
            const goals = match.goals[isHome ? "home" : "away"] || 0;
            const yellowCards = getStatValue(stats, "Yellow Cards");
            const redCards = getStatValue(stats, "Red Cards");
            const cards = yellowCards + redCards;
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
      return { goals: 0, cards: 0, offsides: 0, corners: 0, fouls: 0, sample_size: 0 };
    }

    return {
      goals: totalGoals / count,
      cards: totalCards / count,
      offsides: totalOffsides / count,
      corners: totalCorners / count,
      fouls: totalFouls / count,
      sample_size: count,
    };
  } catch (error) {
    console.error(`[computeTeamStatsFromAPI] Error for team ${teamId}:`, error);
    return { goals: 0, cards: 0, offsides: 0, corners: 0, fouls: 0, sample_size: 0 };
  }
}

function getStatValue(stats: any[], type: string): number {
  const stat = stats.find((s) => s.type === type);
  if (!stat || stat.value === null) return 0;
  return parseInt(stat.value) || 0;
}
