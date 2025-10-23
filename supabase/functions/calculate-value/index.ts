import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Poisson probability mass function
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

// Poisson CDF P(X <= k)
function poissonCDF(lambda: number, k: number): number {
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    sum += poissonPMF(lambda, i);
  }
  return Math.min(1, sum);
}

// Negative Binomial probability (overdispersed Poisson)
function negBinomialPMF(mu: number, r: number, k: number): number {
  if (mu <= 0) return k === 0 ? 1 : 0;
  const p = r / (r + mu);
  const coeff = Math.exp(
    logGamma(r + k) - logGamma(k + 1) - logGamma(r)
  );
  return coeff * Math.pow(p, r) * Math.pow(1 - p, k);
}

function logGamma(z: number): number {
  // Stirling's approximation for log(gamma(z))
  if (z < 1) return 0;
  return (z - 0.5) * Math.log(z) - z + 0.5 * Math.log(2 * Math.PI);
}

function negBinomialCDF(mu: number, r: number, k: number): number {
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    sum += negBinomialPMF(mu, r, i);
  }
  return Math.min(1, sum);
}

interface TeamStats {
  goals: number;
  cards: number;
  corners: number;
  fouls: number;
  offsides: number;
  sample_size: number;
}

interface ModelOutput {
  market: string;
  line: number;
  model_prob_over: number;
  model_prob_under: number;
  model_confidence: string;
  rationale: string;
}

interface BookOdds {
  bookmaker: string;
  over_odds: number;
  under_odds: number;
}

interface EdgeResult {
  market: string;
  line: number;
  side: "over" | "under";
  model_prob: number;
  book_prob: number;
  edge: number;
  odds: number;
  bookmaker: string;
  confidence: string;
  rationale: string;
  raw_over_prob?: number;
  raw_under_prob?: number;
  normalized_sum?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fixtureId } = await req.json();

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log(`[calculate-value] Processing fixture ${fixtureId}`);

    // Get fixture details
    const { data: fixture } = await supabaseClient
      .from("fixtures")
      .select("*")
      .eq("id", fixtureId)
      .single();

    if (!fixture) {
      throw new Error("Fixture not found");
    }

    // Get team stats
    const homeTeamId = fixture.teams_home.id;
    const awayTeamId = fixture.teams_away.id;

    const [homeStatsRes, awayStatsRes] = await Promise.all([
      supabaseClient.from("stats_cache").select("*").eq("team_id", homeTeamId).single(),
      supabaseClient.from("stats_cache").select("*").eq("team_id", awayTeamId).single(),
    ]);

    if (!homeStatsRes.data || !awayStatsRes.data) {
      throw new Error("Team stats not available");
    }

    const homeStats: TeamStats = homeStatsRes.data;
    const awayStats: TeamStats = awayStatsRes.data;

    // Get odds from cache
    const { data: oddsCache } = await supabaseClient
      .from("odds_cache")
      .select("*")
      .eq("fixture_id", fixtureId)
      .single();

    if (!oddsCache) {
      return new Response(
        JSON.stringify({ 
          error: "No odds available",
          models: computeModels(homeStats, awayStats),
          edges: []
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Compute model probabilities
    const models = computeModels(homeStats, awayStats);

    // Normalize odds and compute edges
    const edges = computeEdges(models, oddsCache.payload);

    console.log(`[calculate-value] Computed ${edges.length} edge opportunities`);

    return new Response(
      JSON.stringify({
        fixture_id: fixtureId,
        models,
        edges: edges.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge)).slice(0, 20),
        computed_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[calculate-value] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function computeModels(homeStats: TeamStats, awayStats: TeamStats): ModelOutput[] {
  const models: ModelOutput[] = [];
  const HOME_ADVANTAGE = 1.06; // +6% boost for home team
  const SHRINKAGE_TAU = 10;

  // GOALS - Poisson model
  const homeWeight = homeStats.sample_size / (homeStats.sample_size + SHRINKAGE_TAU);
  const awayWeight = awayStats.sample_size / (awayStats.sample_size + SHRINKAGE_TAU);
  
  const leagueMeanGoals = 1.4; // Typical league average
  const lambdaHome = (homeStats.goals * homeWeight + leagueMeanGoals * (1 - homeWeight)) * HOME_ADVANTAGE;
  const lambdaAway = awayStats.goals * awayWeight + leagueMeanGoals * (1 - awayWeight);
  const lambdaTotal = lambdaHome + lambdaAway;

  // Common over/under lines for goals
  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    const probUnder = poissonCDF(lambdaTotal, Math.floor(line));
    const probOver = 1 - probUnder;
    
    const confidence = homeStats.sample_size >= 5 && awayStats.sample_size >= 5 ? "high" : 
                      homeStats.sample_size >= 3 && awayStats.sample_size >= 3 ? "med" : "low";

    models.push({
      market: "goals",
      line,
      model_prob_over: probOver,
      model_prob_under: probUnder,
      model_confidence: confidence,
      rationale: `Poisson λ=${lambdaTotal.toFixed(2)} (home=${lambdaHome.toFixed(2)}+HA, away=${lambdaAway.toFixed(2)}), shrinkage τ=${SHRINKAGE_TAU}`,
    });
  }

  // CARDS - Negative Binomial (overdispersed)
  const cardsDispersion = 3;
  const cardsMean = (homeStats.cards + awayStats.cards) / 2;
  
  for (const line of [2.5, 3.5, 4.5, 5.5]) {
    const probUnder = negBinomialCDF(cardsMean, cardsDispersion, Math.floor(line));
    const probOver = 1 - probUnder;
    
    models.push({
      market: "cards",
      line,
      model_prob_over: probOver,
      model_prob_under: probUnder,
      model_confidence: homeStats.sample_size >= 3 ? "med" : "low",
      rationale: `NegBin μ=${cardsMean.toFixed(2)}, r=${cardsDispersion}`,
    });
  }

  // CORNERS - Negative Binomial
  const cornersDispersion = 4;
  const cornersMean = (homeStats.corners + awayStats.corners) / 2;
  
  for (const line of [8.5, 9.5, 10.5, 11.5]) {
    const probUnder = negBinomialCDF(cornersMean, cornersDispersion, Math.floor(line));
    const probOver = 1 - probUnder;
    
    models.push({
      market: "corners",
      line,
      model_prob_over: probOver,
      model_prob_under: probUnder,
      model_confidence: homeStats.sample_size >= 3 ? "med" : "low",
      rationale: `NegBin μ=${cornersMean.toFixed(2)}, r=${cornersDispersion}`,
    });
  }

  return models;
}

function computeEdges(models: ModelOutput[], oddsPayload: any): EdgeResult[] {
  const edges: EdgeResult[] = [];

  try {
    // Access bookmakers directly from cached payload
    const bookmakers = oddsPayload.bookmakers || [];

    for (const bookmaker of bookmakers) {
      const bookmakerName = bookmaker.name;

      for (const market of bookmaker.markets || []) {
        const marketName = normalizeMarketName(market.name);
        if (marketName === "unknown") continue;

        // Build a map of line -> {over, under} pairs
        const linePairs: Record<string, { over?: any; under?: any }> = {};

        for (const value of market.values || []) {
          const parsed = parseValueString(value.value);
          if (!parsed) continue;

          const { side, line } = parsed;
          const lineKey = line.toFixed(2); // Normalize to 2 decimals

          if (!linePairs[lineKey]) {
            linePairs[lineKey] = {};
          }

          if (side === "over") {
            linePairs[lineKey].over = { odd: value.odd };
          } else if (side === "under") {
            linePairs[lineKey].under = { odd: value.odd };
          }
        }

        // Process complete pairs only
        for (const [lineKey, pair] of Object.entries(linePairs)) {
          if (!pair.over?.odd || !pair.under?.odd) continue;

          const line = parseFloat(lineKey);
          const overOdds = pair.over.odd;
          const underOdds = pair.under.odd;

          // Find matching model (tolerance 0.01)
          const model = models.find(
            (m) => m.market === marketName && Math.abs(m.line - line) <= 0.01
          );

          if (!model) continue;

          // Overround removal (bookmaker + market + line level)
          const rawOverProb = 1 / overOdds;
          const rawUnderProb = 1 / underOdds;
          const totalRaw = rawOverProb + rawUnderProb;

          const bookOverProb = rawOverProb / totalRaw;
          const bookUnderProb = rawUnderProb / totalRaw;

          console.log(
            `[computeEdges] bookmaker=${bookmakerName}, market=${marketName}, line=${line}, ` +
            `p_over_raw=${rawOverProb.toFixed(4)}, p_under_raw=${rawUnderProb.toFixed(4)}, ` +
            `sum_raw=${totalRaw.toFixed(4)}, p_over=${bookOverProb.toFixed(4)}, ` +
            `p_under=${bookUnderProb.toFixed(4)}, sum=${(bookOverProb + bookUnderProb).toFixed(2)}`
          );

          // Compute edges
          const edgeOver = model.model_prob_over - bookOverProb;
          const edgeUnder = model.model_prob_under - bookUnderProb;

          console.log(
            `[computeEdges] model_prob_over=${model.model_prob_over.toFixed(4)}, ` +
            `model_prob_under=${model.model_prob_under.toFixed(4)}, ` +
            `edge_over=${edgeOver.toFixed(4)}, edge_under=${edgeUnder.toFixed(4)}`
          );

          // Add both sides if edge > 0
          const normalizedSum = bookOverProb + bookUnderProb;
          
          if (edgeOver > 0) {
            edges.push({
              market: marketName,
              line,
              side: "over",
              model_prob: model.model_prob_over,
              book_prob: bookOverProb,
              edge: edgeOver,
              odds: overOdds,
              bookmaker: bookmakerName,
              confidence: model.model_confidence,
              rationale: model.rationale,
              raw_over_prob: rawOverProb,
              raw_under_prob: rawUnderProb,
              normalized_sum: normalizedSum,
            });
          }

          if (edgeUnder > 0) {
            edges.push({
              market: marketName,
              line,
              side: "under",
              model_prob: model.model_prob_under,
              book_prob: bookUnderProb,
              edge: edgeUnder,
              odds: underOdds,
              bookmaker: bookmakerName,
              confidence: model.model_confidence,
              rationale: model.rationale,
              raw_over_prob: rawOverProb,
              raw_under_prob: rawUnderProb,
              normalized_sum: normalizedSum,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("[computeEdges] Error processing odds:", error);
  }

  return edges;
}

function parseValueString(valueStr: string): { side: "over" | "under"; line: number } | null {
  const lower = valueStr.toLowerCase().trim();
  
  // Match patterns like "Over 2.5", "O 2.5", "Under 3", "U 3.5"
  const overMatch = lower.match(/(?:over|o)\s*([\d.]+)/);
  const underMatch = lower.match(/(?:under|u)\s*([\d.]+)/);
  
  if (overMatch) {
    return { side: "over", line: parseFloat(overMatch[1]) };
  } else if (underMatch) {
    return { side: "under", line: parseFloat(underMatch[1]) };
  }
  
  return null;
}

function normalizeMarketName(betName: string): string {
  const lower = betName.toLowerCase();
  if (lower.includes("goals")) return "goals";
  if (lower.includes("card")) return "cards";
  if (lower.includes("corner")) return "corners";
  return "unknown";
}
