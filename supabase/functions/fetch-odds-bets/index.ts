import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const API_KEY = Deno.env.get("API_FOOTBALL_KEY");
    if (!API_KEY) {
      throw new Error("API_FOOTBALL_KEY not configured");
    }

    // Detect if this is a RapidAPI key
    const isRapidAPI = API_KEY.includes("jsn") || API_KEY.length > 40;

    console.log(`[fetch-odds-bets] Fetching available bet markets`);

    const url = isRapidAPI
      ? "https://api-football-v1.p.rapidapi.com/v3/odds/bets"
      : "https://v3.football.api-sports.io/odds/bets";
    
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
    
    console.log(`[fetch-odds-bets] Found ${data.response?.length || 0} bet types`);

    return new Response(
      JSON.stringify({
        bets: data.response || [],
        count: data.response?.length || 0
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[fetch-odds-bets] Error:", error);
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
