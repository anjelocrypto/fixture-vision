import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { checkSuspiciousOdds } from "../_shared/suspicious_odds_guards.ts";
import { ODDS_MIN, ODDS_MAX } from "../_shared/config.ts";
import { RULES, RULES_VERSION, pickFromCombined, type StatMarket } from "../_shared/rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const RequestSchema = z.object({
  date: z.string(),
  market: z.enum(["goals", "cards", "corners", "fouls", "offsides"]),
  line: z.number(),
  side: z.enum(["over", "under"]).default("over").optional(),
  minOdds: z.number().min(1.0).optional(),
  countryCode: z.string().optional(),
  leagueIds: z.array(z.number().int().positive()).optional(),
  live: z.boolean().optional(),
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
        JSON.stringify({ error: "Invalid request parameters", details: validation.error.format() }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
      );
    }

    const { 
      date, 
      market, 
      line, 
      side = "over",
      minOdds = 1.0, 
      countryCode, 
      leagueIds, 
      live = false 
    } = validation.data;

    // Get the qualification range for this market/line combination
    const rules = RULES[market as StatMarket];
    // Validate that the requested (market, side, line) has a qualification rule
    const hasValidRule = rules?.some(r => r.pick && r.pick.side === side && r.pick.line === line);
    
    if (!hasValidRule) {
      console.warn(`[filterizer-query] No qualification rule found for ${market} ${side} ${line}`);
      return new Response(
        JSON.stringify({ 
          selections: [], 
          count: 0, 
          window: { start: new Date(date).toISOString(), end: new Date(date).toISOString() },
          filters: { market, side, line, minOdds },
          warning: `No qualification rule found for ${market} ${side} ${line}`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log(`[filterizer-query] market=${market} side=${side} line=${line} minOdds=${minOdds} rules=${RULES_VERSION}`);

    // Calculate 7-day window from date (query from selected date, not from "now")
    const startDate = new Date(date);
    startDate.setUTCHours(0, 0, 0, 0);
    
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + 7);
    endDate.setUTCHours(23, 59, 59, 999);
    
    const queryStart = startDate;

    console.log(`[filterizer-query] window=[${queryStart.toISOString()} → ${endDate.toISOString()}]`);

    // Build query for selections - READ ONLY PRE-QUALIFIED ROWS
    // Enforce global odds band [1.25, 5.00] regardless of user input
    const effectiveMinOdds = Math.max(minOdds, ODDS_MIN);
    const effectiveMaxOdds = ODDS_MAX;
    
    let query = supabaseClient
      .from("optimized_selections")
      .select("*")
      .eq("market", market)
      .eq("side", side)
      .eq("rules_version", RULES_VERSION) // Only qualified selections from current matrix
      .gte("odds", effectiveMinOdds)
      .lte("odds", effectiveMaxOdds)
      .eq("is_live", live)
      .gte("utc_kickoff", queryStart.toISOString())
      .lte("utc_kickoff", endDate.toISOString());

    // Filter by line (with small tolerance)
    query = query.gte("line", line - 0.01).lte("line", line + 0.01);

    // Scope by country or leagues
    if (leagueIds && leagueIds.length > 0) {
      query = query.in("league_id", leagueIds);
    } else if (countryCode) {
      query = query.eq("country_code", countryCode);
    }

    // Sort by odds DESC so best per fixture is first, then kickoff
    query = query.order("odds", { ascending: false }).order("utc_kickoff", { ascending: true });

    const { data: selections, error: selectionsError } = await query;

    if (selectionsError) {
      console.error("[filterizer-query] Error fetching selections:", selectionsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch selections" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const rawCount = selections?.length || 0;
    console.log(`[filterizer-query] Stage 1: in_window=${rawCount}`);

    // Post-filter: defensive qualification check using pickFromCombined
    let qualifiedDropped = 0;
    let suspiciousDropped = 0;
    
    const rows = (selections || []).filter((row: any) => {
      // Defensive: Check combined value qualification using pickFromCombined (inclusive bounds)
      if (row.combined_snapshot && row.combined_snapshot[market] !== undefined) {
        const combinedValue = Number(row.combined_snapshot[market]);
        const expectedPick = pickFromCombined(market as StatMarket, combinedValue);
        
        // Verify the selection matches what the combined value should qualify for
        if (!expectedPick || expectedPick.side !== side || expectedPick.line !== line) {
          qualifiedDropped++;
          console.warn(`[filterizer-query] NOT_QUALIFIED: ${market}=${combinedValue.toFixed(2)} → expected ${expectedPick?.side} ${expectedPick?.line}, got ${side} ${line} (fixture ${row.fixture_id})`);
          return false;
        }
      } else if (row.combined_snapshot) {
        // Snapshot exists but market key is missing - log warning but keep (backward compat)
        console.warn(`[filterizer-query] Missing combined_snapshot.${market} for fixture ${row.fixture_id}, keeping row`);
      }
      
      // Check suspicious odds
      const suspiciousWarning = checkSuspiciousOdds(
        market as any,
        Number(row.line),
        Number(row.odds)
      );
      
      if (suspiciousWarning) {
        suspiciousDropped++;
        console.warn(`[filterizer-query] SUSPICIOUS: ${suspiciousWarning} (fixture ${row.fixture_id}, ${row.bookmaker})`);
        return false;
      }
      
      return true;
    });

    const qualifiedCount = rows.length;
    console.log(`[filterizer-query] Stage 2: qualified=${qualifiedCount} (dropped: not_qualified=${qualifiedDropped}, suspicious=${suspiciousDropped})`);

    // Dedupe: keep best odds per (fixture, market) - use composite key for consistency with ticket creator
    const bestByFixtureMarket = new Map<string, any>();
    for (const row of rows) {
      const key = `${row.fixture_id}|${row.market}`;
      const prev = bestByFixtureMarket.get(key);
      if (!prev || Number(row.odds) > Number(prev.odds)) {
        bestByFixtureMarket.set(key, row);
      }
    }
    const deduped = Array.from(bestByFixtureMarket.values()).sort((a, b) => new Date(a.utc_kickoff).getTime() - new Date(b.utc_kickoff).getTime());
    
    console.log(`[filterizer-query] Stage 3: dedup=${deduped.length} (removed ${qualifiedCount - deduped.length} duplicate bookmakers)`);

    // Fetch fixture metadata for enrichment
    const fixtureIds = deduped.map((row: any) => row.fixture_id);
    const { data: fixtures, error: fixturesError } = await supabaseClient
      .from("fixtures")
      .select("id, teams_home, teams_away, league_id")
      .in("id", fixtureIds);

    if (fixturesError) {
      console.error("[filterizer-query] Error fetching fixtures:", fixturesError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch fixture metadata" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // Create fixture lookup map
    const fixtureMap = new Map(
      (fixtures || []).map((f: any) => [f.id, f])
    );

    // Enrich with fixture metadata
    const enriched = deduped.map((row: any) => {
      const fixture = fixtureMap.get(row.fixture_id);
      return {
        id: row.id,
        fixture_id: row.fixture_id,
        league_id: row.league_id,
        country_code: row.country_code,
        utc_kickoff: row.utc_kickoff,
        market: row.market,
        side: row.side,
        line: row.line,
        bookmaker: row.bookmaker,
        odds: row.odds,
        is_live: row.is_live,
        edge_pct: row.edge_pct,
        model_prob: row.model_prob,
        sample_size: row.sample_size,
        combined_snapshot: row.combined_snapshot,
        // Fixture metadata
        home_team: fixture?.teams_home?.name || 'Unknown',
        away_team: fixture?.teams_away?.name || 'Unknown',
        home_team_logo: fixture?.teams_home?.logo,
        away_team_logo: fixture?.teams_away?.logo,
      };
    });

    console.log(`[filterizer-query] Final: ${enriched.length} selections returned`);

    return new Response(
      JSON.stringify({
        selections: enriched,
        count: enriched.length,
        window: { start: queryStart.toISOString(), end: endDate.toISOString() },
        filters: { market, side, line, minOdds, rulesVersion: RULES_VERSION },
        debug: {
          stages: {
            in_window: rawCount,
            qualified: qualifiedCount,
            dropped_not_qualified: qualifiedDropped,
            dropped_suspicious: suspiciousDropped,
            deduped: deduped.length,
            final: enriched.length,
          }
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[filterizer-query] Internal error:", {
      message: error instanceof Error ? error.message : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
