import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickLine, Market } from "../_shared/ticket_rules.ts";
import { pickFromCombined } from "../_shared/rules.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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
  source?: "prematch" | "live";
}

// Validation schemas
const AITicketSchema = z.object({
  fixtureIds: z.array(z.number().int().positive()).max(50).optional(), // optional for global mode
  minOdds: z.number().positive().min(1.01).max(1000),
  maxOdds: z.number().positive().min(1.01).max(1000),
  legsMin: z.number().int().min(1).max(50),
  legsMax: z.number().int().min(1).max(50),
  includeMarkets: z.array(z.enum(["goals", "corners", "cards", "offsides", "fouls"])).optional(),
  useLiveOdds: z.boolean().optional(),
  countryCode: z.string().optional(),
  leagueIds: z.array(z.number()).optional(),
  debug: z.boolean().optional(),
});

const BetOptimizerSchema = z.object({
  mode: z.enum(["day", "live"]),
  date: z.string().optional(),
  targetMin: z.number().positive().min(1.01).max(1000),
  targetMax: z.number().positive().min(1.01).max(1000),
  risk: z.enum(["safe", "standard", "risky"]).optional(),
  includeMarkets: z.array(z.enum(["goals", "corners", "cards", "offsides", "fouls"])).optional(),
  excludeMarkets: z.array(z.enum(["goals", "corners", "cards", "offsides", "fouls"])).optional(),
  maxLegs: z.number().int().min(1).max(50).optional(),
  minLegs: z.number().int().min(1).max(50).optional(),
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    // Parse and validate request body
    const bodyRaw = await req.json().catch(() => null);
    if (!bodyRaw) {
      return new Response(
        JSON.stringify({ error: "Invalid request body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Transform legacy includeMarkets object to array if needed
    if (bodyRaw.includeMarkets && typeof bodyRaw.includeMarkets === 'object' && !Array.isArray(bodyRaw.includeMarkets)) {
      console.log("[generate-ticket] Converting legacy includeMarkets object to array");
      bodyRaw.includeMarkets = Object.keys(bodyRaw.includeMarkets).filter(k => bodyRaw.includeMarkets[k]);
    }

    // Detect request type and validate
    // Check for AI Ticket Creator params (has minOdds/maxOdds/legsMin/legsMax)
    if (bodyRaw.minOdds !== undefined && bodyRaw.maxOdds !== undefined) {
      const validation = AITicketSchema.safeParse(bodyRaw);
      if (!validation.success) {
        console.error("[generate-ticket] Validation error:", validation.error.format());
        const fieldErrors = Object.entries(validation.error.flatten().fieldErrors)
          .map(([field, errors]) => `${field}: ${errors?.join(", ")}`)
          .join("; ");
        return new Response(
          JSON.stringify({ 
            error: "Invalid request parameters", 
            fields: validation.error.flatten().fieldErrors,
            details: fieldErrors 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
        );
      }
      return await handleAITicketCreator(validation.data, supabase, user.id, token);
    } else {
      const validation = BetOptimizerSchema.safeParse(bodyRaw);
      if (!validation.success) {
        console.error("[generate-ticket] Validation error:", validation.error.format());
        const fieldErrors = Object.entries(validation.error.flatten().fieldErrors)
          .map(([field, errors]) => `${field}: ${errors?.join(", ")}`)
          .join("; ");
        return new Response(
          JSON.stringify({ 
            error: "Invalid request parameters", 
            fields: validation.error.flatten().fieldErrors,
            details: fieldErrors 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
        );
      }
      return await handleBetOptimizer(validation.data, supabase, user.id, token);
    }
  } catch (error) {
    console.error("[generate-ticket] Internal error:", {
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

// Helper function to process a single fixture into candidate pool
async function processFixtureToPool(
  fixtureId: number,
  supabase: any,
  token: string,
  markets: string[],
  useLiveOdds: boolean
): Promise<{ legs: TicketLeg[]; logs: string[]; usedLive: boolean; fallback: boolean }> {
  const legs: TicketLeg[] = [];
  const logs: string[] = [];
  let usedLive = false;
  let fallback = false;

  const { data: fixture } = await supabase
    .from("fixtures")
    .select("*")
    .eq("id", fixtureId)
    .single();

  if (!fixture) {
    logs.push(`[fixture:${fixtureId}] Not found in DB`);
    return { legs, logs, usedLive, fallback };
  }

  const homeTeam = fixture.teams_home?.name || "Home";
  const awayTeam = fixture.teams_away?.name || "Away";
  const start = fixture.date || "";

  const { data: analysisData, error: analysisError } = await supabase.functions.invoke("analyze-fixture", {
    headers: { Authorization: `Bearer ${token}` },
    body: {
      fixtureId,
      homeTeamId: fixture.teams_home?.id,
      awayTeamId: fixture.teams_away?.id,
    },
  });

  if (analysisError || !analysisData?.combined) {
    logs.push(`[fixture:${fixtureId}] No combined stats`);
    return { legs, logs, usedLive, fallback };
  }

  const combined = analysisData.combined;

  let { data: oddsData, error: oddsError } = await supabase.functions.invoke("fetch-odds", {
    headers: { Authorization: `Bearer ${token}` },
    body: { fixtureId, live: useLiveOdds },
  });

  if (oddsError || !oddsData || !oddsData.selections || oddsData.selections.length === 0) {
    // CRITICAL: if useLiveOdds=false, never try live endpoint - go straight to cache
    if (!useLiveOdds) {
      logs.push(`[fixture:${fixtureId}] No odds from prematch API, trying cache...`);
      const { data: cached } = await supabase
        .from("odds_cache")
        .select("payload")
        .eq("fixture_id", fixtureId)
        .maybeSingle();
      if (cached?.payload?.bookmakers?.length) {
        const selectionsViaCache = flattenOddsPayloadToSelections(cached.payload);
        if (selectionsViaCache.length > 0) {
          oddsData = { fixture: cached.payload.fixture, selections: selectionsViaCache, source: "prematch", cached: true };
          logs.push(`[fixture:${fixtureId}] Using DB cache with ${selectionsViaCache.length} selections`);
        } else {
          logs.push(`[fixture:${fixtureId}] No odds available (cache flatten yielded 0)`);
          return { legs, logs, usedLive, fallback };
        }
      } else {
        logs.push(`[fixture:${fixtureId}] No odds available`);
        return { legs, logs, usedLive, fallback };
      }
    } else {
      // useLiveOdds=true: fallback to prematch then cache
      logs.push(`[fixture:${fixtureId}] Live odds unavailable, trying pre-match...`);
      const { data: prematchData } = await supabase.functions.invoke("fetch-odds", {
        headers: { Authorization: `Bearer ${token}` },
        body: { fixtureId, live: false, forceRefresh: true },
      });
      if (prematchData && prematchData.selections && prematchData.selections.length > 0) {
        oddsData = prematchData;
        fallback = true;
      } else {
        const { data: cached } = await supabase
          .from("odds_cache")
          .select("payload")
          .eq("fixture_id", fixtureId)
          .maybeSingle();
        if (cached?.payload?.bookmakers?.length) {
          const selectionsViaCache = flattenOddsPayloadToSelections(cached.payload);
          if (selectionsViaCache.length > 0) {
            oddsData = { fixture: cached.payload.fixture, selections: selectionsViaCache, source: "prematch", cached: true };
            logs.push(`[fixture:${fixtureId}] Using DB cache fallback with ${selectionsViaCache.length} selections`);
          } else {
            logs.push(`[fixture:${fixtureId}] No odds available (cache flatten yielded 0)`);
            return { legs, logs, usedLive, fallback };
          }
        } else {
          logs.push(`[fixture:${fixtureId}] No odds available`);
          return { legs, logs, usedLive, fallback };
        }
      }
    }
  }

  usedLive = oddsData.source === "live";
  const selections = oddsData.selections || [];

  for (const market of markets) {
    const avgValue = combined[market];
    if (avgValue === undefined || avgValue === null) continue;

    const rulePick = pickFromCombined(market as any, avgValue);
    if (!rulePick) continue;

    const { side, line } = rulePick;
    const exactMatch = selections.find((s: any) => s.market === market && s.kind === side && s.line === line);

    if (exactMatch) {
      legs.push({
        fixtureId,
        homeTeam,
        awayTeam,
        start,
        market: market as Market,
        selection: `${side.charAt(0).toUpperCase() + side.slice(1)} ${line}`,
        odds: exactMatch.odds,
        bookmaker: exactMatch.bookmaker,
        combinedAvg: avgValue,
        source: oddsData.source,
      });
      logs.push(`[fixture:${fixtureId}] ${market}: exact ${side} ${line} @ ${exactMatch.odds}`);
    } else {
      const nearest = selections
        .filter((s: any) => s.market === market && s.kind === side && s.line && Math.abs(s.line - line) <= 0.5)
        .sort((a: any, b: any) => Math.abs(a.line - line) - Math.abs(b.line - line))[0];

      if (nearest) {
        legs.push({
          fixtureId,
          homeTeam,
          awayTeam,
          start,
          market: market as Market,
          selection: `${side.charAt(0).toUpperCase() + side.slice(1)} ${nearest.line}`,
          odds: nearest.odds,
          bookmaker: nearest.bookmaker,
          combinedAvg: avgValue,
          source: oddsData.source,
        });
        logs.push(`[fixture:${fixtureId}] ${market}: nearest ${side} ${nearest.line} @ ${nearest.odds}`);
      }
    }
  }

  return { legs, logs, usedLive, fallback };
}

// NEW: AI Ticket Creator with custom parameters
async function handleAITicketCreator(body: z.infer<typeof AITicketSchema>, supabase: any, userId: string, token: string) {
  const startTime = Date.now();
  const {
    fixtureIds,
    minOdds,
    maxOdds,
    legsMin,
    legsMax,
    includeMarkets,
    useLiveOdds = false,
    countryCode,
    leagueIds,
    debug = false,
  } = body;

  const globalMode = !fixtureIds || fixtureIds.length === 0;
  const markets = includeMarkets || ["goals", "corners", "cards", "offsides", "fouls"];
  const candidatePool: TicketLeg[] = [];
  const logs: string[] = [];
  let usedLive = false;
  let fallbackToPrematch = false;

  console.log(`[AI-ticket] Mode: ${globalMode ? "GLOBAL" : "SPECIFIC"} | minOdds: ${minOdds}, maxOdds: ${maxOdds}, legs: ${legsMin}-${legsMax}, markets: ${markets.join(",")}, useLive: ${useLiveOdds}`);

  // GLOBAL MODE: Query optimized_selections for next 48h
  if (globalMode) {
    logs.push("[Global Mode] Building candidate pool from next 48 hours...");
    
    const now = new Date();
    const end48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    
    let query = supabase
      .from("optimized_selections")
      .select(`id, fixture_id, league_id, country_code, utc_kickoff, market, side, line, odds, bookmaker, is_live, combined_snapshot, sample_size`)
      .gte("utc_kickoff", now.toISOString())
      .lte("utc_kickoff", end48h.toISOString())
      .in("market", markets);
    
    if (!useLiveOdds) query = query.eq("is_live", false);
    if (countryCode) query = query.eq("country_code", countryCode);
    if (leagueIds && leagueIds.length > 0) query = query.in("league_id", leagueIds);
    
    const { data: selections, error: selectionsError } = await query.limit(500);
    
    if (selectionsError) {
      console.error("[Global Mode] Error fetching selections:", selectionsError);
      logs.push(`[Global Mode] Error: ${selectionsError.message}`);
    } else if (!selections || selections.length === 0) {
      logs.push("[Global Mode] No optimized selections found. Computing on-the-fly from fixtures...");
      
      const { data: fixtures } = await supabase
        .from("fixtures")
        .select("id")
        .gte("timestamp", Math.floor(now.getTime() / 1000))
        .lte("timestamp", Math.floor(end48h.getTime() / 1000))
        .limit(50);
      
      if (fixtures && fixtures.length > 0) {
        logs.push(`[Global Mode] Processing ${fixtures.length} fixtures...`);
        for (const f of fixtures) {
          const result = await processFixtureToPool(f.id, supabase, token, markets, useLiveOdds);
          if (result.legs.length > 0) {
            candidatePool.push(...result.legs);
            if (result.usedLive) usedLive = true;
            if (result.fallback) fallbackToPrematch = true;
          }
          logs.push(...result.logs);
        }
      } else {
        logs.push("[Global Mode] No fixtures found for next 48h");
      }
    } else {
      logs.push(`[Global Mode] Found ${selections.length} pre-optimized selections`);
      
      const fixtureIdsSet = [...new Set(selections.map((s: any) => s.fixture_id))];
      const { data: fixtures } = await supabase
        .from("fixtures")
        .select("id, teams_home, teams_away, date")
        .in("id", fixtureIdsSet);
      
      const fixtureMap = new Map((fixtures || []).map((f: any) => [f.id, f]));
      
      for (const sel of selections) {
        const fixture: any = fixtureMap.get((sel as any).fixture_id);
        if (!fixture) continue;
        
        candidatePool.push({
          fixtureId: (sel as any).fixture_id,
          homeTeam: fixture.teams_home?.name || "Home",
          awayTeam: fixture.teams_away?.name || "Away",
          start: fixture.date || "",
          market: (sel as any).market as Market,
          selection: `${(sel as any).side} ${(sel as any).line}`,
          odds: (sel as any).odds,
          bookmaker: (sel as any).bookmaker || "Unknown",
          combinedAvg: (sel as any).combined_snapshot?.[(sel as any).market],
          source: (sel as any).is_live ? "live" : "prematch",
        });
      }
      
      usedLive = selections.some((s: any) => s.is_live);
      logs.push(`[Global Mode] Built pool of ${candidatePool.length} candidates from ${fixtureIdsSet.length} fixtures`);
    }
  } else {
    // SPECIFIC FIXTURES MODE
    logs.push(`[Specific Mode] Processing ${fixtureIds!.length} fixtures...`);
    for (const fid of fixtureIds!) {
      const result = await processFixtureToPool(fid, supabase, token, markets, useLiveOdds);
      if (result.legs.length > 0) {
        candidatePool.push(...result.legs);
        if (result.usedLive) usedLive = true;
        if (result.fallback) fallbackToPrematch = true;
      }
      logs.push(...result.logs);
    }
  }

  const poolByMarket: Record<string, number> = {};
  for (const leg of candidatePool) poolByMarket[leg.market] = (poolByMarket[leg.market] || 0) + 1;
  logs.push(`[Pool Summary] Total: ${candidatePool.length} | By market: ${JSON.stringify(poolByMarket)}`);
  console.log(logs.join("\n"));

  // Calculate odds distribution for diagnostics
  const oddsArray = candidatePool.map(l => l.odds).sort((a, b) => a - b);
  const percentile = (arr: number[], p: number) => {
    if (arr.length === 0) return 0;
    const idx = Math.floor(arr.length * p);
    return arr[Math.min(idx, arr.length - 1)];
  };
  const oddsStats = {
    minOdd: oddsArray.length > 0 ? oddsArray[0] : 0,
    p25: percentile(oddsArray, 0.25),
    median: percentile(oddsArray, 0.50),
    p75: percentile(oddsArray, 0.75),
    maxOdd: oddsArray.length > 0 ? oddsArray[oddsArray.length - 1] : 0,
  };

  // POOL_EMPTY check
  if (candidatePool.length === 0) {
    const diagnostic = {
      reason: "POOL_EMPTY",
      target: { min: minOdds, max: maxOdds, logMin: Math.log(minOdds), logMax: Math.log(maxOdds) },
      legs: { min: legsMin, max: legsMax },
      pool: {
        total: 0,
        byMarket: poolByMarket,
        ...oddsStats,
      },
      feasibility: { minPowMinLegs: 0, maxPowMaxLegs: 0, impossible: true },
      attempts: { beamExpansions: 0, timeMs: Date.now() - startTime },
      constraints: { noDuplicateFixtureMarket: true },
    };
    return new Response(
      JSON.stringify({
        code: "POOL_EMPTY",
        message: "No valid candidates found for the selected criteria",
        diagnostic: debug ? diagnostic : undefined,
        logs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }

  if (candidatePool.length < legsMin) {
    const diagnostic = {
      reason: "INSUFFICIENT_CANDIDATES",
      target: { min: minOdds, max: maxOdds, logMin: Math.log(minOdds), logMax: Math.log(maxOdds) },
      legs: { min: legsMin, max: legsMax },
      pool: {
        total: candidatePool.length,
        byMarket: poolByMarket,
        ...oddsStats,
      },
      feasibility: { minPowMinLegs: 0, maxPowMaxLegs: 0, impossible: false },
      attempts: { beamExpansions: 0, timeMs: Date.now() - startTime },
      constraints: { noDuplicateFixtureMarket: true },
    };
    return new Response(
      JSON.stringify({
        code: "INSUFFICIENT_CANDIDATES",
        message: `Not enough valid candidates (found ${candidatePool.length}, need at least ${legsMin})`,
        details: { found: candidatePool.length, required: legsMin },
        diagnostic: debug ? diagnostic : undefined,
        logs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }

  // FEASIBILITY CHECK (log-space bounds)
  const logMin = Math.log(minOdds);
  const logMax = Math.log(maxOdds);
  const minPowMinLegs = Math.pow(oddsStats.minOdd, legsMin);
  const maxPowMaxLegs = Math.pow(oddsStats.maxOdd, legsMax);
  
  const feasible = !(minPowMinLegs > maxOdds || maxPowMaxLegs < minOdds);
  
  if (!feasible) {
    const diagnostic = {
      reason: "IMPOSSIBLE_TARGET",
      target: { min: minOdds, max: maxOdds, logMin, logMax },
      legs: { min: legsMin, max: legsMax },
      pool: {
        total: candidatePool.length,
        byMarket: poolByMarket,
        ...oddsStats,
      },
      feasibility: {
        minPowMinLegs: Math.round(minPowMinLegs * 100) / 100,
        maxPowMaxLegs: Math.round(maxPowMaxLegs * 100) / 100,
        impossible: true,
      },
      attempts: { beamExpansions: 0, timeMs: Date.now() - startTime },
      constraints: { noDuplicateFixtureMarket: true },
    };
    logs.push(`[Feasibility] IMPOSSIBLE: minOdd^${legsMin}=${minPowMinLegs.toFixed(2)} > targetMax=${maxOdds} OR maxOdd^${legsMax}=${maxPowMaxLegs.toFixed(2)} < targetMin=${minOdds}`);
    return new Response(
      JSON.stringify({
        code: "IMPOSSIBLE_TARGET",
        message: `Target range ${minOdds}–${maxOdds} is impossible with ${legsMin}–${legsMax} legs and current pool odds (${oddsStats.minOdd.toFixed(2)}–${oddsStats.maxOdd.toFixed(2)})`,
        diagnostic: debug ? diagnostic : undefined,
        logs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }

  logs.push(`[Feasibility] OK: minPow=${minPowMinLegs.toFixed(2)}, maxPow=${maxPowMaxLegs.toFixed(2)}, target=[${minOdds}, ${maxOdds}]`);

  // 4. COMPOSE TICKET
  const ticket = generateOptimizedTicket(
    candidatePool,
    minOdds,
    maxOdds,
    legsMin,
    legsMax
  );

  if (!ticket) {
    const diagnostic = {
      reason: "NO_IN_RANGE_COMBINATION",
      target: { min: minOdds, max: maxOdds, logMin, logMax },
      legs: { min: legsMin, max: legsMax },
      pool: {
        total: candidatePool.length,
        byMarket: poolByMarket,
        ...oddsStats,
      },
      feasibility: {
        minPowMinLegs: Math.round(minPowMinLegs * 100) / 100,
        maxPowMaxLegs: Math.round(maxPowMaxLegs * 100) / 100,
        impossible: false,
      },
      attempts: { beamExpansions: 0, timeMs: Date.now() - startTime },
      constraints: { noDuplicateFixtureMarket: true },
    };
    return new Response(
      JSON.stringify({
        code: "OPTIMIZATION_FAILED",
        message: "Could not generate ticket within target range after beam search",
        details: { pool_size: candidatePool.length, target: { min: minOdds, max: maxOdds } },
        diagnostic: debug ? diagnostic : undefined,
        logs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }

  logs.push(`[AI-ticket] Generated ticket: ${ticket.legs.length} legs, total odds ${ticket.total_odds}, expansions ${ticket.attempts}`);

  // Calculate win probability (simple implied probability product)
  const winProb = ticket.legs.reduce((acc, leg) => acc * (1 / leg.odds), 1);
  const winProbPct = Math.round(winProb * 10000) / 100;

  // 5. PERSIST TO DB
  try {
    // Write optimizer_cache rows (one per leg)
    for (const leg of ticket.legs) {
      await supabase.from("optimizer_cache").insert({
        fixture_id: leg.fixtureId,
        market: leg.market,
        side: leg.selection.toLowerCase().includes("over") ? "over" : "under",
        line: parseFloat(leg.selection.match(/[\d.]+/)?.[0] || "0"),
        combined_value: leg.combinedAvg || 0,
        bookmaker: leg.bookmaker,
        odds: leg.odds,
        source: leg.source || "prematch",
      });
    }

    // Write generated_tickets row
    await supabase.from("generated_tickets").insert({
      user_id: userId,
      total_odds: ticket.total_odds,
      min_target: minOdds,
      max_target: maxOdds,
      used_live: usedLive && !fallbackToPrematch,
      legs: ticket.legs,
    });

    logs.push(`[AI-ticket] Persisted ${ticket.legs.length} legs to optimizer_cache and 1 ticket to generated_tickets`);
  } catch (dbError) {
    console.error("[AI-ticket] DB persistence error:", dbError);
    logs.push(`[AI-ticket] Warning: DB persistence failed`);
  }

  return new Response(
    JSON.stringify({
      ticket: {
        ...ticket,
        estimated_win_prob: winProbPct,
      },
      pool_size: candidatePool.length,
      target: { min: minOdds, max: maxOdds },
      used_live: usedLive && !fallbackToPrematch,
      fallback_to_prematch: fallbackToPrematch,
      diagnostic: debug ? {
        reason: "SUCCESS",
        target: { min: minOdds, max: maxOdds, logMin, logMax },
        legs: { min: legsMin, max: legsMax },
        pool: {
          total: candidatePool.length,
          byMarket: poolByMarket,
          ...oddsStats,
        },
        feasibility: {
          minPowMinLegs: Math.round(minPowMinLegs * 100) / 100,
          maxPowMaxLegs: Math.round(maxPowMaxLegs * 100) / 100,
          impossible: false,
        },
        attempts: { beamExpansions: ticket.attempts, timeMs: Date.now() - startTime },
        constraints: { noDuplicateFixtureMarket: true },
      } : undefined,
      logs,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// OLD: Bet Optimizer (mode-based)
async function handleBetOptimizer(body: z.infer<typeof BetOptimizerSchema>, supabase: any, userId: string, token: string) {
  const { 
    mode,
    date,
    targetMin,
    targetMax,
    risk = "standard",
    maxLegs = 5,
  } = body;

  console.log(`[bet-optimizer] Mode: ${mode}, Date: ${date}`);

  let fixturesQuery = supabase
    .from("fixtures")
    .select("*")
    .eq("date", date);

  const { data: fixtures, error: fixturesError } = await fixturesQuery;

  if (fixturesError) throw fixturesError;
  if (!fixtures || fixtures.length === 0) {
    return new Response(
      JSON.stringify({ 
        legs: [], 
        total_odds: 0,
        estimated_win_prob: 0,
        notes: "No fixtures found for selected date"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const thresholds = { minProb: 0.58, minEdge: 0.03 };
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
      e.edge >= thresholds.minEdge
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
  const maxTotalOdds = targetMax || 50;

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
  maxLegs: number
): { total_odds: number; legs: TicketLeg[]; attempts: number } | null {
  // Deterministic beam-search in log space
  const logMin = Math.log(targetMin);
  const logMax = Math.log(targetMax);
  const logMid = (logMin + logMax) / 2;

  // Deterministic sort: by odds ascending, then fixture ID, then market name
  // No per-leg odds preference - just deterministic ordering
  const sortedPool = [...pool].sort((a, b) => {
    if (a.odds !== b.odds) return a.odds - b.odds;
    if (a.fixtureId !== b.fixtureId) return a.fixtureId - b.fixtureId;
    return a.market.localeCompare(b.market);
  });

  type State = { legs: TicketLeg[]; product: number; used: Map<number, Set<string>> };
  let beam: State[] = [{ legs: [], product: 1, used: new Map() }];
  const WIDTH = 50;
  let expansions = 0;

  const score = (prod: number, len: number) => {
    const lp = Math.log(prod);
    // Penalize being under minLegs a bit so we add enough legs
    const legPenalty = len < minLegs ? (minLegs - len) * 0.05 : 0;
    return Math.abs(lp - logMid) + legPenalty;
  };

  let best: { legs: TicketLeg[]; product: number } | null = null;

  for (let depth = 0; depth < maxLegs; depth++) {
    const next: State[] = [];

    for (const state of beam) {
      for (const cand of sortedPool) {
        // Constraint: only one leg per (fixtureId, market)
        const set = state.used.get(cand.fixtureId);
        if (set && set.has(cand.market)) continue;

        const newProduct = state.product * cand.odds;
        // Prune states that already exceed target by too much
        if (newProduct > targetMax * 1.05) continue;

        const newLegs = [...state.legs, cand];
        const newUsed = new Map(state.used);
        const mset = newUsed.get(cand.fixtureId) || new Set<string>();
        mset.add(cand.market);
        newUsed.set(cand.fixtureId, mset);

        expansions++;

        // Check in-range
        if (newLegs.length >= minLegs && newProduct >= targetMin && newProduct <= targetMax) {
          return { total_odds: Math.round(newProduct * 100) / 100, legs: newLegs, attempts: expansions };
        }

        next.push({ legs: newLegs, product: newProduct, used: newUsed });

        // Track best close match with enough legs
        if (newLegs.length >= minLegs) {
          if (!best || Math.abs(Math.log(newProduct) - logMid) < Math.abs(Math.log(best.product) - logMid)) {
            best = { legs: newLegs, product: newProduct };
          }
        }
      }
    }

    // Beam prune deterministically by score
    next.sort((a, b) => score(a.product, a.legs.length) - score(b.product, b.legs.length));
    beam = next.slice(0, WIDTH);
    if (beam.length === 0) break;
  }

  return best ? { total_odds: Math.round(best.product * 100) / 100, legs: best.legs, attempts: expansions } : null;
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

// Helper: flatten DB odds payload to selections (same shape as fetch-odds)
function flattenOddsPayloadToSelections(payload: any) {
  const selections: any[] = [];
  const bookmakers = payload?.bookmakers || [];
  for (const bookmaker of bookmakers) {
    const bookmakerName = bookmaker.name || `Bookmaker ${bookmaker.id}`;
    for (const bet of bookmaker.bets || []) {
      // Use EXACT bet ID matching (API-Football standard IDs)
      // - ID 5: "Goals Over/Under" (full match)
      // - ID 45: "Corners Over Under" (full match)  
      // - ID 80: "Cards Over/Under" (full match)
      const normalizedMarket = (() => {
        const betId = bet?.id;
        if (betId === 5) return "goals";
        if (betId === 45) return "corners";
        if (betId === 80) return "cards";
        return "unknown";
      })();
      if (normalizedMarket === "unknown") continue;
      for (const value of bet.values || []) {
        const parsed = parseValueString(String(value.value || ""));
        if (!parsed) continue;
        selections.push({
          bookmaker: bookmakerName,
          market: normalizedMarket,
          kind: parsed.side,
          odds: Number(value.odd),
          line: parsed.line,
        });
      }
    }
  }
  return selections;
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
