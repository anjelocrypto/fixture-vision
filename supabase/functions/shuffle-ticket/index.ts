import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { ODDS_MIN, ODDS_MAX } from "../_shared/config.ts";
import { RULES_VERSION } from "../_shared/rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ShuffleRequestSchema = z.object({
  lockedLegIds: z.array(z.string()).optional().default([]),
  targetLegs: z.number().int().min(1).max(50),
  minOdds: z.number().positive().min(1.01),
  maxOdds: z.number().positive().min(1.01),
  includeMarkets: z.array(z.enum(["goals", "corners", "cards", "offsides", "fouls"])),
  dayRange: z.enum(["today", "next_2_days", "next_3_days"]).optional().default("next_3_days"),
  countryCode: z.string().optional(),
  leagueIds: z.array(z.number()).optional(),
  previousTicketHash: z.string().optional(),
  seed: z.number().optional(),
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const bodyRaw = await req.json().catch(() => null);
    if (!bodyRaw) {
      return new Response(
        JSON.stringify({ error: "Invalid request body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const validation = ShuffleRequestSchema.safeParse(bodyRaw);
    if (!validation.success) {
      return new Response(
        JSON.stringify({ 
          error: "Invalid request parameters",
          details: validation.error.flatten().fieldErrors 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
      );
    }

    const {
      lockedLegIds,
      targetLegs,
      minOdds,
      maxOdds,
      includeMarkets,
      dayRange,
      countryCode,
      leagueIds,
      previousTicketHash,
      seed,
    } = validation.data;

    console.log(`[shuffle-ticket] User: ${user.id}, Target: ${targetLegs} legs, Locked: ${lockedLegIds.length}, Markets: ${includeMarkets.join(",")}, DayRange: ${dayRange}`);

    // Calculate date range based on dayRange parameter
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const endDate = new Date(now);
    
    switch (dayRange) {
      case "today":
        endDate.setDate(endDate.getDate() + 1);
        break;
      case "next_2_days":
        endDate.setDate(endDate.getDate() + 2);
        break;
      case "next_3_days":
        endDate.setDate(endDate.getDate() + 3);
        break;
    }
    
    console.log(`[shuffle-ticket] DATE FILTER: ${dayRange} → [${now.toISOString().split('T')[0]} 00:00, ${endDate.toISOString().split('T')[0]} 00:00) UTC`);
    
    let query = supabase
      .from("optimized_selections")
      .select(`
        id, fixture_id, league_id, country_code, utc_kickoff,
        market, side, line, odds, bookmaker, is_live, 
        edge_pct, model_prob, combined_snapshot, sample_size
      `)
      .eq("rules_version", RULES_VERSION)
      .gte("utc_kickoff", now.toISOString())
      .lt("utc_kickoff", endDate.toISOString())
      .in("market", includeMarkets)
      .gte("odds", ODDS_MIN)
      .lte("odds", ODDS_MAX)
      .eq("is_live", false);
    
    if (countryCode) query = query.eq("country_code", countryCode);
    if (leagueIds && leagueIds.length > 0) query = query.in("league_id", leagueIds);
    
    const { data: candidateSelections, error: selectionsError } = await query.limit(200);
    
    if (selectionsError) {
      console.error("[shuffle-ticket] Error fetching candidates:", selectionsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch candidate selections" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    if (!candidateSelections || candidateSelections.length === 0) {
      let dayRangeHint = "";
      if (dayRange === "today") {
        dayRangeHint = " There are no qualifying matches today. Try 'Next 2 days' or 'Next 3 days' instead.";
      } else if (dayRange === "next_2_days") {
        dayRangeHint = " Not enough qualifying matches in the next 2 days. Try 'Next 3 days'.";
      }
      
      return new Response(
        JSON.stringify({ 
          error: "No candidates available",
          message: `No eligible selections found with current filters.${dayRangeHint} Also try: unlocking some legs, selecting more markets, or choosing more leagues.`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Filter out locked fixture IDs (extract from locked leg IDs: "{fixtureId}-{market}-{side}-{line}")
    const lockedFixtureIds = new Set(
      lockedLegIds.map(id => {
        const parts = id.split('-');
        return parseInt(parts[0]);
      }).filter(id => !isNaN(id))
    );

    // Remove locked fixtures from candidates
    const unlocked = candidateSelections.filter((sel: any) => 
      !lockedFixtureIds.has(sel.fixture_id)
    );

    const numUnlockedNeeded = targetLegs - lockedLegIds.length;
    
    if (unlocked.length < numUnlockedNeeded) {
      return new Response(
        JSON.stringify({ 
          error: "Insufficient candidates",
          message: `Need ${numUnlockedNeeded} unlocked legs but only ${unlocked.length} candidates available. Unlock some legs or loosen filters.`,
          available: unlocked.length,
          needed: numUnlockedNeeded
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Initialize RNG first (use provided seed or timestamp)
    const usedSeed = seed ?? Date.now();
    const rng = seededRandom(usedSeed);
    
    // Add randomness to weights to prevent deterministic selection
    const withWeights = unlocked.map((sel: any) => {
      const edge = sel.edge_pct || 0;
      const odds = sel.odds || 1.5;
      
      // 65% edge, 25% odds, 10% random variation
      const baseWeight = (0.65 * Math.max(0, edge)) + (0.25 * (odds / 10));
      const randomBoost = 0.10 * rng();
      
      return { ...sel, weight: baseWeight + randomBoost };
    });

    // Fisher-Yates shuffle with weights
    const shuffled = weightedShuffle(withWeights, rng);
    
    // Enforce one leg per fixture
    const selectedFixtures = new Set<number>(Array.from(lockedFixtureIds));
    const selected: any[] = [];
    
    for (const sel of shuffled) {
      if (selected.length >= numUnlockedNeeded) break;
      if (!selectedFixtures.has(sel.fixture_id)) {
        selected.push(sel);
        selectedFixtures.add(sel.fixture_id);
      }
    }

    if (selected.length < numUnlockedNeeded) {
      return new Response(
        JSON.stringify({ 
          error: "Cannot meet leg requirements",
          message: "Not enough unique fixtures to create ticket. Try loosening filters or allowing more leagues."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Fetch fixture details
    const fixtureIds = [...new Set(selected.map((s: any) => s.fixture_id))];
    const { data: fixtures } = await supabase
      .from("fixtures")
      .select("id, teams_home, teams_away, date, league_id")
      .in("id", fixtureIds);
    
    const fixtureMap = new Map((fixtures || []).map((f: any) => [f.id, f]));

    // Fetch league details
    const leagueIdsToFetch = [...new Set(selected.map((s: any) => s.league_id))];
    const { data: leagues } = await supabase
      .from("leagues")
      .select("id, name")
      .in("id", leagueIdsToFetch);
    
    const leagueMap = new Map((leagues || []).map((l: any) => [l.id, l]));

    // Build ticket legs
    const legs = selected.map((sel: any) => {
      const fixture = fixtureMap.get(sel.fixture_id);
      const league = leagueMap.get(sel.league_id);
      
      return {
        fixture_id: sel.fixture_id,
        league: league?.name || "Unknown League",
        kickoff: sel.utc_kickoff,
        home_team: fixture?.teams_home?.name || "Home",
        away_team: fixture?.teams_away?.name || "Away",
        market: sel.market,
        pick: `${sel.side.charAt(0).toUpperCase() + sel.side.slice(1)} ${sel.line}`,
        line: sel.line,
        side: sel.side,
        bookmaker: sel.bookmaker,
        odds: sel.odds,
        edge: sel.edge_pct,
        model_prob: sel.model_prob,
      };
    });

    // Calculate total odds
    const totalOdds = legs.reduce((acc, leg) => acc * leg.odds, 1);
    const estimatedWinProb = legs.reduce((acc, leg) => 
      acc * (leg.model_prob || (1 / leg.odds)), 1
    ) * 100;

    // Check if different from previous (if hash provided)
    const currentHash = legs.map(l => `${l.fixture_id}-${l.market}-${l.side}-${l.line}`).sort().join("|");
    const isDifferent = !previousTicketHash || currentHash !== previousTicketHash;

    console.log(`[shuffle-ticket] Generated ${legs.length} legs, Total odds: ${totalOdds.toFixed(2)}, Different: ${isDifferent}`);

    return new Response(
      JSON.stringify({
        mode: "shuffle",
        legs,
        total_odds: totalOdds,
        estimated_win_prob: estimatedWinProb,
        ticket_hash: currentHash,
        is_different: isDifferent,
        pool_size: unlocked.length,
        generated_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (error) {
    console.error("[shuffle-ticket] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

// Seeded random number generator (LCG)
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// Weighted shuffle using cumulative weights
function weightedShuffle(items: any[], rng: () => number): any[] {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const result: any[] = [];
  const remaining = [...items];

  while (remaining.length > 0) {
    const rand = rng() * remaining.reduce((sum, item) => sum + item.weight, 0);
    let cumulative = 0;
    
    for (let i = 0; i < remaining.length; i++) {
      cumulative += remaining[i].weight;
      if (rand <= cumulative) {
        result.push(remaining[i]);
        remaining.splice(i, 1);
        break;
      }
    }
  }

  return result;
}
