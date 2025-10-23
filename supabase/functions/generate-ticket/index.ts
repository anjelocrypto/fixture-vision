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
    const body: GenerateTicketRequest = await req.json();
    const {
      fixtureIds,
      targetMin,
      targetMax,
      risk = "standard",
      includeMarkets = ["goals", "corners", "cards", "fouls", "offsides"],
      excludeMarkets = [],
      maxLegs = 8,
      minLegs = 3,
    } = body;

    console.log(`[generate-ticket] Creating ticket: fixtures=${fixtureIds.length}, target=${targetMin}-${targetMax}, risk=${risk}`);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Filter markets
    const markets = includeMarkets.filter(m => !excludeMarkets.includes(m));
    const riskProfile = getRiskProfile(risk);

    // Step 1: Build candidate pool
    const candidatePool: TicketLeg[] = [];

    for (const fixtureId of fixtureIds) {
      // Get fixture details
      const { data: fixture } = await supabase
        .from("fixtures")
        .select("*")
        .eq("id", fixtureId)
        .single();

      if (!fixture) {
        console.log(`[generate-ticket] Fixture ${fixtureId} not found, skipping`);
        continue;
      }

      const homeTeam = fixture.teams_home?.name || "Home";
      const awayTeam = fixture.teams_away?.name || "Away";
      const start = fixture.date || "";

      // Get combined averages from analyze-fixture
      const { data: analysisData } = await supabase.functions.invoke("analyze-fixture", {
        body: {
          fixtureId,
          homeTeamId: fixture.teams_home?.id,
          awayTeamId: fixture.teams_away?.id,
        },
      });

      if (!analysisData?.combined) {
        console.log(`[generate-ticket] No analysis for fixture ${fixtureId}, skipping`);
        continue;
      }

      const combined = analysisData.combined;

      // Get odds for this fixture
      const { data: oddsData } = await supabase.functions.invoke("fetch-odds", {
        body: { fixtureId },
      });

      if (!oddsData?.available || !oddsData.bookmakers) {
        console.log(`[generate-ticket] No odds for fixture ${fixtureId}, skipping`);
        continue;
      }

      // For each market, pick line and find odds
      for (const market of markets) {
        const avgValue = combined[market];
        if (avgValue === undefined || avgValue === null) continue;

        const line = pickLine(market, avgValue);
        if (!line) continue; // Skip if no recommendation

        // Find matching odds in bookmakers
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

        // Try nearest line if exact not found
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
            market,
            selection: `${line.label} ${marketName}`,
            odds: bestOdds.odds,
            bookmaker: bestOdds.bookmaker,
            combinedAvg: avgValue,
          });
        }
      }
    }

    console.log(`[generate-ticket] Candidate pool size: ${candidatePool.length}`);

    if (candidatePool.length < minLegs) {
      return new Response(
        JSON.stringify({
          error: `Not enough valid candidates (found ${candidatePool.length}, need at least ${minLegs})`,
          pool_size: candidatePool.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Step 2: Generate optimized ticket
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
  } catch (error) {
    console.error("[generate-ticket] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

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
