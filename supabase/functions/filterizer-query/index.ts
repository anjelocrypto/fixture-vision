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
  showAllOdds: z.boolean().optional(), // NEW: show all bookmaker odds instead of best per fixture
  includeModelOnly: z.boolean().optional(), // NEW: include model-only selections (no odds)
  allLeagues: z.boolean().optional(), // NEW: all leagues mode (next 120h)
  dayRange: z.enum(["all", "today", "next_2_days", "next_3_days"]).optional(), // NEW: date filter like Ticket Creator
  limit: z.number().int().positive().max(200).optional(), // pagination
  offset: z.number().int().min(0).optional(), // pagination
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
      live = false,
      showAllOdds = false,
      includeModelOnly = true, // Default to true
      allLeagues = false,
      dayRange = "all", // Default to all (no date restriction)
      limit = 50,
      offset = 0
    } = validation.data;

    // Cap limit at 100 for all-leagues mode to prevent huge responses
    const effectiveLimit = allLeagues ? Math.min(limit, 100) : limit;

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
    
    console.log(`[filterizer-query] market=${market} side=${side} line=${line} minOdds=${minOdds} allLeagues=${allLeagues} dayRange=${dayRange} rules=${RULES_VERSION}`);
    
    if (allLeagues) {
      console.log(`[filterizer-query] allLeagues mode enabled - querying all leagues for next 120 hours`);
    }

    // Calculate time window based on mode and dayRange
    let startDate: Date;
    let endDate: Date;
    
    if (allLeagues) {
      // All-leagues mode: next 120 hours from now
      startDate = new Date();
      endDate = new Date();
      endDate.setTime(endDate.getTime() + (120 * 60 * 60 * 1000)); // now + 120 hours
    } else if (dayRange !== "all") {
      // Day range mode: filter by selected range (same logic as Ticket Creator)
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0); // Start of today (midnight local time)
      endDate = new Date(startDate);
      
      switch (dayRange) {
        case "today":
          endDate.setDate(endDate.getDate() + 1); // End of today (midnight tomorrow)
          break;
        case "next_2_days":
          endDate.setDate(endDate.getDate() + 2); // Today + tomorrow (midnight in 2 days)
          break;
        case "next_3_days":
          endDate.setDate(endDate.getDate() + 3); // Today + next 2 days (midnight in 3 days)
          break;
      }
      
      // DEBUG: Log date filter details for audit
      const fromTs = Math.floor(startDate.getTime() / 1000);
      const toTs = Math.floor(endDate.getTime() / 1000);
      console.log(`[filterizer] date filter`, {
        dayRange,
        fromTs,
        toTs,
        fromIso: startDate.toISOString(),
        toIso: endDate.toISOString(),
        windowHours: Math.round((toTs - fromTs) / 3600),
      });
    } else {
      // Normal mode: 7-day window from selected date
      startDate = new Date(date);
      startDate.setUTCHours(0, 0, 0, 0);
      
      endDate = new Date(startDate);
      endDate.setUTCDate(endDate.getUTCDate() + 7);
      endDate.setUTCHours(23, 59, 59, 999);
    }
    
    const queryStart = startDate;

    console.log(`[filterizer-query] window=[${queryStart.toISOString()} → ${endDate.toISOString()}]`);

    // Build query for selections - READ ONLY PRE-QUALIFIED ROWS
    // Enforce global odds band [1.25, 5.00] regardless of user input
    const effectiveMinOdds = Math.max(minOdds, ODDS_MIN);
    const effectiveMaxOdds = ODDS_MAX;

    // Resolve league scoping: prefer explicit leagueIds; otherwise, resolve by country -> leagues
    // Skip this entirely in all-leagues mode
    let scopeLeagueIds: number[] | undefined = allLeagues ? undefined : leagueIds;
    if (!allLeagues && (!scopeLeagueIds || scopeLeagueIds.length === 0) && countryCode) {
      // Lookup country id by ISO2 code
      const { data: countryRow, error: countryErr } = await supabaseClient
        .from("countries")
        .select("id")
        .eq("code", countryCode)
        .maybeSingle();
      if (countryErr) {
        console.warn(`[filterizer] Country lookup failed for ${countryCode}:`, countryErr.message);
      }

      if (countryRow?.id) {
        const { data: leagueRows, error: leaguesErr } = await supabaseClient
          .from("leagues")
          .select("id")
          .eq("country_id", countryRow.id);
        if (leaguesErr) {
          console.warn(`[filterizer] League lookup failed for country ${countryCode}:`, leaguesErr.message);
        }
        const resolved = (leagueRows || []).map((l: any) => l.id);
        if (resolved.length > 0) {
          scopeLeagueIds = resolved;
          console.log(`[filterizer] Resolved ${resolved.length} leagues for country ${countryCode}`);
        } else {
          console.warn(`[filterizer] No leagues resolved for ${countryCode}; will fall back to country_code column (may be NULL)`);
        }
      }
    }
    
    // Stage counters (computed via lightweight count queries)
    // NOTE: is_live is reserved for future live markets feature.
    // For now, we only serve pre-match rows (is_live = false) in the UI.
    // Backend: optimized_selections table contains is_live column.
    // Frontend: All user-facing queries use pre-match views (v_selections_prematch, etc.)
    const scopeType = allLeagues 
      ? "all_leagues"
      : (scopeLeagueIds && scopeLeagueIds.length > 0)
        ? "leagues"
        : (countryCode ? "country" : "global");

    // Global in-window count (no scoping)
    // P2 FIX: Defensive filter - ensure count queries respect is_live flag
    const baseGlobal = supabaseClient
      .from("optimized_selections")
      .select("id", { count: "exact", head: true })
      .eq("rules_version", RULES_VERSION)
      .eq("is_live", live)
      .gte("utc_kickoff", queryStart.toISOString())
      .lte("utc_kickoff", endDate.toISOString());
    const { count: inWindow } = await baseGlobal;

    // Scoped in-window count (applies when scopeType != 'global' and !allLeagues)
    let baseScoped = supabaseClient
      .from("optimized_selections")
      .select("id", { count: "exact", head: true })
      .eq("rules_version", RULES_VERSION)
      .eq("is_live", live)
      .gte("utc_kickoff", queryStart.toISOString())
      .lte("utc_kickoff", endDate.toISOString());
    if (!allLeagues) {
      if (scopeLeagueIds && scopeLeagueIds.length > 0) {
        // @ts-ignore
        baseScoped = (baseScoped as any).in("league_id", scopeLeagueIds);
      } else if (countryCode) {
        // @ts-ignore
        baseScoped = (baseScoped as any).eq("country_code", countryCode);
      }
    }
    const { count: scopeCount } = await baseScoped;

    // Market-matched count (no odds yet)
    let marketScope = supabaseClient
      .from("optimized_selections")
      .select("id", { count: "exact", head: true })
      .eq("rules_version", RULES_VERSION)
      .eq("is_live", live)
      .gte("utc_kickoff", queryStart.toISOString())
      .lte("utc_kickoff", endDate.toISOString())
      .eq("market", market)
      .eq("side", side)
      .gte("line", line - 0.01)
      .lte("line", line + 0.01);
    if (!allLeagues) {
      if (scopeLeagueIds && scopeLeagueIds.length > 0) {
        // @ts-ignore
        marketScope = (marketScope as any).in("league_id", scopeLeagueIds);
      } else if (countryCode) {
        // @ts-ignore
        marketScope = (marketScope as any).eq("country_code", countryCode);
      }
    }
    const { count: marketMatched } = await marketScope;

    // Min-odds-kept count (apply global band and min)
    let oddsScope = supabaseClient
      .from("optimized_selections")
      .select("id", { count: "exact", head: true })
      .eq("rules_version", RULES_VERSION)
      .eq("is_live", live)
      .gte("utc_kickoff", queryStart.toISOString())
      .lte("utc_kickoff", endDate.toISOString())
      .eq("market", market)
      .eq("side", side)
      .gte("line", line - 0.01)
      .lte("line", line + 0.01)
      .gte("odds", effectiveMinOdds)
      .lte("odds", effectiveMaxOdds);
    if (!allLeagues) {
      if (scopeLeagueIds && scopeLeagueIds.length > 0) {
        // @ts-ignore
        oddsScope = (oddsScope as any).in("league_id", scopeLeagueIds);
      } else if (countryCode) {
        // @ts-ignore
        oddsScope = (oddsScope as any).eq("country_code", countryCode);
      }
    }
    const { count: minOddsKept } = await oddsScope;

    // Final data query applying all filters - USE PRE-MATCH VIEW for automatic status filtering
    let query = supabaseClient
      .from("v_selections_prematch")
      .select("*")
      .eq("market", market)
      .eq("side", side)
      .eq("rules_version", RULES_VERSION) // Only qualified selections from current matrix
      .eq("is_live", live)
      .gte("utc_kickoff", queryStart.toISOString())
      .lte("utc_kickoff", endDate.toISOString());

    // Filter by line (with small tolerance)
    query = query.gte("line", line - 0.01).lte("line", line + 0.01);

    // Handle odds filtering based on includeModelOnly flag
    if (includeModelOnly) {
      // When includeModelOnly is ON: (odds >= min AND odds <= max) OR (odds IS NULL)
      // Supabase PostgREST doesn't support direct OR in query builder, so we'll filter in-app
      // For now, just don't filter by odds - we'll handle it post-query
    } else {
      // When includeModelOnly is OFF: require odds in range (same as before)
      query = query.gte("odds", effectiveMinOdds).lte("odds", effectiveMaxOdds);
    }

    // Scope by league (preferred) or country_code fallback - skip in all-leagues mode
    if (!allLeagues) {
      if (scopeLeagueIds && scopeLeagueIds.length > 0) {
        query = query.in("league_id", scopeLeagueIds);
      } else if (countryCode) {
        query = query.eq("country_code", countryCode);
      }
    }

    // Sort strategy:
    // - allLeagues mode: sort by utc_kickoff ASC (earliest matches first)
    // - showAllOdds=true: sort by odds ASC (lowest first)
    // - showAllOdds=false: sort by odds DESC (highest first) for best-per-fixture mode
    if (allLeagues) {
      query = query
        .order("utc_kickoff", { ascending: true })
        .order("odds", { ascending: false }) // Best odds first within each time slot
        .order("fixture_id", { ascending: true })
        .order("bookmaker", { ascending: true });
    } else {
      const oddsOrder = showAllOdds ? true : false; // ASC for all odds, DESC for best per fixture
      query = query
        .order("odds", { ascending: oddsOrder })
        .order("utc_kickoff", { ascending: true })
        .order("fixture_id", { ascending: true })
        .order("bookmaker", { ascending: true });
    }

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

    // Post-filter: defensive qualification check using pickFromCombined + odds filtering
    let qualifiedDropped = 0;
    let suspiciousDropped = 0;
    let oddsFiltered = 0;
    
    const rows = (selections || []).filter((row: any) => {
      // Handle odds filtering when includeModelOnly is ON
      if (includeModelOnly) {
        // Keep rows with: (odds >= min AND odds <= max) OR (odds IS NULL)
        const hasOdds = row.odds !== null && row.odds !== undefined;
        if (hasOdds) {
          if (row.odds < effectiveMinOdds || row.odds > effectiveMaxOdds) {
            oddsFiltered++;
            return false;
          }
        }
        // If odds is NULL, keep it (model-only)
      }
      
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
      
      // Check suspicious odds (only if odds exist)
      if (row.odds !== null && row.odds !== undefined) {
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
      }
      
      return true;
    });

    // Sort: priced first (by odds DESC), then model-only (by model_prob DESC, then combined value DESC)
    const sorted = rows.sort((a: any, b: any) => {
      const aHasOdds = a.odds !== null && a.odds !== undefined;
      const bHasOdds = b.odds !== null && b.odds !== undefined;
      
      // Priced rows come first
      if (aHasOdds && !bHasOdds) return -1;
      if (!aHasOdds && bHasOdds) return 1;
      
      // Both priced: sort by odds DESC (highest first)
      if (aHasOdds && bHasOdds) {
        return (b.odds || 0) - (a.odds || 0);
      }
      
      // Both model-only: sort by model_prob DESC, then combined value DESC
      const aProb = a.model_prob || 0;
      const bProb = b.model_prob || 0;
      if (aProb !== bProb) return bProb - aProb;
      
      const aCombined = a.combined_snapshot?.[market] || 0;
      const bCombined = b.combined_snapshot?.[market] || 0;
      if (aCombined !== bCombined) return bCombined - aCombined;
      
      // Tie-breaker: kickoff time
      return new Date(a.utc_kickoff).getTime() - new Date(b.utc_kickoff).getTime();
    });

    const qualifiedCount = sorted.length;
    console.log(`[filterizer-query] Stage 2: qualified=${qualifiedCount} (dropped: not_qualified=${qualifiedDropped}, suspicious=${suspiciousDropped}, odds_filtered=${oddsFiltered})`);

    // Dedupe or keep all based on showAllOdds
    let deduped: any[];
    if (showAllOdds) {
      // Keep all odds, apply pagination (using effectiveLimit)
      deduped = sorted.slice(offset, offset + effectiveLimit);
      console.log(`[filterizer-query] Stage 3: showAllOdds=true, paginated=${deduped.length} (total=${qualifiedCount}, offset=${offset}, limit=${effectiveLimit})`);
    } else {
      // Dedupe: keep best per fixture (priced > model-only, highest odds for priced)
      const bestByFixture = new Map<number, any>();
      for (const row of sorted) {
        const fixtureId = row.fixture_id;
        if (!bestByFixture.has(fixtureId)) {
          bestByFixture.set(fixtureId, row);
        }
      }
      const uniqueFixtures = Array.from(bestByFixture.values());
      // Apply pagination after dedup (using effectiveLimit)
      deduped = uniqueFixtures.slice(offset, offset + effectiveLimit);
      console.log(`[filterizer-query] Stage 3: dedup=${uniqueFixtures.length} unique fixtures (removed ${qualifiedCount - uniqueFixtures.length} duplicate bookmakers), paginated=${deduped.length}`);
    }

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

    // Acceptance-style logging
    console.log(`[filterizer] market=${market} side=${side} line=${line} minOdds=${minOdds.toFixed(2)} rules=${RULES_VERSION}`);
    console.log(`[filterizer] window=[${queryStart.toISOString()} → ${endDate.toISOString()}] scope=${scopeType}`);
    console.log(`[filterizer] counts: in_window=${inWindow || 0} → scope_count=${scopeCount || 0} → market_matched=${marketMatched || 0} → min_odds_kept=${minOddsKept || 0} → qualified_kept=${qualifiedCount} → final=${enriched.length}`);

    // Reasons (only when empty)
    const reasons = enriched.length === 0 ? [
      `in_window=${inWindow || 0}`,
      `market_matched=${marketMatched || 0}`,
      `min_odds_kept=${minOddsKept || 0}`,
      `qualified_kept=${qualifiedCount}`,
      `final=${enriched.length}`,
    ] : undefined;

    return new Response(
      JSON.stringify({
        selections: enriched,
        count: enriched.length,
        total_qualified: qualifiedCount, // Total before pagination
        scope: scopeType,
        scope_count: scopeCount || 0,
        window: { start: queryStart.toISOString(), end: endDate.toISOString() },
        filters: { market, side, line, minOdds, showAllOdds, rulesVersion: RULES_VERSION },
        pagination: { limit: effectiveLimit, offset, has_more: showAllOdds && (offset + effectiveLimit < qualifiedCount) },
        debug: {
          counters: {
            in_window: inWindow || 0,
            scope_count: scopeCount || 0,
            market_matched: marketMatched || 0,
            min_odds_kept: minOddsKept || 0,
            qualified_kept: qualifiedCount,
            final_count: enriched.length,
          },
          stages: {
            in_window_raw_query: inWindow || 0,
            qualified: qualifiedCount,
            dropped_not_qualified: qualifiedDropped,
            dropped_suspicious: suspiciousDropped,
            deduped: deduped.length,
            final: enriched.length,
          }
        },
        reasons
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
