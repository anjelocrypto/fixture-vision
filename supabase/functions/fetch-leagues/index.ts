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
    const { country, season } = await req.json();
    
    const API_KEY = Deno.env.get("API_FOOTBALL_KEY");
    if (!API_KEY) {
      throw new Error("API_FOOTBALL_KEY not configured");
    }

    // Initialize Supabase client for caching
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Check cache first
    const { data: cachedLeagues, error: cacheError } = await supabaseClient
      .from("leagues")
      .select("*")
      .eq("season", season)
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()); // 24h cache

    if (cachedLeagues && cachedLeagues.length > 0) {
      console.log("Returning cached leagues");
      return new Response(
        JSON.stringify({ leagues: cachedLeagues }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch from API-Football
    console.log(`Fetching leagues for ${country}, season ${season}`);
    const response = await fetch(
      `https://v3.football.api-sports.io/leagues?country=${encodeURIComponent(country)}&season=${season}`,
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
        JSON.stringify({ leagues: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // First, get or create the country
    const countryData = data.response[0]?.country;
    let countryId = null;
    
    if (countryData) {
      // Try to get existing country
      const { data: existingCountry } = await supabaseClient
        .from("countries")
        .select("id")
        .eq("name", countryData.name)
        .single();
      
      if (existingCountry) {
        countryId = existingCountry.id;
      } else {
        // Create new country
        const { data: newCountry } = await supabaseClient
          .from("countries")
          .insert({
            id: countryData.code ? Math.abs(hashCode(countryData.code)) : Math.abs(hashCode(countryData.name)),
            name: countryData.name,
            flag: countryData.flag || "",
            code: countryData.code || "",
          })
          .select()
          .single();
        
        if (newCountry) {
          countryId = newCountry.id;
        }
      }
    }

    // Transform and cache leagues
    const leagues = data.response.map((item: any) => ({
      id: item.league.id,
      name: item.league.name,
      logo: item.league.logo,
      country_id: countryId,
      season: season,
    }));

    // Cache in database (upsert)
    for (const league of leagues) {
      await supabaseClient
        .from("leagues")
        .upsert(
          { ...league, created_at: new Date().toISOString() },
          { onConflict: "id" }
        );
    }

    return new Response(
      JSON.stringify({ leagues }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in fetch-leagues:", error);
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

// Simple hash function for generating consistent IDs
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

