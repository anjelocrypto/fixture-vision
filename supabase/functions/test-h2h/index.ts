import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { API_BASE, apiHeaders } from "../_shared/api.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    console.log("[test-h2h] Testing API-Football H2H endpoint");

    // Test with Manchester United (33) vs Liverpool (40)
    // These are well-known teams with lots of history
    const team1 = 33; // Manchester United
    const team2 = 40; // Liverpool
    
    const url = `${API_BASE}/fixtures/headtohead?h2h=${team1}-${team2}&last=5`;
    console.log(`[test-h2h] Request URL: ${url}`);
    
    const response = await fetch(url, { headers: apiHeaders() });
    
    if (!response.ok) {
      console.error(`[test-h2h] API Error: HTTP ${response.status}`);
      const errorText = await response.text();
      return new Response(
        JSON.stringify({ 
          error: `API returned ${response.status}`,
          details: errorText,
          url 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: response.status }
      );
    }
    
    const data = await response.json();
    console.log(`[test-h2h] Response received:`, JSON.stringify(data, null, 2));
    
    // Extract useful information
    const fixtures = data?.response || [];
    const summary = {
      total_matches: fixtures.length,
      endpoint_works: fixtures.length > 0,
      sample_matches: fixtures.slice(0, 3).map((f: any) => ({
        fixture_id: f?.fixture?.id,
        date: f?.fixture?.date,
        league: f?.league?.name,
        home_team: f?.teams?.home?.name,
        away_team: f?.teams?.away?.name,
        score: `${f?.goals?.home}-${f?.goals?.away}`,
        status: f?.fixture?.status?.short,
      })),
      leagues_found: [...new Set(fixtures.map((f: any) => f?.league?.name))],
    };
    
    console.log("[test-h2h] Summary:", JSON.stringify(summary, null, 2));
    
    return new Response(
      JSON.stringify({
        success: true,
        test_teams: `${team1} vs ${team2} (Man Utd vs Liverpool)`,
        endpoint: url,
        summary,
        full_response: data,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[test-h2h] Error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
