import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fixtureId, markets, bookmakers, live = false, forceRefresh = false } = await req.json();
    
    const API_KEY = Deno.env.get("API_FOOTBALL_KEY");
    if (!API_KEY) {
      throw new Error("API_FOOTBALL_KEY not configured");
    }

    // Detect if this is a RapidAPI key
    const isRapidAPI = API_KEY.includes("jsn") || API_KEY.length > 40;

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const source = live ? "live" : "prematch";
    console.log(`[fetch-odds] Fetching ${source} odds for fixture ${fixtureId}`);

    // Check cache for pre-match only (30 min TTL)
    if (!live && !forceRefresh) {
      const { data: cachedOdds } = await supabaseClient
        .from("odds_cache")
        .select("*")
        .eq("fixture_id", fixtureId)
        .gte("captured_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .single();

      if (cachedOdds) {
        console.log(`[fetch-odds] Cache hit for fixture ${fixtureId}`);
        const selections = flattenOddsToSelections(fixtureId, cachedOdds.payload);
        return new Response(
          JSON.stringify({ 
            ...cachedOdds, 
            cache_hit: true,
            source: "prematch",
            selections 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    console.log(`[fetch-odds] ${forceRefresh ? 'Force refresh' : 'Cache miss'} for fixture ${fixtureId}, fetching from API`);

    // Fetch from API-Football (pre-match or live)
    const baseUrl = isRapidAPI
      ? "https://api-football-v1.p.rapidapi.com/v3"
      : "https://v3.football.api-sports.io";
    
    const endpoint = live ? `/odds/live?fixture=${fixtureId}` : `/odds?fixture=${fixtureId}`;
    const url = `${baseUrl}${endpoint}`;
    
    const headers: Record<string, string> = isRapidAPI
      ? {
          "x-rapidapi-key": API_KEY,
          "x-rapidapi-host": "api-football-v1.p.rapidapi.com"
        }
      : {
          "x-apisports-key": API_KEY
        };
    
    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`API-Football error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.response || data.response.length === 0) {
      return new Response(
        JSON.stringify({ 
          available: false, 
          fixture_id: fixtureId,
          source,
          selections: []
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normalize odds data
    const normalizedOdds = {
      fixture_id: fixtureId,
      available: true,
      bookmakers: data.response.map((bm: any) => ({
        id: bm.bookmaker.id,
        name: bm.bookmaker.name,
        markets: bm.bets.map((bet: any) => ({
          id: bet.id,
          name: bet.name,
          values: bet.values.map((v: any) => ({
            value: v.value,
            odd: v.odd,
          })),
        })),
      })),
      captured_at: new Date().toISOString(),
    };

    // Flatten to selections
    const selections = flattenOddsToSelections(fixtureId, normalizedOdds);

    // Cache the odds (pre-match only, not live)
    if (!live) {
      await supabaseClient
        .from("odds_cache")
        .upsert(
          {
            fixture_id: fixtureId,
            payload: normalizedOdds,
            bookmakers: bookmakers || [],
            markets: markets || [],
            captured_at: new Date().toISOString(),
          },
          { onConflict: "fixture_id" }
        );
    }

    console.log(`[fetch-odds] Found ${selections.length} selections for fixture ${fixtureId}`);

    return new Response(
      JSON.stringify({ 
        ...normalizedOdds, 
        cache_hit: false,
        source,
        selections
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[fetch-odds] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// Helper: Flatten odds payload to normalized selections array
function flattenOddsToSelections(fixtureId: number, payload: any): any[] {
  const selections: any[] = [];
  
  if (!payload.bookmakers) return selections;

  for (const bookmaker of payload.bookmakers) {
    for (const market of bookmaker.markets || []) {
      const marketName = (market.name || "").toLowerCase();
      const marketId = market.id;
      
      // Determine normalized market type
      let normalized = "other";
      let marketType = "other";
      
      if (marketName.includes("goals") || marketName.includes("total") && marketName.includes("goals")) {
        normalized = "goals";
        marketType = "ou";
      } else if (marketName.includes("corner")) {
        normalized = "corners";
        marketType = "ou";
      } else if (marketName.includes("card") || marketName.includes("booking")) {
        normalized = "cards";
        marketType = "ou";
      } else if (marketName.includes("offside")) {
        normalized = "offsides";
        marketType = "ou";
      } else if (marketName.includes("foul")) {
        normalized = "fouls";
        marketType = "ou";
      }

      // Parse market values (over/under pairs, etc.)
      for (const value of market.values || []) {
        const label = String(value.value || "").trim();
        const odds = parseFloat(value.odd);
        
        if (!label || isNaN(odds)) continue;

        let kind = "other";
        let line: number | undefined;

        // Parse Over/Under selections
        const overMatch = label.match(/(?:over|o)\s*([\d.]+)/i);
        const underMatch = label.match(/(?:under|u)\s*([\d.]+)/i);
        
        if (overMatch) {
          kind = "over";
          line = parseFloat(overMatch[1]);
        } else if (underMatch) {
          kind = "under";
          line = parseFloat(underMatch[1]);
        } else if (label.toLowerCase().includes("yes")) {
          kind = "yes";
        } else if (label.toLowerCase().includes("no")) {
          kind = "no";
        } else if (["1", "x", "2"].includes(label.toLowerCase())) {
          kind = label.toLowerCase();
        }

        selections.push({
          fixtureId,
          market: normalized,
          provider_market_id: marketId,
          label,
          kind,
          line,
          bookmaker: bookmaker.name,
          odds
        });
      }
    }
  }

  return selections;
}

