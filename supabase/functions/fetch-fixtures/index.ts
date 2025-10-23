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
    const { league, season, date } = await req.json();
    
    console.log(`[fetch-fixtures] Request params - league: ${league}, season: ${season}, date: ${date}`);
    
    if (!league) {
      throw new Error("League ID is required");
    }
    
    const API_KEY = Deno.env.get("API_FOOTBALL_KEY");
    if (!API_KEY) {
      throw new Error("API_FOOTBALL_KEY not configured");
    }

    // Detect if this is a RapidAPI key
    const isRapidAPI = API_KEY.includes("jsn") || API_KEY.length > 40;

    // Initialize Supabase client for caching
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Check cache first (10 min cache)
    const { data: cachedFixtures, error: cacheError } = await supabaseClient
      .from("fixtures")
      .select("*")
      .eq("league_id", league)
      .eq("date", date)
      .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

    if (cachedFixtures && cachedFixtures.length > 0) {
      console.log("Returning cached fixtures");
      return new Response(
        JSON.stringify({ fixtures: cachedFixtures }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch from API-Football
    console.log(`Fetching fixtures for league ${league}, date ${date}`);
    
    const url = isRapidAPI
      ? `https://api-football-v1.p.rapidapi.com/v3/fixtures?league=${league}&season=${season}&date=${date}`
      : `https://v3.football.api-sports.io/fixtures?league=${league}&season=${season}&date=${date}`;
    
    const headers: Record<string, string> = isRapidAPI
      ? {
          "x-rapidapi-key": API_KEY,
          "x-rapidapi-host": "api-football-v1.p.rapidapi.com"
        }
      : {
          "x-apisports-key": API_KEY
        };
    
    console.log(`[fetch-fixtures] URL: ${url}`);
    console.log(`[fetch-fixtures] Using ${isRapidAPI ? 'RapidAPI' : 'Direct API'} endpoint`);
    
    const response = await fetch(url, { headers });

    console.log(`[fetch-fixtures] API status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[fetch-fixtures] API error ${response.status}: ${errorText.slice(0, 500)}`);
      throw new Error(`API-Football error: ${response.status} - ${errorText.slice(0, 200)}`);
    }

    const responseText = await response.text();
    console.log(`[fetch-fixtures] Response body snippet: ${responseText.slice(0, 500)}`);
    
    const data = JSON.parse(responseText);
    
    console.log(`[fetch-fixtures] Response structure:`, {
      hasResponse: !!data.response,
      responseLength: data.response?.length || 0,
      hasErrors: !!data.errors,
      errors: data.errors
    });
    
    if (!data.response || data.response.length === 0) {
      console.log(`[fetch-fixtures] Empty response from API for league ${league}, date ${date}`);
      return new Response(
        JSON.stringify({ fixtures: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Transform and cache fixtures
    const fixtures = data.response.map((item: any) => ({
      id: item.fixture.id,
      league_id: league,
      date: date,
      timestamp: item.fixture.timestamp,
      teams_home: {
        id: item.teams.home.id,
        name: item.teams.home.name,
        logo: item.teams.home.logo,
      },
      teams_away: {
        id: item.teams.away.id,
        name: item.teams.away.name,
        logo: item.teams.away.logo,
      },
      status: item.fixture.status.short,
    }));

    // Cache in database (upsert)
    for (const fixture of fixtures) {
      await supabaseClient
        .from("fixtures")
        .upsert(
          { 
            ...fixture, 
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );
    }

    return new Response(
      JSON.stringify({ fixtures }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in fetch-fixtures:", error);
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
