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
    
    const API_KEY = Deno.env.get("API_FOOTBALL_KEY");
    if (!API_KEY) {
      throw new Error("API_FOOTBALL_KEY not configured");
    }

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
    const response = await fetch(
      `https://v3.football.api-sports.io/fixtures?league=${league}&season=${season}&date=${date}`,
      {
        headers: {
          "x-apisports-key": API_KEY,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`API-Football error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.response || data.response.length === 0) {
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
