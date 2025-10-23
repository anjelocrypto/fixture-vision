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

    const API_KEY = Deno.env.get("API_FOOTBALL_KEY");
    if (!API_KEY) {
      throw new Error("API_FOOTBALL_KEY not configured");
    }

    const isRapidAPI = API_KEY.includes("jsn") || API_KEY.length > 40;

    console.log(`[fetch-odds-bets] User ${user.id} fetching available bet markets`);

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
      console.error(`[fetch-odds-bets] API error: ${response.status}`);
      return new Response(
        JSON.stringify({ error: "API error" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
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
    console.error("[fetch-odds-bets] Internal error:", {
      message: error instanceof Error ? error.message : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
