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

    // Detect if this is a RapidAPI key (contains "jsn" or longer format)
    const isRapidAPI = API_KEY.includes("jsn") || API_KEY.length > 40;

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
    
    // Use different endpoint and headers for RapidAPI vs direct API
    const url = isRapidAPI 
      ? `https://api-football-v1.p.rapidapi.com/v3/leagues?country=${encodeURIComponent(country)}&season=${season}`
      : `https://v3.football.api-sports.io/leagues?country=${encodeURIComponent(country)}&season=${season}`;
    
    const headers: Record<string, string> = isRapidAPI
      ? {
          "x-rapidapi-key": API_KEY,
          "x-rapidapi-host": "api-football-v1.p.rapidapi.com"
        }
      : {
          "x-apisports-key": API_KEY
        };
    
    console.log(`[fetch-leagues] URL: ${url}`);
    console.log(`[fetch-leagues] Using ${isRapidAPI ? 'RapidAPI' : 'Direct API'} endpoint`);
    
    const response = await fetch(url, { headers });

    console.log(`[fetch-leagues] API status: ${response.status}`);
    
    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After") || "60";
      console.error(`[fetch-leagues] Rate limited. Retry after ${retryAfter}s`);
      return new Response(
        JSON.stringify({ 
          error: "API rate limit exceeded",
          retry_after: retryAfter 
        }),
        { 
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[fetch-leagues] API error ${response.status}: ${errorText.slice(0, 500)}`);
      throw new Error(`API-Football error: ${response.status} - ${errorText.slice(0, 200)}`);
    }

    const responseText = await response.text();
    console.log(`[fetch-leagues] Response body snippet: ${responseText.slice(0, 500)}`);
    
    const data = JSON.parse(responseText);
    
    // Log API response structure
    console.log(`[fetch-leagues] Response structure:`, {
      hasResponse: !!data.response,
      responseLength: data.response?.length || 0,
      hasErrors: !!data.errors,
      errors: data.errors
    });
    
    if (!data.response || data.response.length === 0) {
      console.log(`[fetch-leagues] Empty response from API for ${country}, season ${season}`);
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

