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
  minEdge: z.number().min(0).max(10).optional(),
  sortBy: z.enum(["edge", "confidence", "odds"]).optional(),
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

    const { leagueIds, date, markets, thresholds, minEdge = 0, sortBy = "edge" } = validation.data;

    console.log(`[filterizer-query] User ${user.id} filtering fixtures for date ${date}, minEdge: ${minEdge}%, sortBy: ${sortBy}`);

    // Calculate 7-day date window from the specified date
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7);
    endDate.setHours(23, 59, 59, 999);

    const nowTimestamp = Math.floor(Date.now() / 1000);
    const endTimestamp = Math.floor(endDate.getTime() / 1000);

    console.log(`[filterizer-query] Date window: ${startDate.toISOString()} to ${endDate.toISOString()} (upcoming only)`);

    // Get upcoming fixtures in the 7-day window
    let query = supabaseClient
      .from("fixtures")
      .select("*")
      .gte("date", date)
      .gte("timestamp", nowTimestamp)
      .lte("timestamp", endTimestamp);

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

    // Batch fetch all team stats to avoid N+1 queries
    const allTeamIds = fixtures.flatMap((f: any) => [f.teams_home?.id, f.teams_away?.id]).filter(Boolean);
    const uniqueTeamIds = [...new Set(allTeamIds)];

    console.log(`[filterizer-query] Batch fetching stats for ${uniqueTeamIds.length} unique teams`);

    const { data: allStats } = await supabaseClient
      .from("stats_cache")
      .select("*")
      .in("team_id", uniqueTeamIds);

    const statsMap = new Map();
    if (allStats) {
      for (const stat of allStats) {
        statsMap.set(stat.team_id, stat);
      }
    }

    // Batch fetch odds for edge calculation (if minEdge > 0)
    let oddsMap = new Map();
    if (minEdge > 0) {
      const fixtureIds = fixtures.map((f: any) => f.id);
      const { data: allOdds } = await supabaseClient
        .from("odds_cache")
        .select("fixture_id, payload")
        .in("fixture_id", fixtureIds);

      if (allOdds) {
        for (const odds of allOdds) {
          oddsMap.set(odds.fixture_id, odds.payload);
        }
      }
      console.log(`[filterizer-query] Fetched odds for ${oddsMap.size} fixtures`);
    }

    // Filter fixtures based on thresholds
    const candidateFixtures = [];

    for (const fixture of fixtures) {
      const homeTeamId = fixture.teams_home?.id;
      const awayTeamId = fixture.teams_away?.id;

      if (!homeTeamId || !awayTeamId) continue;

      const homeStats = statsMap.get(homeTeamId);
      const awayStats = statsMap.get(awayTeamId);

      // Skip if stats not available
      if (!homeStats || !awayStats) {
        console.log(`[filterizer-query] Skipping fixture ${fixture.id} - missing stats`);
        continue;
      }

      // Calculate combined values (SUM for match total, not average)
      const combined = {
        goals: Number(homeStats.goals) + Number(awayStats.goals),
        cards: Number(homeStats.cards) + Number(awayStats.cards),
        corners: Number(homeStats.corners) + Number(awayStats.corners),
        fouls: Number(homeStats.fouls) + Number(awayStats.fouls),
        offsides: Number(homeStats.offsides) + Number(awayStats.offsides),
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

      if (!passes) continue;

      // Calculate edge if minEdge filter is set
      let edge = null;
      let marketOdds = null;
      if (minEdge > 0 && oddsMap.has(fixture.id)) {
        // Simple edge calculation: we'll use the first available over market
        // In production, you'd match specific market/line from rules.ts
        const oddsPayload = oddsMap.get(fixture.id);
        const bookmakers = oddsPayload?.response?.[0]?.bookmakers || [];
        if (bookmakers.length > 0) {
          const bets = bookmakers[0]?.bets || [];
          const overMarket = bets.find((b: any) => b.name?.includes("Over/Under") || b.name?.includes("Goals"));
          if (overMarket?.values) {
            const overSelection = overMarket.values.find((v: any) => v.value?.includes("Over"));
            if (overSelection?.odd) {
              marketOdds = Number(overSelection.odd);
              const impliedProb = 1 / marketOdds;
              // Model probability from combined stats (simplified)
              const modelProb = Math.min(0.9, combined.goals / 10);
              edge = ((modelProb - impliedProb) / impliedProb) * 100;
            }
          }
        }
      }

      // Apply min edge filter
      if (minEdge > 0 && (edge === null || edge < minEdge)) {
        continue;
      }

      const sampleSize = Math.min(homeStats.sample_size || 0, awayStats.sample_size || 0);

      candidateFixtures.push({
        ...fixture,
        stat_preview: {
          combined,
          home: {
            goals: Number(homeStats.goals),
            cards: Number(homeStats.cards),
            corners: Number(homeStats.corners),
            fouls: Number(homeStats.fouls),
            offsides: Number(homeStats.offsides),
            sample_size: homeStats.sample_size || 0,
            computed_at: homeStats.computed_at,
          },
          away: {
            goals: Number(awayStats.goals),
            cards: Number(awayStats.cards),
            corners: Number(awayStats.corners),
            fouls: Number(awayStats.fouls),
            offsides: Number(awayStats.offsides),
            sample_size: awayStats.sample_size || 0,
            computed_at: awayStats.computed_at,
          },
          sample_size: sampleSize,
        },
        edge,
        market_odds: marketOdds,
      });
    }

    console.log(`[filterizer-query] After threshold filter: ${candidateFixtures.length} fixtures`);

    // Sort based on sortBy parameter
    if (sortBy === "edge") {
      candidateFixtures.sort((a, b) => {
        if (a.edge === null) return 1;
        if (b.edge === null) return -1;
        return b.edge - a.edge;
      });
    } else if (sortBy === "confidence") {
      candidateFixtures.sort((a, b) => {
        const sampleA = a.stat_preview.sample_size;
        const sampleB = b.stat_preview.sample_size;
        return sampleB - sampleA;
      });
    } else if (sortBy === "odds") {
      candidateFixtures.sort((a, b) => {
        if (a.market_odds === null) return 1;
        if (b.market_odds === null) return -1;
        return b.market_odds - a.market_odds;
      });
    }

    const filteredFixtures = candidateFixtures;

    console.log(`[filterizer-query] Final count: ${filteredFixtures.length} fixtures (sorted by ${sortBy})`);

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
