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
    const { league, season, date, tz } = await req.json();
    
    console.log(`[fetch-fixtures] Request params - league: ${league}, season: ${season}, date: ${date}, tz: ${tz}`);
    
    if (!league) {
      throw new Error("League ID is required");
    }
    
    // Compute today's start and +7 days end in user's timezone (or UTC fallback)
    const now = new Date();
    const todayStart = new Date(now.toLocaleString('en-US', { timeZone: tz || 'UTC' }));
    todayStart.setHours(0, 0, 0, 0);
    const sevenDaysEnd = new Date(todayStart);
    sevenDaysEnd.setDate(sevenDaysEnd.getDate() + 8); // today + next 7 full days
    
    const fromTs = Math.floor(todayStart.getTime() / 1000);
    const toTs = Math.floor(sevenDaysEnd.getTime() / 1000);
    
    console.log(`[fetch-fixtures] Timestamp range: ${fromTs} to ${toTs} (${new Date(fromTs * 1000).toISOString()} to ${new Date(toTs * 1000).toISOString()})`);
    
    const API_KEY = Deno.env.get("API_FOOTBALL_KEY");
    if (!API_KEY) {
      throw new Error("API_FOOTBALL_KEY not configured");
    }

    // Initialize Supabase client for caching
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Check cache first (10 min cache) - filter by timestamp range for upcoming fixtures only
    const { data: cachedFixtures, error: cacheError } = await supabaseClient
      .from("fixtures")
      .select("*")
      .eq("league_id", league)
      .gte("timestamp", fromTs)
      .lt("timestamp", toTs)
      .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .order("timestamp", { ascending: true });

    if (cachedFixtures && cachedFixtures.length > 0) {
      console.log(`Returning ${cachedFixtures.length} cached upcoming fixtures`);
      return new Response(
        JSON.stringify({ fixtures: cachedFixtures }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch from API-Football for the next 8 days
    console.log(`Fetching upcoming fixtures for league ${league} (next 8 days)`);
    
    const allFixtures: any[] = [];
    
    // Fetch for each day in the range
    for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
      const targetDate = new Date(todayStart);
      targetDate.setDate(targetDate.getDate() + dayOffset);
      const dateStr = targetDate.toISOString().split('T')[0];
      
      const url = `${API_BASE}/fixtures?league=${league}&season=${season}&date=${dateStr}`;
      
      console.log(`[fetch-fixtures] Fetching day ${dayOffset}: ${dateStr}`);
      
      const response = await fetch(url, { headers: apiHeaders() });

      if (!response.ok) {
        console.error(`[fetch-fixtures] API error ${response.status} for ${dateStr}`);
        continue; // Skip this day and continue
      }

      const responseText = await response.text();
      const data = JSON.parse(responseText);
      
      if (data.response && data.response.length > 0) {
        // Filter only upcoming fixtures (exclude finished matches)
        const upcomingFixtures = data.response.filter((item: any) => {
          const fixtureTs = item.fixture.timestamp;
          return fixtureTs >= fromTs && fixtureTs < toTs && !['FT', 'AET', 'PEN', 'PST'].includes(item.fixture.status.short);
        });
        allFixtures.push(...upcomingFixtures);
        console.log(`[fetch-fixtures] Found ${upcomingFixtures.length} upcoming fixtures for ${dateStr}`);
      }
    }
    
    console.log(`[fetch-fixtures] Total upcoming fixtures found: ${allFixtures.length}`);
    
    if (allFixtures.length === 0) {
      console.log(`[fetch-fixtures] No upcoming fixtures found for league ${league}`);
      return new Response(
        JSON.stringify({ fixtures: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Transform and cache fixtures
    const fixtures = allFixtures.map((item: any) => ({
      id: item.fixture.id,
      league_id: league,
      date: new Date(item.fixture.timestamp * 1000).toISOString().split('T')[0],
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
