/*
 * TICKET CREATOR EDGE FUNCTION
 * 
 * Generates optimized betting tickets based on user constraints (odds range, markets, legs).
 * 
 * TWO MODES:
 * 1. Global Mode (no fixtureIds): Searches across all upcoming fixtures in next 48h
 * 2. Specific Mode (with fixtureIds): Only processes specified fixtures
 * 
 * DATA FLOW:
 * - Attempts to use pre-optimized selections from `optimized_selections` table (populated by optimizer)
 * - If empty, falls back to on-the-fly computation via processFixtureToPool (analyze-fixture + fetch-odds)
 * - Applies strict validation: odds band [1.25, 5.0], combined stats qualification, suspicious odds guards
 * - Uses stochastic beam search to find best ticket combination within target odds range
 * 
 * ERROR HANDLING (all return 200 with error codes, never 5xx):
 * - NO_FIXTURES_AVAILABLE: No upcoming fixtures found (user needs to fetch fixtures)
 * - NO_CANDIDATES: Zero valid selections after filtering (optimizer may be recalculating, or constraints too strict)
 * - INSUFFICIENT_CANDIDATES: Found some candidates but fewer than minLegs required
 * - IMPOSSIBLE_TARGET: Target odds range mathematically impossible with current pool
 * - NO_SOLUTION_IN_BAND: Search completed but no combination within target range (returns near-miss)
 * 
 * BUG FIX (2025-01-21):
 * - After clearing optimized_selections for corners data refresh, function would fail with generic 500 error
 * - Root cause: Empty candidate pool not properly handled as business outcome, caused unhandled exceptions
 * - Fix: Added NO_CANDIDATES error code with friendly message, try-catch around processFixtureToPool, improved logging
 * - Now returns clean 200 responses with actionable suggestions even when pool is empty during optimizer refresh
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickLine, Market } from "../_shared/ticket_rules.ts";
import { pickFromCombined, RULES, RULES_VERSION, type StatMarket } from "../_shared/rules.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { ODDS_MIN, ODDS_MAX } from "../_shared/config.ts";
import { checkSuspiciousOdds } from "../_shared/suspicious_odds_guards.ts";

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
  line?: number; // Actual line from odds (for consistency checking)
  side?: "over" | "under"; // Actual side from odds (for consistency checking)
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
    
    // Create client with user's token for auth and RPC calls
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

    // Check access for optimizer feature (paid, whitelisted, or trial)
    // Use user client so auth.uid() works in the RPC
    const { data: accessCheck, error: accessError } = await supabaseUser.rpc('try_use_feature', {
      feature_key: 'bet_optimizer'
    });
    
    // Create service role client for database operations
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (accessError) {
      console.error('[generate-ticket] Access check error:', accessError);
      // Return 500 with detailed error for debugging, but user-friendly message
      return new Response(
        JSON.stringify({ 
          error: 'Access check failed', 
          details: accessError.message || 'Unable to verify your subscription status. Please try again or contact support.',
          code: accessError.code
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessResult = Array.isArray(accessCheck) ? accessCheck[0] : accessCheck;
    
    if (!accessResult?.allowed) {
      console.log(`[generate-ticket] Access denied: ${accessResult?.reason}`);
      return new Response(
        JSON.stringify({ 
          code: 'PAYWALL',
          error: 'This feature requires a subscription',
          reason: accessResult?.reason || 'no_access',
          remaining_uses: accessResult?.remaining_uses
        }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[generate-ticket] Access granted: ${accessResult.reason}, remaining: ${accessResult.remaining_uses ?? 'unlimited'}`);

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
    if (!rulePick) {
      logs.push(`[${fixtureId}] ${market}=${avgValue.toFixed(2)} → no qualifying range (not eligible) - SKIPPED`);
      continue;
    }

    const { side, line: requestedLine } = rulePick;
    
    // STRICT MATCHING: Require exact line match (tolerance ≤ 0.01 for floating point)
    const exactMatch = selections.find((s: any) => 
      s.market === market && 
      s.kind === side && 
      Math.abs(s.line - requestedLine) <= 0.01
    );

    if (exactMatch) {
      // Enforce global odds band [ODDS_MIN, ODDS_MAX]
      if (exactMatch.odds < ODDS_MIN || exactMatch.odds > ODDS_MAX) {
        logs.push(`[OUT_OF_BAND] fixture:${fixtureId} ${market} ${exactMatch.kind} ${exactMatch.line} @ ${exactMatch.odds} outside [${ODDS_MIN}, ${ODDS_MAX}] - DROPPED`);
        continue;
      }
      
      // Sanity check: Warn if odds seem implausible for this market/line combo
      if (exactMatch.odds >= 4.5 && market === "goals" && exactMatch.line <= 2.5 && exactMatch.kind === "over") {
        logs.push(`[PRICE_SANITY_WARN] fixture:${fixtureId} Goals Over ${exactMatch.line} @ ${exactMatch.odds} looks implausibly high`);
      }
      
      legs.push({
        fixtureId,
        homeTeam,
        awayTeam,
        start,
        market: market as Market,
        selection: `${exactMatch.kind.charAt(0).toUpperCase() + exactMatch.kind.slice(1)} ${exactMatch.line}`,
        odds: exactMatch.odds,
        bookmaker: exactMatch.bookmaker,
        combinedAvg: avgValue,
        source: oddsData.source,
        line: exactMatch.line,
        side: exactMatch.kind,
      });
      logs.push(`[fixture:${fixtureId}] ${market}: EXACT ${exactMatch.kind} ${exactMatch.line} @ ${exactMatch.odds}`);
    } else {
      // NO FALLBACK: Log the mismatch and drop this candidate
      const availableLines = selections
        .filter((s: any) => s.market === market && s.kind === side)
        .map((s: any) => s.line)
        .sort((a: number, b: number) => a - b);
      
      logs.push(`[NO_EXACT_MATCH] fixture:${fixtureId} market:${market} requested:${side} ${requestedLine} | available: [${availableLines.join(", ")}]`);
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
  console.log(`[ticket] cfg {target:[${minOdds},${maxOdds}], legs:[${legsMin},${legsMax}], markets:[${markets.join(',')}], perLegBand:[${ODDS_MIN},${ODDS_MAX}]}`);

  // GLOBAL MODE: Query optimized_selections for next 48h
  if (globalMode) {
    logs.push("[Global Mode] Building candidate pool from next 48 hours...");
    
    const now = new Date();
    const end48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    
    let query = supabase
      .from("optimized_selections")
      .select(`id, fixture_id, league_id, country_code, utc_kickoff, market, side, line, odds, bookmaker, is_live, combined_snapshot, sample_size, rules_version`)
      .eq("rules_version", RULES_VERSION) // Only qualified selections from current matrix
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
          try {
            const result = await processFixtureToPool(f.id, supabase, token, markets, useLiveOdds);
            if (result.legs.length > 0) {
              candidatePool.push(...result.legs);
              if (result.usedLive) usedLive = true;
              if (result.fallback) fallbackToPrematch = true;
            }
            logs.push(...result.logs);
          } catch (fixtureError) {
            console.error(`[Global Mode] Error processing fixture ${f.id}:`, fixtureError);
            logs.push(`[ERROR] fixture:${f.id} - ${fixtureError instanceof Error ? fixtureError.message : "Unknown error"}`);
            // Continue with other fixtures instead of failing completely
          }
        }
      } else {
        logs.push("[Global Mode] No fixtures found for next 48h");
        
        // Return specific error for no fixtures
        return new Response(
          JSON.stringify({
            code: "NO_FIXTURES_AVAILABLE",
            message: "No upcoming fixtures found in the next 48 hours. Please use 'Fetch Fixtures' to load matches first.",
            suggestions: [
              "Click the 'Fetch Fixtures' button to load upcoming matches",
              "Select a country/league from the left sidebar first",
              "Make sure you're viewing upcoming dates (today onwards)"
            ],
            logs,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
    } else {
      logs.push(`[Global Mode] Found ${selections.length} pre-optimized selections`);
      
      const fixtureIdsSet = [...new Set(selections.map((s: any) => s.fixture_id))];
      const { data: fixtures } = await supabase
        .from("fixtures")
        .select("id, teams_home, teams_away, date")
        .in("id", fixtureIdsSet);
      
      const fixtureMap = new Map((fixtures || []).map((f: any) => [f.id, f]));

      const rawCount = selections.length;
      const byMarket: Record<string, number> = {};
      for (const s of selections) byMarket[(s as any).market] = (byMarket[(s as any).market] || 0) + 1;
      logs.push(`[ticket] pool raw=${rawCount}, byMarket ${JSON.stringify(byMarket)}`);
      
      let droppedOutOfBand = 0;
      let droppedNotQualified = 0;
      let suspiciousDropped = 0;
      let bandKept = 0;
      let qualifiedKept = 0;
      const tempCandidates: TicketLeg[] = [];
      
      for (const sel of selections) {
        const fixture: any = fixtureMap.get((sel as any).fixture_id);
        if (!fixture) continue;
        
        // Enforce global odds band [ODDS_MIN, ODDS_MAX]
        if ((sel as any).odds < ODDS_MIN || (sel as any).odds > ODDS_MAX) {
          droppedOutOfBand++;
          continue;
        }
        bandKept++;
        
        // Validate combined_snapshot against qualification range (same as Filterizer)
        const market = (sel as any).market;
        const side = (sel as any).side;
        const line = (sel as any).line;
        const combinedSnapshot = (sel as any).combined_snapshot;
        
        if (combinedSnapshot && combinedSnapshot[market] !== undefined) {
          const combinedValue = Number(combinedSnapshot[market]);
          const expectedPick = pickFromCombined(market as StatMarket, combinedValue);
          if (!expectedPick || expectedPick.side !== side || expectedPick.line !== line) {
            droppedNotQualified++;
            logs.push(`[NOT_QUALIFIED] ${market}=${combinedValue.toFixed(2)} does not qualify for ${side} ${line} (fixture ${(sel as any).fixture_id}) - DROPPED`);
            continue;
          }
          qualifiedKept++;
          logs.push(`[QUALIFIED] ${market}=${combinedValue.toFixed(2)} qualifies for ${side} ${line} (fixture ${(sel as any).fixture_id}) - KEPT`);
        }
        
        // Suspicious odds guard
        const suspiciousWarning = checkSuspiciousOdds(market as any, Number(line), Number((sel as any).odds));
        if (suspiciousWarning) {
          suspiciousDropped++;
          logs.push(`[SUSPICIOUS] ${suspiciousWarning} (fixture ${(sel as any).fixture_id}, ${(sel as any).bookmaker}) - DROPPED`);
          continue;
        }
        
        tempCandidates.push({
          fixtureId: (sel as any).fixture_id,
          homeTeam: fixture.teams_home?.name || "Home",
          awayTeam: fixture.teams_away?.name || "Away",
          start: fixture.date || "",
          market: market as Market,
          selection: `${side} ${line}`,
          odds: (sel as any).odds,
          bookmaker: (sel as any).bookmaker || "Unknown",
          combinedAvg: combinedSnapshot?.[market],
          source: (sel as any).is_live ? "live" : "prematch",
        });
      }
      
      // Dedupe: keep best odds per fixture+market
      const dedupMap = new Map<string, TicketLeg>();
      for (const leg of tempCandidates) {
        const key = `${leg.fixtureId}|${leg.market}`;
        const prev = dedupMap.get(key);
        if (!prev || leg.odds > prev.odds) dedupMap.set(key, leg);
      }
      const deduped = Array.from(dedupMap.values());
      candidatePool.push(...deduped);
      
      if (droppedOutOfBand > 0) logs.push(`[Global Mode] Dropped ${droppedOutOfBand} selections outside [${ODDS_MIN}, ${ODDS_MAX}] band`);
      if (droppedNotQualified > 0) logs.push(`[Global Mode] Dropped ${droppedNotQualified} selections not meeting v2 combined qualification`);
      if (suspiciousDropped > 0) logs.push(`[Global Mode] Dropped ${suspiciousDropped} suspicious odds selections`);
      
      logs.push(`[ticket] stages raw=${rawCount}; band_kept=${bandKept}; qualified_kept=${qualifiedKept}; suspicious_dropped=${suspiciousDropped}; de_dupe_kept=${deduped.length}; final_pool=${candidatePool.length}`);
      
      usedLive = selections.some((s: any) => s.is_live);
      logs.push(`[Global Mode] Built pool of ${candidatePool.length} candidates from ${fixtureIdsSet.length} fixtures`);
    }
  } else {
    // SPECIFIC FIXTURES MODE
    logs.push(`[Specific Mode] Processing ${fixtureIds!.length} fixtures...`);
    for (const fid of fixtureIds!) {
      try {
        const result = await processFixtureToPool(fid, supabase, token, markets, useLiveOdds);
        if (result.legs.length > 0) {
          candidatePool.push(...result.legs);
          if (result.usedLive) usedLive = true;
          if (result.fallback) fallbackToPrematch = true;
        }
        logs.push(...result.logs);
      } catch (fixtureError) {
        console.error(`[Specific Mode] Error processing fixture ${fid}:`, fixtureError);
        logs.push(`[ERROR] fixture:${fid} - ${fixtureError instanceof Error ? fixtureError.message : "Unknown error"}`);
        // Continue with other fixtures
      }
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
      constraints: { noDuplicateFixtureMarket: true, oddsBand: [ODDS_MIN, ODDS_MAX] },
    };
    return new Response(
      JSON.stringify({
        code: "NO_CANDIDATES",
        message: `No valid selections found for your settings. This might be because: 1) Optimized selections are being recalculated (try again in 1 minute), 2) No matches qualify for selected markets/odds, or 3) Stats data is being refreshed.`,
        suggestions: [
          "Wait 1-2 minutes and try again (optimizer may be recalculating)",
          "Click 'Refresh' in Admin panel to trigger optimizer refresh",
          "Try different markets or widen your odds range",
          "Enable more markets (Goals, Corners, Cards)"
        ],
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
        message: `Not enough valid candidates (found ${candidatePool.length}, need at least ${legsMin}). Try: 1) Click 'Fetch Fixtures' to refresh data, 2) Lower min legs to ${candidatePool.length} or less, 3) Include more markets, or 4) Widen odds range.`,
        details: { found: candidatePool.length, required: legsMin },
        suggestions: [
          "Click 'Fetch Fixtures' in the top bar to refresh match data",
          `Lower minimum legs to ${candidatePool.length} or less in the dialog`,
          "Enable more markets (Goals, Corners, Cards)",
          "Widen your target odds range (e.g., 5-15x instead of 10-12x)"
        ],
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

  // 4. COMPOSE TICKET (with stochastic search)
  const ticket = generateOptimizedTicket(
    candidatePool,
    minOdds,
    maxOdds,
    legsMin,
    legsMax,
    markets,
    userId
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

  // Check if ticket is within band
  if (!ticket.within_band) {
    const diagnostic = {
      reason: "NO_SOLUTION_IN_BAND",
      target: { min: minOdds, max: maxOdds, logMin, logMax },
      legs: { min: legsMin, max: legsMax },
      pool: {
        total: candidatePool.length,
        byMarket: poolByMarket,
        ...oddsStats,
      },
      best_nearby: ticket.best_nearby,
      suggestions: [
        ticket.total_odds < minOdds 
          ? `Lower your min odds to ${Math.floor(ticket.total_odds - 2)} or add more legs`
          : `Increase your max odds to ${Math.ceil(ticket.total_odds + 2)} or reduce legs`,
        "Try including more markets (Goals, Corners, Cards)",
        "Adjust leg count range to allow more flexibility",
      ],
    };
    
    logs.push(`[AI-ticket] NO solution within band [${minOdds}, ${maxOdds}]. Best near-miss: ${ticket.total_odds}x`);
    
    return new Response(
      JSON.stringify({
        code: "NO_SOLUTION_IN_BAND",
        message: `Could not find ticket within ${minOdds}–${maxOdds}x range. Best nearby: ${ticket.total_odds}x`,
        best_nearby: ticket.best_nearby,
        suggestions: diagnostic.suggestions,
        diagnostic: debug ? diagnostic : undefined,
        logs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  }

  logs.push(`[AI-ticket] ✅ Generated ticket: ${ticket.legs.length} legs, total odds ${ticket.total_odds}, expansions ${ticket.attempts}, sampled_legs_attempts=[${ticket.sampled_legs_attempts?.join(',')}], time=${ticket.time_ms}ms, WITHIN BAND [${minOdds}, ${maxOdds}]`);

  // CONSISTENCY CHECK: Validate all legs match their source data
  let consistencyFailures = 0;
  for (const leg of ticket.legs) {
    // Extract line from selection string
    const lineMatch = leg.selection.match(/([\d.]+)/);
    const legLine = lineMatch ? parseFloat(lineMatch[1]) : null;
    const legSide = leg.selection.toLowerCase().includes("over") ? "over" : "under";
    
    if (!legLine || !Number.isFinite(legLine)) {
      logs.push(`[CONSISTENCY_FAIL] fixture:${leg.fixtureId} market:${leg.market} - invalid line in selection "${leg.selection}"`);
      consistencyFailures++;
      continue;
    }
    
    // Validate that the leg's displayed line matches what we should have for these odds
    if (leg.line && Math.abs(leg.line - legLine) > 0.01) {
      logs.push(`[CONSISTENCY_FAIL] fixture:${leg.fixtureId} market:${leg.market} requested:${legSide} ${leg.line} got:${legSide} ${legLine}`);
      consistencyFailures++;
    }
    
    if (leg.side && leg.side !== legSide) {
      logs.push(`[CONSISTENCY_FAIL] fixture:${leg.fixtureId} market:${leg.market} side mismatch: leg.side=${leg.side} selection=${legSide}`);
      consistencyFailures++;
    }
  }
  
  if (consistencyFailures > 0) {
    logs.push(`[CONSISTENCY_CHECK] Found ${consistencyFailures} mismatches in ${ticket.legs.length} legs`);
  } else {
    logs.push(`[CONSISTENCY_CHECK] All ${ticket.legs.length} legs validated successfully`);
  }

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
        within_band: ticket.within_band,
      },
      pool_size: candidatePool.length,
      target: { min: minOdds, max: maxOdds },
      within_band: ticket.within_band,
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
        attempts: { 
          beamExpansions: ticket.attempts, 
          timeMs: ticket.time_ms || (Date.now() - startTime),
          sampledLegsAttempts: ticket.sampled_legs_attempts,
        },
        constraints: { noDuplicateFixtureMarket: true, oddsBand: [ODDS_MIN, ODDS_MAX] },
        stochasticSearch: {
          sampled_legs_attempts: ticket.sampled_legs_attempts,
          pool_size: candidatePool.length,
          markets_used: Object.keys(poolByMarket),
          bookmakers_used: [...new Set(candidatePool.map(l => l.bookmaker))].length,
          evaluated: ticket.attempts,
          found_in_range: ticket.within_band,
          result_total_odds: ticket.total_odds,
        },
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

// Simple PRNG for deterministic but varied results
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function generateOptimizedTicket(
  pool: TicketLeg[],
  targetMin: number,
  targetMax: number,
  minLegs: number,
  maxLegs: number,
  markets: string[],
  userId?: string
): {
  total_odds: number; 
  legs: TicketLeg[]; 
  attempts: number; 
  within_band: boolean;
  best_nearby?: { total_odds: number; legs: TicketLeg[] };
  sampled_legs_attempts?: number[];
  time_ms?: number;
} | null {
  const startTime = Date.now();
  const ATTEMPT_TIMEOUT = 600; // ms per leg-count attempt (temporarily elevated)
  const TOTAL_TIMEOUT = 6000; // ms total (temporarily elevated)
  const MAX_EVALUATIONS = 100000;
  
  // Seed PRNG with userId + date + target range for session-stable but varied results
  const seed = (userId ? userId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) : 12345) + 
                Date.now() + Math.floor(targetMin * 1000) + Math.floor(targetMax * 1000);
  const rand = seededRandom(seed);
  
  const logMin = Math.log(targetMin);
  const logMax = Math.log(targetMax);
  const logMid = (logMin + logMax) / 2;

  // Sort pool by odds for deterministic beam search
  const sortedPool = [...pool].sort((a, b) => {
    if (a.odds !== b.odds) return a.odds - b.odds;
    if (a.fixtureId !== b.fixtureId) return a.fixtureId - b.fixtureId;
    return a.market.localeCompare(b.market);
  });

  type State = { 
    legs: TicketLeg[]; 
    product: number; 
    used: Map<number, Set<string>>;
    avgEdge: number;
  };
  
  let bestInBand: { legs: TicketLeg[]; product: number; avgEdge: number } | null = null;
  let bestNearMiss: { legs: TicketLeg[]; product: number } | null = null;
  let totalExpansions = 0;
  const sampledLegsAttempts: number[] = [];
  
  const maxOddsInPool = Math.max(...sortedPool.map(l => l.odds), 1.0);

  const score = (prod: number, len: number, avgEdge: number, targetN: number) => {
    const lp = Math.log(prod);
    const distanceToMid = Math.abs(lp - logMid);
    // Strongly prefer hitting the target N (sampled leg count)
    const legPenalty = Math.abs(len - targetN) * 0.5;
    // IMPORTANT: Do NOT include avgEdge in scoring to avoid hidden market bias
    return distanceToMid + legPenalty;
  };
  // Stochastic search: try multiple leg counts
  const MAX_ATTEMPTS = 10;
  for (let attemptIdx = 0; attemptIdx < MAX_ATTEMPTS && Date.now() - startTime < TOTAL_TIMEOUT; attemptIdx++) {
    const attemptStart = Date.now();
    
    // Sample a target leg count N from [minLegs, maxLegs]
    const targetN = minLegs + Math.floor(rand() * (maxLegs - minLegs + 1));
    sampledLegsAttempts.push(targetN);
    
    console.log(`[stochastic-search] Attempt ${attemptIdx + 1}: trying N=${targetN} legs`);
    
    // Beam search for this specific N
    const WIDTH = 50;
    const NUM_SEEDS = 50; // Multiple diverse starting points
    
    // Group pool by market for balanced seed generation
    const poolByMarket: Map<string, TicketLeg[]> = new Map();
    for (const leg of sortedPool) {
      if (!poolByMarket.has(leg.market)) poolByMarket.set(leg.market, []);
      poolByMarket.get(leg.market)!.push(leg);
    }
    const availableMarkets = Array.from(poolByMarket.keys()).filter(m => markets.includes(m));
    
    // Generate market-balanced seed states
    const seedStates: State[] = [];
    const seedsPerMarket = Math.max(1, Math.floor(NUM_SEEDS / availableMarkets.length));
    
    for (const market of availableMarkets) {
      const marketLegs = poolByMarket.get(market) || [];
      const numSeeds = Math.min(seedsPerMarket, marketLegs.length);
      
      for (let s = 0; s < numSeeds; s++) {
        const startIdx = Math.floor(rand() * marketLegs.length);
        const startLeg = marketLegs[startIdx];
        
        if (startLeg.odds < ODDS_MIN || startLeg.odds > ODDS_MAX) continue;
        
        const used = new Map<number, Set<string>>();
        const mset = new Set<string>();
        mset.add(startLeg.market);
        used.set(startLeg.fixtureId, mset);
        
        seedStates.push({
          legs: [startLeg],
          product: startLeg.odds,
          used,
          avgEdge: 0,
        });
      }
    }
    
    console.log(`[stochastic-search] Generated ${seedStates.length} market-balanced seeds from ${availableMarkets.length} markets: ${availableMarkets.join(', ')}`);
    
    // Also add empty state
    seedStates.push({ legs: [], product: 1, used: new Map(), avgEdge: 0 });
    
    let beam: State[] = seedStates;
    let expansions = 0;

    for (let depth = 0; depth < targetN && Date.now() - attemptStart < ATTEMPT_TIMEOUT; depth++) {
      const next: State[] = [];

      for (const state of beam) {
        if (expansions > MAX_EVALUATIONS) break;
        
        for (const cand of sortedPool) {
          if (expansions > MAX_EVALUATIONS) break;
          
          if (cand.odds < ODDS_MIN || cand.odds > ODDS_MAX) continue;
          
          const set = state.used.get(cand.fixtureId);
          if (set && set.has(cand.market)) continue;

          const newProduct = state.product * cand.odds;
          
          if (newProduct > targetMax * 1.5) continue; // Aggressive pruning
          
          const remainingSlots = targetN - state.legs.length - 1;
          const maxPossibleProduct = newProduct * Math.pow(maxOddsInPool, remainingSlots);
          if (state.legs.length + 1 >= minLegs && maxPossibleProduct < targetMin * 0.5) continue;

          const newLegs = [...state.legs, cand];
          
          // Deep copy the used map (shallow copy shares Set references causing constraint bleeding!)
          const newUsed = new Map<number, Set<string>>();
          for (const [fid, markets] of state.used.entries()) {
            newUsed.set(fid, new Set(markets));
          }
          const mset = newUsed.get(cand.fixtureId) || new Set<string>();
          mset.add(cand.market);
          newUsed.set(cand.fixtureId, mset);
          
          const totalEdge = newLegs.reduce((sum, leg) => {
            const edgePct = leg.combinedAvg && leg.odds > 1 
              ? ((1 / leg.odds) / leg.combinedAvg - 1) * 100 
              : 0;
            return sum + edgePct;
          }, 0);
          const avgEdge = newLegs.length > 0 ? totalEdge / newLegs.length : 0;

          expansions++;
          totalExpansions++;

          const withinBand = newLegs.length >= minLegs && newProduct >= targetMin && newProduct <= targetMax;
          
          if (withinBand) {
            if (!bestInBand || avgEdge > bestInBand.avgEdge || 
                (avgEdge === bestInBand.avgEdge && Math.abs(newLegs.length - targetN) < Math.abs(bestInBand.legs.length - targetN))) {
              bestInBand = { legs: newLegs, product: newProduct, avgEdge };
              console.log(`[stochastic-search] Found in-band solution: ${newLegs.length} legs, ${newProduct.toFixed(2)}x, avgEdge=${avgEdge.toFixed(2)}%`);
            }
          }
          
          if (newLegs.length >= minLegs) {
            if (!bestNearMiss || Math.abs(Math.log(newProduct) - logMid) < Math.abs(Math.log(bestNearMiss.product) - logMid)) {
              bestNearMiss = { legs: newLegs, product: newProduct };
            }
          }

          next.push({ legs: newLegs, product: newProduct, used: newUsed, avgEdge });
        }
        
        if (expansions > MAX_EVALUATIONS) break;
      }

      next.sort((a, b) => score(a.product, a.legs.length, a.avgEdge, targetN) - score(b.product, b.legs.length, b.avgEdge, targetN));
      beam = next.slice(0, WIDTH);
      if (beam.length === 0) break;
    }
    
    console.log(`[stochastic-search] Attempt ${attemptIdx + 1} complete: ${expansions} expansions in ${Date.now() - attemptStart}ms`);
    
    // If we found an in-band solution, we can return early (but keep searching if time allows for better solutions)
    if (bestInBand && Date.now() - startTime > TOTAL_TIMEOUT * 0.5) {
      console.log(`[stochastic-search] Found good solution, stopping early`);
      break;
    }
  }

  const totalTime = Date.now() - startTime;
  
  console.log(`[stochastic-search] Complete: sampled_legs=${sampledLegsAttempts.join(',')}, pool=${pool.length}, evaluated=${totalExpansions}, time=${totalTime}ms, found_in_range=${!!bestInBand}`);

  if (bestInBand) {
    const marketDist: Record<string, number> = {};
    for (const leg of bestInBand.legs) {
      marketDist[leg.market] = (marketDist[leg.market] || 0) + 1;
    }
    console.log(`[stochastic-search] Best ticket market distribution: ${JSON.stringify(marketDist)}`);
    
    return {
      total_odds: Math.round(bestInBand.product * 100) / 100, 
      legs: bestInBand.legs, 
      attempts: totalExpansions,
      within_band: true,
      sampled_legs_attempts: sampledLegsAttempts,
      time_ms: totalTime,
    };
  }
  
  if (bestNearMiss) {
    return {
      total_odds: Math.round(bestNearMiss.product * 100) / 100,
      legs: bestNearMiss.legs,
      attempts: totalExpansions,
      within_band: false,
      best_nearby: {
        total_odds: Math.round(bestNearMiss.product * 100) / 100,
        legs: bestNearMiss.legs,
      },
      sampled_legs_attempts: sampledLegsAttempts,
      time_ms: totalTime,
    };
  }
  
  return null;
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
  let skippedInvalidBets = 0;
  let skippedInvalidValues = 0;
  let skippedInvalidOdds = 0;
  
  // Official API-Football bet IDs for full match totals only
  const OFFICIAL_BET_IDS: Record<number, string> = {
    5: "goals",    // Goals Over/Under (full match)
    45: "corners", // Corners Over/Under (full match)
    80: "cards",   // Cards Over/Under (full match)
  };
  
  for (const bookmaker of bookmakers) {
    const bookmakerName = bookmaker.name || `Bookmaker ${bookmaker.id}`;
    for (const bet of bookmaker.bets || []) {
      const betId = bet?.id;
      const market = OFFICIAL_BET_IDS[betId];
      
      // STRICT: Only accept official bet IDs
      if (!market) {
        skippedInvalidBets++;
        continue;
      }
      
      for (const value of bet.values || []) {
        const valueStr = String(value.value || "").trim();
        
        // STRICT: Use strict parsing that rejects 1H/2H/team/Asian variants
        const parsed = parseValueStringStrict(valueStr);
        if (!parsed) {
          skippedInvalidValues++;
          continue;
        }
        
        const odds = Number(value.odd);
        
        // STRICT: Validate odds are finite and > 1.0
        if (!Number.isFinite(odds) || odds <= 1.01) {
          skippedInvalidOdds++;
          continue;
        }
        
        // STRICT: Validate line is finite
        if (!Number.isFinite(parsed.line)) {
          skippedInvalidValues++;
          continue;
        }
        
        selections.push({
          bookmaker: bookmakerName,
          market: market,
          kind: parsed.side,
          odds: odds,
          line: parsed.line,
          scope: "full",
        });
      }
    }
  }
  
  if (skippedInvalidBets > 0 || skippedInvalidValues > 0 || skippedInvalidOdds > 0) {
    console.log(`[flattenOddsPayload] Skipped: ${skippedInvalidBets} invalid bet IDs, ${skippedInvalidValues} invalid values, ${skippedInvalidOdds} invalid odds`);
  }
  
  return selections;
}

// STRICT parser for full match totals only
function parseValueStringStrict(valueStr: string): { side: "over" | "under"; line: number } | null {
  const lower = valueStr.toLowerCase().trim();
  
  // Reject anything that looks like 1st half, 2nd half, team-specific, or Asian variants
  if (
    lower.includes("1st half") ||
    lower.includes("2nd half") ||
    lower.includes("1h") ||
    lower.includes("2h") ||
    lower.includes("home") ||
    lower.includes("away") ||
    lower.includes("asian") ||
    lower.includes("team")
  ) {
    return null;
  }
  
  // Accept only "Over X.Y" or "Under X.Y" where X.Y is a decimal number
  const overMatch = lower.match(/^over\s+([\d.]+)$/);
  const underMatch = lower.match(/^under\s+([\d.]+)$/);
  
  if (overMatch) {
    const line = parseFloat(overMatch[1]);
    return Number.isFinite(line) ? { side: "over", line } : null;
  }
  if (underMatch) {
    const line = parseFloat(underMatch[1]);
    return Number.isFinite(line) ? { side: "under", line } : null;
  }
  
  return null;
}

// DEPRECATED: Nearest-line fallback removed to ensure correctness
// If you need this functionality, require explicit user opt-in and display actual line used
function findNearestLine(
  bookmakers: any[],
  marketName: string,
  targetLine: number
): { odds: number; bookmaker: string } | null {
  console.warn("[findNearestLine] DEPRECATED: Nearest-line matching disabled for correctness");
  return null;
}
