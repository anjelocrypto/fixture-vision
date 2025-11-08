import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiHeaders, API_BASE } from "../_shared/api.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const { country, season } = await req.json();
    
    console.log(`[fetch-leagues] Request params - country: ${country}, season: ${season}`);
    
    const API_KEY = Deno.env.get("API_FOOTBALL_KEY");
    if (!API_KEY) {
      throw new Error("API_FOOTBALL_KEY not configured");
    }

    // Initialize Supabase client for caching
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // First, look up the country_id to properly filter cached leagues
    const { data: cachedCountry } = await supabaseClient
      .from("countries")
      .select("id")
      .eq("name", country)
      .single();

    // Check cache first - MUST filter by both season AND country_id
    if (cachedCountry) {
      const { data: cachedLeagues } = await supabaseClient
        .from("leagues")
        .select("*")
        .eq("season", season)
        .eq("country_id", cachedCountry.id)
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()); // 24h cache

      if (cachedLeagues && cachedLeagues.length > 0) {
        console.log(`[fetch-leagues] Returning ${cachedLeagues.length} cached leagues for ${country} (country_id: ${cachedCountry.id})`);
        return new Response(
          JSON.stringify({ leagues: cachedLeagues }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    console.log(`[fetch-leagues] No cache found for ${country}, fetching from API...`);

    // Fetch from API-Football
    console.log(`Fetching leagues for ${country}, season ${season}`);
    
    const url = `${API_BASE}/leagues?country=${encodeURIComponent(country)}&season=${season}`;
    
    console.log(`[fetch-leagues] URL: ${url}`);
    console.log(`[fetch-leagues] Using API-Sports direct endpoint`);
    
    const response = await fetch(url, { headers: apiHeaders() });

    console.log(`[fetch-leagues] API status: ${response.status}`);
    
    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After") || "60";
      console.warn(`[fetch-leagues] Rate limited. Retry after ${retryAfter}s - attempting stale cache fallback`);

      // Fallback to any cached leagues (ignore 24h freshness)
      let fallbackLeagues: any[] = [];
      if (cachedCountry) {
        const { data: staleById } = await supabaseClient
          .from("leagues")
          .select("*")
          .eq("season", season)
          .eq("country_id", cachedCountry.id)
          .order("created_at", { ascending: false });
        fallbackLeagues = staleById || [];
      } else {
        const { data: staleByName } = await supabaseClient
          .from("leagues")
          .select("*")
          .eq("season", season)
          .eq("country_name", country)
          .order("created_at", { ascending: false });
        fallbackLeagues = staleByName || [];
      }

      if (fallbackLeagues.length > 0) {
        console.log(`[fetch-leagues] Returning ${fallbackLeagues.length} leagues from stale cache due to rate limit`);
        return new Response(
          JSON.stringify({ leagues: fallbackLeagues, stale: true, retry_after: retryAfter }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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
      country_name: countryData?.name || country,
      season: season,
    }));

    console.log(`[fetch-leagues] Caching ${leagues.length} leagues for ${country} (country_id: ${countryId})`);

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

