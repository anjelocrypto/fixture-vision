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
    const { fixtureId, markets, bookmakers } = await req.json();
    
    const API_KEY = Deno.env.get("API_FOOTBALL_KEY");
    if (!API_KEY) {
      throw new Error("API_FOOTBALL_KEY not configured");
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log(`[fetch-odds] Fetching odds for fixture ${fixtureId}`);

    // Check cache (30 min TTL)
    const { data: cachedOdds } = await supabaseClient
      .from("odds_cache")
      .select("*")
      .eq("fixture_id", fixtureId)
      .gte("captured_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .single();

    if (cachedOdds) {
      console.log(`[fetch-odds] Cache hit for fixture ${fixtureId}`);
      return new Response(
        JSON.stringify({ ...cachedOdds, cache_hit: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[fetch-odds] Cache miss for fixture ${fixtureId}, fetching from API`);

    // Fetch from API-Football
    let url = `https://v3.football.api-sports.io/odds?fixture=${fixtureId}`;
    
    const response = await fetch(url, {
      headers: {
        "x-apisports-key": API_KEY,
      },
    });

    if (!response.ok) {
      throw new Error(`API-Football error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.response || data.response.length === 0) {
      return new Response(
        JSON.stringify({ available: false, fixture_id: fixtureId }),
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

    // Cache the odds
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

    return new Response(
      JSON.stringify({ ...normalizedOdds, cache_hit: false }),
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
