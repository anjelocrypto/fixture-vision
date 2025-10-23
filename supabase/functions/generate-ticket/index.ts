import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type TicketMode = "safe" | "standard" | "risky";

interface TicketLeg {
  fixture_id: number;
  league: string;
  kickoff: string;
  home_team: string;
  away_team: string;
  pick: string;
  market: string;
  line: number;
  side: string;
  bookmaker: string;
  odds: number;
  model_prob: number;
  book_prob: number;
  edge: number;
  reason: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      mode = "standard",
      date,
      leagueIds = [],
      maxLegs = mode === "safe" ? 2 : mode === "standard" ? 5 : 8,
      maxTotalOdds = 50
    } = await req.json();

    console.log(`[generate-ticket] Mode: ${mode}, Date: ${date}`);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get fixtures for date
    let fixturesQuery = supabaseClient
      .from("fixtures")
      .select("*")
      .eq("date", date);

    if (leagueIds.length > 0) {
      fixturesQuery = fixturesQuery.in("league_id", leagueIds);
    }

    const { data: fixtures, error: fixturesError } = await fixturesQuery;

    if (fixturesError) throw fixturesError;
    if (!fixtures || fixtures.length === 0) {
      return new Response(
        JSON.stringify({ 
          legs: [], 
          total_odds: 0,
          estimated_win_prob: 0,
          notes: "No fixtures found for selected date/leagues"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[generate-ticket] Found ${fixtures.length} fixtures`);

    // Get mode thresholds
    const thresholds = getModeThresholds(mode);

    // Collect candidates
    const candidates: TicketLeg[] = [];
    const leagueCounts: Record<number, number> = {};

    for (const fixture of fixtures) {
      // Check if odds available
      const { data: oddsCache } = await supabaseClient
        .from("odds_cache")
        .select("*")
        .eq("fixture_id", fixture.id)
        .single();

      if (!oddsCache) continue;

      // Get stats
      const homeTeamId = fixture.teams_home.id;
      const awayTeamId = fixture.teams_away.id;

      const [homeStatsRes, awayStatsRes] = await Promise.all([
        supabaseClient.from("stats_cache").select("*").eq("team_id", homeTeamId).maybeSingle(),
        supabaseClient.from("stats_cache").select("*").eq("team_id", awayTeamId).maybeSingle(),
      ]);

      if (!homeStatsRes.data || !awayStatsRes.data) continue;

      // Calculate value (simplified inline version)
      const edges = await calculateFixtureEdges(
        fixture,
        homeStatsRes.data,
        awayStatsRes.data,
        oddsCache.payload
      );

      // Find best edge for this fixture
      const validEdges = edges.filter(e => 
        e.model_prob >= thresholds.minProb &&
        e.edge >= thresholds.minEdge &&
        (mode === "safe" ? e.market === "goals" : true)
      );

      if (validEdges.length === 0) continue;

      // Get best edge
      const bestEdge = validEdges.sort((a, b) => b.edge - a.edge)[0];

      // Get league info
      const { data: league } = await supabaseClient
        .from("leagues")
        .select("name")
        .eq("id", fixture.league_id)
        .single();

      candidates.push({
        fixture_id: fixture.id,
        league: league?.name || "Unknown",
        kickoff: new Date(fixture.timestamp * 1000).toISOString(),
        home_team: fixture.teams_home.name,
        away_team: fixture.teams_away.name,
        pick: `${bestEdge.side} ${bestEdge.line}`,
        market: bestEdge.market,
        line: bestEdge.line,
        side: bestEdge.side,
        bookmaker: bestEdge.bookmaker,
        odds: bestEdge.odds,
        model_prob: bestEdge.model_prob,
        book_prob: bestEdge.book_prob,
        edge: bestEdge.edge,
        reason: `Edge ${(bestEdge.edge * 100).toFixed(1)}%, Prob ${(bestEdge.model_prob * 100).toFixed(0)}%`,
      });

      leagueCounts[fixture.league_id] = (leagueCounts[fixture.league_id] || 0) + 1;
    }

    console.log(`[generate-ticket] ${candidates.length} candidates found`);

    // Sort by edge and select legs
    candidates.sort((a, b) => b.edge - a.edge);

    const selectedLegs: TicketLeg[] = [];
    let totalOdds = 1;
    const usedLeagues: Record<number, number> = {};

    for (const candidate of candidates) {
      if (selectedLegs.length >= maxLegs) break;

      // Diversity check: max 2 from same league
      const fixtureData = fixtures.find(f => f.id === candidate.fixture_id);
      if (fixtureData) {
        const leagueCount = usedLeagues[fixtureData.league_id] || 0;
        if (leagueCount >= 2) continue;
      }

      // Odds constraint
      const newTotalOdds = totalOdds * candidate.odds;
      if (newTotalOdds > maxTotalOdds) continue;

      selectedLegs.push(candidate);
      totalOdds = newTotalOdds;
      if (fixtureData) {
        usedLeagues[fixtureData.league_id] = (usedLeagues[fixtureData.league_id] || 0) + 1;
      }
    }

    const estimatedWinProb = selectedLegs.reduce((acc, leg) => acc * leg.model_prob, 1);

    console.log(`[generate-ticket] Generated ticket with ${selectedLegs.length} legs, odds: ${totalOdds.toFixed(2)}`);

    return new Response(
      JSON.stringify({
        mode,
        legs: selectedLegs,
        total_odds: totalOdds,
        estimated_win_prob: estimatedWinProb,
        notes: `${mode.charAt(0).toUpperCase() + mode.slice(1)} mode: ${selectedLegs.length} legs selected. Edges normalized; avoid correlated fixtures.`,
        generated_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[generate-ticket] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function getModeThresholds(mode: TicketMode) {
  switch (mode) {
    case "safe":
      return { minProb: 0.65, minEdge: 0.03 };
    case "standard":
      return { minProb: 0.58, minEdge: 0.03 };
    case "risky":
      return { minProb: 0.52, minEdge: 0.05 };
    default:
      return { minProb: 0.58, minEdge: 0.03 };
  }
}

async function calculateFixtureEdges(fixture: any, homeStats: any, awayStats: any, oddsPayload: any) {
  const edges: any[] = [];
  const HOME_ADVANTAGE = 1.06;
  
  // Simplified goals model
  const lambdaHome = homeStats.goals * HOME_ADVANTAGE;
  const lambdaAway = awayStats.goals;
  const lambdaTotal = lambdaHome + lambdaAway;

  try {
    const bookmakers = oddsPayload.response?.[0]?.bookmakers || [];

    for (const bookmaker of bookmakers.slice(0, 5)) {
      for (const bet of bookmaker.bets || []) {
        if (!bet.name.toLowerCase().includes("goals")) continue;

        for (const value of bet.values || []) {
          const line = parseFloat(value.value);
          if (![0.5, 1.5, 2.5, 3.5, 4.5].includes(line)) continue;

          const overOdds = value.odd;
          if (!overOdds) continue;

          // Simple Poisson probability
          const probOver = 1 - poissonCDF(lambdaTotal, Math.floor(line));
          const probUnder = 1 - probOver;

          const bookOverProb = 1 / overOdds;
          const bookUnderProb = 1 - bookOverProb;

          const edgeOver = probOver - bookOverProb;
          const edgeUnder = probUnder - bookUnderProb;

          if (edgeOver > 0) {
            edges.push({
              market: "goals",
              line,
              side: "over",
              model_prob: probOver,
              book_prob: bookOverProb,
              edge: edgeOver,
              odds: overOdds,
              bookmaker: bookmaker.name,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("[calculateFixtureEdges] Error:", error);
  }

  return edges;
}

function poissonCDF(lambda: number, k: number): number {
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    sum += poissonPMF(lambda, i);
  }
  return Math.min(1, sum);
}

function poissonPMF(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}

function logFactorial(n: number): number {
  if (n <= 1) return 0;
  let result = 0;
  for (let i = 2; i <= n; i++) {
    result += Math.log(i);
  }
  return result;
}
