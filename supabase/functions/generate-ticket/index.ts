import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickLine, getRiskProfile, Market } from "../_shared/ticket_rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GenerateTicketRequest {
  fixtureIds: number[];
  targetMin: number;
  targetMax: number;
  risk?: "safe" | "standard" | "risky";
  includeMarkets?: Market[];
  excludeMarkets?: Market[];
  maxLegs?: number;
  minLegs?: number;
}

interface TicketLeg {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  start: string;
  market: Market;
  selection: string;
  odds: number;
  bookmaker: string;
  combinedAvg?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Detect request type: NEW (fixtureIds) or OLD (mode + date)
    if (body.fixtureIds && Array.isArray(body.fixtureIds)) {
      // NEW AI Ticket Creator path
      return await handleAITicketCreator(body, supabase);
    } else {
      // OLD Bet Optimizer path
      return await handleBetOptimizer(body, supabase);
    }
  } catch (error) {
    console.error("[generate-ticket] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

// NEW: AI Ticket Creator with custom parameters
async function handleAITicketCreator(body: any, supabase: any) {
  const {
    fixtureIds,
    targetMin,
    targetMax,
    risk = "standard",
    includeMarkets = ["goals", "corners", "cards", "fouls", "offsides"],
    excludeMarkets = [],
    maxLegs = 8,
    minLegs = 3,
    useLiveOdds = false,
  } = body;

  console.log(`[AI-ticket] Creating ticket: fixtures=${fixtureIds.length}, target=${targetMin}-${targetMax}, risk=${risk}, live=${useLiveOdds}`);

  const markets = includeMarkets.filter((m: string) => !excludeMarkets.includes(m));
  const riskProfile = getRiskProfile(risk);
  const candidatePool: TicketLeg[] = [];

  for (const fixtureId of fixtureIds) {
    const { data: fixture } = await supabase
      .from("fixtures")
      .select("*")
      .eq("id", fixtureId)
      .single();

    if (!fixture) continue;

    const homeTeam = fixture.teams_home?.name || "Home";
    const awayTeam = fixture.teams_away?.name || "Away";
    const start = fixture.date || "";

    const { data: analysisData } = await supabase.functions.invoke("analyze-fixture", {
      body: {
        fixtureId,
        homeTeamId: fixture.teams_home?.id,
        awayTeamId: fixture.teams_away?.id,
      },
    });

    if (!analysisData?.combined) continue;

    const combined = analysisData.combined;

    const { data: oddsData } = await supabase.functions.invoke("fetch-odds", {
      body: { 
        fixtureId,
        live: useLiveOdds,
      },
    });

    if (!oddsData?.available || !oddsData.bookmakers) continue;

    for (const market of markets) {
      const avgValue = combined[market];
      if (avgValue === undefined || avgValue === null) continue;

      const line = pickLine(market, avgValue);
      if (!line) continue;

      const marketName = getMarketName(market);
      let bestOdds: { odds: number; bookmaker: string } | null = null;

      for (const bookmaker of oddsData.bookmakers) {
        const marketData = bookmaker.markets.find((m: any) => 
          normalizeMarketName(m.name) === marketName
        );
        if (!marketData) continue;

        const oddsValue = marketData.values.find((v: any) => 
          normalizeSelection(v.value) === line.label
        );

        if (oddsValue) {
          const odds = parseFloat(oddsValue.odd);
          if (!bestOdds || odds > bestOdds.odds) {
            bestOdds = { odds, bookmaker: bookmaker.name };
          }
        }
      }

      if (!bestOdds && line.threshold !== undefined) {
        const nearestOdds = findNearestLine(oddsData.bookmakers, marketName, line.threshold);
        if (nearestOdds) bestOdds = nearestOdds;
      }

      if (bestOdds && bestOdds.odds >= riskProfile.minOdds && bestOdds.odds <= riskProfile.maxOdds * 1.5) {
        candidatePool.push({
          fixtureId,
          homeTeam,
          awayTeam,
          start,
          market: market as Market,
          selection: `${line.label} ${marketName}`,
          odds: bestOdds.odds,
          bookmaker: bestOdds.bookmaker,
          combinedAvg: avgValue,
        });
      }
    }
  }

  console.log(`[AI-ticket] Candidate pool size: ${candidatePool.length}`);

  if (candidatePool.length < minLegs) {
    return new Response(
      JSON.stringify({
        error: `Not enough valid candidates (found ${candidatePool.length}, need at least ${minLegs})`,
        pool_size: candidatePool.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }

  const ticket = generateOptimizedTicket(
    candidatePool,
    targetMin,
    targetMax,
    minLegs,
    maxLegs,
    riskProfile.preferredOdds
  );

  if (!ticket) {
    return new Response(
      JSON.stringify({
        error: "Could not generate ticket within target range after multiple attempts",
        pool_size: candidatePool.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
    );
  }

  return new Response(
    JSON.stringify({
      ticket,
      pool_size: candidatePool.length,
      target: { min: targetMin, max: targetMax },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// OLD: Bet Optimizer (mode-based)
async function handleBetOptimizer(body: any, supabase: any) {
  const { 
    mode = "standard",
    date,
    leagueIds = [],
    maxLegs = mode === "safe" ? 2 : mode === "standard" ? 5 : 8,
    maxTotalOdds = 50
  } = body;

  console.log(`[bet-optimizer] Mode: ${mode}, Date: ${date}`);

  let fixturesQuery = supabase
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

  const thresholds = getModeThresholds(mode);
  const candidates: any[] = [];

  for (const fixture of fixtures) {
    const { data: oddsCache } = await supabase
      .from("odds_cache")
      .select("*")
      .eq("fixture_id", fixture.id)
      .single();

    if (!oddsCache) continue;

    const homeTeamId = fixture.teams_home.id;
    const awayTeamId = fixture.teams_away.id;

    const [homeStatsRes, awayStatsRes] = await Promise.all([
      supabase.from("stats_cache").select("*").eq("team_id", homeTeamId).maybeSingle(),
      supabase.from("stats_cache").select("*").eq("team_id", awayTeamId).maybeSingle(),
    ]);

    if (!homeStatsRes.data || !awayStatsRes.data) continue;

    const edges = await calculateFixtureEdges(
      fixture,
      homeStatsRes.data,
      awayStatsRes.data,
      oddsCache.payload
    );

    const validEdges = edges.filter((e: any) => 
      e.model_prob >= thresholds.minProb &&
      e.edge >= thresholds.minEdge &&
      (mode === "safe" ? e.market === "goals" : true)
    );

    if (validEdges.length === 0) continue;

    const bestEdge = validEdges.sort((a: any, b: any) => b.edge - a.edge)[0];

    const { data: league } = await supabase
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
      league_id: fixture.league_id,
    });
  }

  candidates.sort((a, b) => b.edge - a.edge);

  const selectedLegs: any[] = [];
  let totalOdds = 1;
  const usedLeagues: Record<number, number> = {};

  for (const candidate of candidates) {
    if (selectedLegs.length >= maxLegs) break;

    const leagueCount = usedLeagues[candidate.league_id] || 0;
    if (leagueCount >= 2) continue;

    const newTotalOdds = totalOdds * candidate.odds;
    if (newTotalOdds > maxTotalOdds) continue;

    selectedLegs.push(candidate);
    totalOdds = newTotalOdds;
    usedLeagues[candidate.league_id] = (usedLeagues[candidate.league_id] || 0) + 1;
  }

  const estimatedWinProb = selectedLegs.reduce((acc, leg) => acc * leg.model_prob, 1);

  return new Response(
    JSON.stringify({
      mode,
      legs: selectedLegs,
      total_odds: totalOdds,
      estimated_win_prob: estimatedWinProb,
      notes: `${mode.charAt(0).toUpperCase() + mode.slice(1)} mode: ${selectedLegs.length} legs selected.`,
      generated_at: new Date().toISOString(),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

function getModeThresholds(mode: string) {
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
  const SHRINKAGE_TAU = 10;
  const LEAGUE_MEAN_GOALS = 1.4;

  const homeWeight = homeStats.sample_size / (homeStats.sample_size + SHRINKAGE_TAU);
  const awayWeight = awayStats.sample_size / (awayStats.sample_size + SHRINKAGE_TAU);

  const lambdaHome = (homeStats.goals * homeWeight + LEAGUE_MEAN_GOALS * (1 - homeWeight)) * HOME_ADVANTAGE;
  const lambdaAway = awayStats.goals * awayWeight + LEAGUE_MEAN_GOALS * (1 - awayWeight);
  const lambdaTotal = lambdaHome + lambdaAway;

  try {
    const bookmakers = oddsPayload.bookmakers || [];

    for (const bookmaker of bookmakers.slice(0, 10)) {
      const bookmakerName = bookmaker.name;

      for (const market of bookmaker.markets || []) {
        const marketName = normalizeMarketNameOld(market.name);
        if (marketName !== "goals") continue;

        const linePairs: Record<string, { over?: any; under?: any }> = {};

        for (const value of market.values || []) {
          const parsed = parseValueString(value.value);
          if (!parsed) continue;

          const { side, line } = parsed;
          if (![0.5, 1.5, 2.5, 3.5, 4.5].includes(line)) continue;

          const lineKey = line.toFixed(2);

          if (!linePairs[lineKey]) {
            linePairs[lineKey] = {};
          }

          if (side === "over") {
            linePairs[lineKey].over = { odd: value.odd };
          } else if (side === "under") {
            linePairs[lineKey].under = { odd: value.odd };
          }
        }

        for (const [lineKey, pair] of Object.entries(linePairs)) {
          if (!pair.over?.odd || !pair.under?.odd) continue;

          const line = parseFloat(lineKey);
          const overOdds = Number(pair.over.odd);
          const underOdds = Number(pair.under.odd);

          if (!isFinite(overOdds) || !isFinite(underOdds) || overOdds <= 1 || underOdds <= 1) continue;

          const probUnder = poissonCDF(lambdaTotal, Math.floor(line));
          const probOver = 1 - probUnder;

          const rawOverProb = 1 / overOdds;
          const rawUnderProb = 1 / underOdds;
          const totalRaw = rawOverProb + rawUnderProb;

          const bookOverProb = rawOverProb / totalRaw;
          const bookUnderProb = rawUnderProb / totalRaw;

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
              bookmaker: bookmakerName,
            });
          }

          if (edgeUnder > 0) {
            edges.push({
              market: "goals",
              line,
              side: "under",
              model_prob: probUnder,
              book_prob: bookUnderProb,
              edge: edgeUnder,
              odds: underOdds,
              bookmaker: bookmakerName,
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

function parseValueString(valueStr: string): { side: "over" | "under"; line: number } | null {
  const lower = valueStr.toLowerCase().trim();

  const overMatch = lower.match(/(?:over|o)\s*([\d.]+)/);
  const underMatch = lower.match(/(?:under|u)\s*([\d.]+)/);

  if (overMatch) {
    return { side: "over", line: parseFloat(overMatch[1]) };
  } else if (underMatch) {
    return { side: "under", line: parseFloat(underMatch[1]) };
  }

  return null;
}

function normalizeMarketNameOld(marketName: string): string {
  const lower = marketName.toLowerCase();
  if (lower.includes("goals")) return "goals";
  if (lower.includes("card")) return "cards";
  if (lower.includes("corner")) return "corners";
  return "unknown";
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

function generateOptimizedTicket(
  pool: TicketLeg[],
  targetMin: number,
  targetMax: number,
  minLegs: number,
  maxLegs: number,
  preferredOdds: number
): { total_odds: number; legs: TicketLeg[]; attempts: number } | null {
  const MAX_ATTEMPTS = 50;
  let bestTicket: { total_odds: number; legs: TicketLeg[] } | null = null;
  let bestDistance = Infinity;

  // Sort pool by distance from preferred odds
  const sortedPool = [...pool].sort((a, b) => {
    const distA = Math.abs(a.odds - preferredOdds);
    const distB = Math.abs(b.odds - preferredOdds);
    return distA - distB;
  });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const legs: TicketLeg[] = [];
    const usedFixtures = new Set<number>();
    const usedMarkets = new Map<number, Set<string>>(); // fixtureId -> markets
    let product = 1;

    // Shuffle for randomization
    const shuffled = [...sortedPool].sort(() => Math.random() - 0.5);

    for (const candidate of shuffled) {
      if (legs.length >= maxLegs) break;

      // Check diversity constraints
      if (usedMarkets.has(candidate.fixtureId)) {
        if (usedMarkets.get(candidate.fixtureId)!.has(candidate.market)) {
          continue; // Skip duplicate market for same fixture
        }
      }

      const newProduct = product * candidate.odds;

      // Accept if within or approaching target
      if (newProduct <= targetMax * 1.15) {
        legs.push(candidate);
        product = newProduct;
        usedFixtures.add(candidate.fixtureId);
        
        if (!usedMarkets.has(candidate.fixtureId)) {
          usedMarkets.set(candidate.fixtureId, new Set());
        }
        usedMarkets.get(candidate.fixtureId)!.add(candidate.market);

        // Check if we hit target
        if (product >= targetMin && product <= targetMax && legs.length >= minLegs) {
          return { total_odds: Math.round(product * 100) / 100, legs, attempts: attempt + 1 };
        }
      }
    }

    // Track best attempt
    if (legs.length >= minLegs) {
      const distance = Math.abs(product - (targetMin + targetMax) / 2);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTicket = { total_odds: Math.round(product * 100) / 100, legs };
      }
    }
  }

  return bestTicket ? { ...bestTicket, attempts: MAX_ATTEMPTS } : null;
}

function getMarketName(market: Market): string {
  switch (market) {
    case "goals": return "Goals Over/Under";
    case "corners": return "Corners Over/Under";
    case "cards": return "Cards Over/Under";
    case "fouls": return "Fouls Over/Under";
    case "offsides": return "Offsides Over/Under";
  }
}

function normalizeMarketName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("goal")) return "Goals Over/Under";
  if (lower.includes("corner")) return "Corners Over/Under";
  if (lower.includes("card")) return "Cards Over/Under";
  if (lower.includes("foul")) return "Fouls Over/Under";
  if (lower.includes("offside")) return "Offsides Over/Under";
  return name;
}

function normalizeSelection(value: string): string {
  return value.trim();
}

function findNearestLine(
  bookmakers: any[],
  marketName: string,
  targetLine: number
): { odds: number; bookmaker: string } | null {
  let best: { odds: number; bookmaker: string; distance: number } | null = null;

  for (const bookmaker of bookmakers) {
    const marketData = bookmaker.markets.find((m: any) => 
      normalizeMarketName(m.name) === marketName
    );
    if (!marketData) continue;

    for (const v of marketData.values) {
      const match = v.value.match(/Over\s+([\d.]+)/i);
      if (match) {
        const line = parseFloat(match[1]);
        const distance = Math.abs(line - targetLine);
        
        if (distance <= 0.5) { // Within ±0.5 threshold
          const odds = parseFloat(v.odd);
          if (!best || distance < best.distance) {
            best = { odds, bookmaker: bookmaker.name, distance };
          }
        }
      }
    }
  }

  return best ? { odds: best.odds, bookmaker: best.bookmaker } : null;
}
