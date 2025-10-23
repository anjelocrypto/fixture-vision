import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const RequestSchema = z.object({
  leagueIds: z.array(z.number().int().positive()).optional(),
  date: z.string(),
  markets: z.array(z.enum(["goals", "cards", "corners", "fouls", "offsides"])).optional(),
  thresholds: z.record(z.number()).optional(),
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    // Validate input
    const bodyRaw = await req.json().catch(() => null);
    if (!bodyRaw) {
      return new Response(
        JSON.stringify({ error: "Invalid request body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const validation = RequestSchema.safeParse(bodyRaw);
    if (!validation.success) {
      console.error("[filterizer-query] Validation error:", validation.error.format());
      return new Response(
        JSON.stringify({ error: "Invalid request parameters" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
      );
    }

    const { leagueIds, date, markets, thresholds } = validation.data;

    console.log(`[filterizer-query] User ${user.id} filtering fixtures for date ${date}`);

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
      console.error("[filterizer-query] Error fetching fixtures:", fixturesError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch fixtures" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
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

      if (markets && thresholds) {
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
    console.error("[filterizer-query] Internal error:", {
      message: error instanceof Error ? error.message : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
