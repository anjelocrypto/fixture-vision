import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FilterCriteria {
  goals?: number;
  cards?: number;
  corners?: number;
  fouls?: number;
  offsides?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { leagueIds, date, markets, thresholds } = await req.json();
    
    const API_KEY = Deno.env.get("API_FOOTBALL_KEY");
    if (!API_KEY) {
      throw new Error("API_FOOTBALL_KEY not configured");
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log(`[filterizer-query] Filtering fixtures for date ${date}`);

    // Get fixtures for the specified date and leagues
    let query = supabaseClient
      .from("fixtures")
      .select("*")
      .eq("date", date);

    if (leagueIds && leagueIds.length > 0) {
      query = query.in("league_id", leagueIds);
    }

    const { data: fixtures, error: fixturesError } = await query;

    if (fixturesError) {
      throw fixturesError;
    }

    if (!fixtures || fixtures.length === 0) {
      return new Response(
        JSON.stringify({ fixtures: [], filtered_count: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[filterizer-query] Found ${fixtures.length} fixtures, applying filters`);

    // Filter fixtures based on thresholds
    const filteredFixtures = [];

    for (const fixture of fixtures) {
      const homeTeamId = fixture.teams_home.id;
      const awayTeamId = fixture.teams_away.id;

      // Get stats for both teams
      const { data: homeStats } = await supabaseClient
        .from("stats_cache")
        .select("*")
        .eq("team_id", homeTeamId)
        .single();

      const { data: awayStats } = await supabaseClient
        .from("stats_cache")
        .select("*")
        .eq("team_id", awayTeamId)
        .single();

      // Skip if stats not available
      if (!homeStats || !awayStats) {
        continue;
      }

      // Calculate combined averages
      const combined = {
        goals: (Number(homeStats.goals) + Number(awayStats.goals)) / 2,
        cards: (Number(homeStats.cards) + Number(awayStats.cards)) / 2,
        corners: (Number(homeStats.corners) + Number(awayStats.corners)) / 2,
        fouls: (Number(homeStats.fouls) + Number(awayStats.fouls)) / 2,
        offsides: (Number(homeStats.offsides) + Number(awayStats.offsides)) / 2,
      };

      // Apply threshold filters
      let passes = true;

      if (markets && Array.isArray(markets)) {
        for (const market of markets) {
          const threshold = thresholds[market];
          if (threshold !== undefined && threshold !== null) {
            if (combined[market as keyof typeof combined] < threshold) {
              passes = false;
              break;
            }
          }
        }
      }

      if (passes) {
        filteredFixtures.push({
          ...fixture,
          stat_preview: {
            combined,
            home: {
              goals: Number(homeStats.goals),
              cards: Number(homeStats.cards),
              corners: Number(homeStats.corners),
              fouls: Number(homeStats.fouls),
              offsides: Number(homeStats.offsides),
            },
            away: {
              goals: Number(awayStats.goals),
              cards: Number(awayStats.cards),
              corners: Number(awayStats.corners),
              fouls: Number(awayStats.fouls),
              offsides: Number(awayStats.offsides),
            },
          },
        });
      }
    }

    console.log(`[filterizer-query] Filtered to ${filteredFixtures.length} fixtures`);

    return new Response(
      JSON.stringify({
        fixtures: filteredFixtures,
        filtered_count: filteredFixtures.length,
        total_count: fixtures.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[filterizer-query] Error:", error);
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
