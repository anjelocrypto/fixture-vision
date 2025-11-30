import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { computeLastFiveAverages, computeCombinedMetrics } from "../_shared/stats.ts";
import { fetchHeadToHeadStats } from "../_shared/h2h.ts";
import { getKeyAttackingInjuries } from "../_shared/injuries.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const RequestSchema = z.object({
  fixtureId: z.number().int().positive(),
  homeTeamId: z.number().int().positive(),
  awayTeamId: z.number().int().positive(),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
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
      console.error("[analyze-fixture] Validation error:", validation.error.format());
      return new Response(
        JSON.stringify({ error: "Invalid request parameters" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
      );
    }

    const { fixtureId, homeTeamId, awayTeamId } = validation.data;
    console.log(`[analyze-fixture] Analyzing fixture ${fixtureId}: home=${homeTeamId}, away=${awayTeamId}, user=${user.email}`);

    // Helper to get or compute team stats
    const getTeamStats = async (teamId: number) => {
      // Try cache first
      const { data: cached } = await supabaseClient
        .from("stats_cache")
        .select("*")
        .eq("team_id", teamId)
        .single();

      if (cached && cached.last_five_fixture_ids && cached.last_five_fixture_ids.length > 0) {
        // Check if cache is fresh (computed within last 2 hours)
        const cacheAge = Date.now() - new Date(cached.computed_at).getTime();
        const TWO_HOURS = 2 * 60 * 60 * 1000;
        if (cacheAge < TWO_HOURS) {
          console.log(`[analyze-fixture] Using cached stats for team ${teamId} (age: ${Math.round(cacheAge / 1000 / 60)}min)`);
          return cached;
        }
      }

    console.log(`[analyze-fixture] Cache miss or stale for team ${teamId}, computing fresh stats`);
    const freshStats = await computeLastFiveAverages(teamId, supabaseClient);

    // Upsert to cache
      await supabaseClient.from("stats_cache").upsert({
        team_id: freshStats.team_id,
        goals: freshStats.goals,
        cards: freshStats.cards,
        offsides: freshStats.offsides,
        corners: freshStats.corners,
        fouls: freshStats.fouls,
        sample_size: freshStats.sample_size,
        last_five_fixture_ids: freshStats.last_five_fixture_ids,
        last_final_fixture: freshStats.last_final_fixture,
        computed_at: new Date().toISOString(),
        source: 'api-football'
      });

      return freshStats;
    };

    // Fetch stats for both teams
    const [homeStats, awayStats] = await Promise.all([
      getTeamStats(homeTeamId),
      getTeamStats(awayTeamId)
    ]);

    // Fetch H2H stats
    console.log(`[analyze-fixture] Fetching H2H stats for teams ${homeTeamId} vs ${awayTeamId}`);
    const h2hStats = await fetchHeadToHeadStats(homeTeamId, awayTeamId, supabaseClient);

    // Fetch fixture data to get league and season
    const { data: fixture } = await supabaseClient
      .from("fixtures")
      .select("league_id, date")
      .eq("id", fixtureId)
      .single();

    const leagueId = fixture?.league_id || 0;
    const fixtureDate = fixture?.date ? new Date(fixture.date) : new Date();
    const month = fixtureDate.getUTCMonth();
    const year = fixtureDate.getUTCFullYear();
    const season = (month >= 7) ? year : year - 1;

    // Fetch key attacking injuries for both teams
    console.log(`[analyze-fixture] Fetching injuries for fixture ${fixtureId}, league ${leagueId}, season ${season}`);
    const [homeInjuries, awayInjuries] = await Promise.all([
      getKeyAttackingInjuries(homeTeamId, leagueId, season, supabaseClient),
      getKeyAttackingInjuries(awayTeamId, leagueId, season, supabaseClient)
    ]);

    console.log(`[analyze-fixture] Injury status: home=${homeInjuries.length} key injuries, away=${awayInjuries.length} key injuries`);

    // Compute combined stats using v2 formula with importance-weighted injury impact
    const combined = computeCombinedMetrics(homeStats, awayStats, { 
      homeInjuries: homeInjuries.map(inj => ({ importance: inj.importance })),
      awayInjuries: awayInjuries.map(inj => ({ importance: inj.importance }))
    });

    console.log(`[analyze-fixture] Returning stats for fixture ${fixtureId}:`, {
      home: { team_id: homeStats.team_id, goals: homeStats.goals, sample_size: homeStats.sample_size },
      away: { team_id: awayStats.team_id, goals: awayStats.goals, sample_size: awayStats.sample_size },
      user: user.email
    });

    return new Response(
      JSON.stringify({
        home: {
          team_id: homeStats.team_id,
          goals: homeStats.goals,
          corners: homeStats.corners,
          cards: homeStats.cards,
          fouls: homeStats.fouls,
          offsides: homeStats.offsides,
          sample_size: homeStats.sample_size,
          computed_at: homeStats.computed_at
        },
        away: {
          team_id: awayStats.team_id,
          goals: awayStats.goals,
          corners: awayStats.corners,
          cards: awayStats.cards,
          fouls: awayStats.fouls,
          offsides: awayStats.offsides,
          sample_size: awayStats.sample_size,
          computed_at: awayStats.computed_at
        },
        h2h: h2hStats ? {
          goals: h2hStats.goals,
          corners: h2hStats.corners,
          cards: h2hStats.cards,
          fouls: h2hStats.fouls,
          offsides: h2hStats.offsides,
          sample_size: h2hStats.sample_size
        } : null,
        injuries: {
          home: homeInjuries,
          away: awayInjuries
        },
        combined
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[analyze-fixture] Internal error:", {
      message: error instanceof Error ? error.message : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
