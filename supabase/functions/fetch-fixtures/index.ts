import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiHeaders, API_BASE } from "../_shared/api.ts";
import { ALLOWED_LEAGUE_IDS, LEAGUE_NAMES } from "../_shared/leagues.ts";
import { RPM_LIMIT } from "../_shared/config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const FIXTURE_TTL_HOURS = 12;
const REQUEST_DELAY_MS = 1300; // ~46 RPM to stay under 50 RPM limit

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { window_hours = 72 } = await req.json();
    
    console.log(`[fetch-fixtures] Starting bulk fetch for ${window_hours}h window`);
    
    // Calculate strict UTC window: [now, now+window_hours]
    const now = new Date();
    const windowEnd = new Date(now.getTime() + window_hours * 60 * 60 * 1000);
    const nowTs = Math.floor(now.getTime() / 1000);
    const endTs = Math.floor(windowEnd.getTime() / 1000);
    
    console.log(`[fetch-fixtures] Window: ${now.toISOString()} to ${windowEnd.toISOString()}`);
    
    const API_KEY = Deno.env.get("API_FOOTBALL_KEY");
    if (!API_KEY) {
      throw new Error("API_FOOTBALL_KEY not configured");
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get current season (always use 2025 for now)
    const season = 2025;

    // Metrics tracking
    let apiCalls = 0;
    let fixturesScannedTotal = 0;
    let fixturesInWindowKept = 0;
    let fixturesOutsideWindowDropped = 0;
    let inserted = 0;
    let updated = 0;
    let skippedTtl = 0;
    const leagueFixtureCounts: Record<number, number> = {};

    // Check which fixtures we already have (within TTL)
    const ttlCutoff = new Date(Date.now() - FIXTURE_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const { data: existingFixtures } = await supabaseClient
      .from("fixtures")
      .select("id, updated_at")
      .gte("timestamp", nowTs)
      .lt("timestamp", endTs)
      .gte("updated_at", ttlCutoff);

    const recentFixtureIds = new Set(existingFixtures?.map(f => f.id) || []);
    console.log(`[fetch-fixtures] ${recentFixtureIds.size} fixtures already fresh (updated within ${FIXTURE_TTL_HOURS}h)`);

    // Fetch fixtures for next 3 days (0, 1, 2) across all allowed leagues
    const allFixtures: any[] = [];
    
    for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + dayOffset);
      const dateStr = targetDate.toISOString().split('T')[0];
      
      console.log(`[fetch-fixtures] Day ${dayOffset}: ${dateStr} - scanning ${ALLOWED_LEAGUE_IDS.length} leagues`);
      
      for (const leagueId of ALLOWED_LEAGUE_IDS) {
        const url = `${API_BASE}/fixtures?league=${leagueId}&season=${season}&date=${dateStr}`;
        
        try {
          const response = await fetch(url, { headers: apiHeaders() });
          apiCalls++;

          if (!response.ok) {
            console.error(`[fetch-fixtures] API error ${response.status} for league ${leagueId} on ${dateStr}`);
            continue;
          }

          const data = await response.json();
          
          if (data.response && data.response.length > 0) {
            const validFixtures = data.response.filter((item: any) => {
              // Must have valid structure
              if (!item.fixture || !item.teams?.home || !item.teams?.away) return false;
              
              // Must have timestamp
              if (!item.fixture.timestamp) return false;
              
              // Must be prematch only (NS = Not Started, TBD = To Be Defined)
              if (!['NS', 'TBD'].includes(item.fixture.status.short)) return false;
              
              const fixtureTs = item.fixture.timestamp;
              
              // Strict window enforcement: [now, now+window_hours]
              if (fixtureTs < nowTs || fixtureTs >= endTs) {
                fixturesOutsideWindowDropped++;
                return false;
              }
              
              fixturesInWindowKept++;
              leagueFixtureCounts[leagueId] = (leagueFixtureCounts[leagueId] || 0) + 1;
              return true;
            });
            
            fixturesScannedTotal += data.response.length;
            allFixtures.push(...validFixtures);
          }

          // Rate limiting: ~1300ms delay for ~46 RPM
          await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
          
        } catch (error) {
          console.error(`[fetch-fixtures] Error fetching league ${leagueId} on ${dateStr}:`, error);
        }
      }
    }
    
    console.log(`[fetch-fixtures] Scanned ${fixturesScannedTotal}, kept ${fixturesInWindowKept} in window, dropped ${fixturesOutsideWindowDropped} outside`);
    
    // Upsert fixtures
    for (const item of allFixtures) {
      const fixtureId = item.fixture.id;
      
      // Skip if already fresh
      if (recentFixtureIds.has(fixtureId)) {
        skippedTtl++;
        continue;
      }

      const fixtureData = {
        id: fixtureId,
        league_id: item.league.id,
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabaseClient
        .from("fixtures")
        .upsert(fixtureData, { onConflict: "id" });

      if (error) {
        console.error(`[fetch-fixtures] Error upserting fixture ${fixtureId}:`, error);
      } else {
        if (recentFixtureIds.has(fixtureId)) {
          updated++;
        } else {
          inserted++;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const avgRpm = apiCalls > 0 ? Math.round((apiCalls / (durationMs / 1000)) * 60) : 0;

    // Get top 5 leagues by fixture count
    const sortedLeagues = Object.entries(leagueFixtureCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    
    const top5Leagues = sortedLeagues.map(([id, count]) => ({
      league_id: Number(id),
      league_name: LEAGUE_NAMES[Number(id)] || `League ${id}`,
      fixtures: count,
    }));

    console.log(`[fetch-fixtures] Top 5 leagues: ${sortedLeagues.map(([id, cnt]) => `${LEAGUE_NAMES[Number(id)]}=${cnt}`).join(', ')}`);
    console.log(`[fetch-fixtures] Summary: ${apiCalls} API calls (${avgRpm} RPM), ${inserted} inserted, ${updated} updated, ${skippedTtl} skipped (TTL)`);

    // Log to optimizer_run_logs
    await supabaseClient.from("optimizer_run_logs").insert({
      run_type: "fetch-fixtures",
      window_start: now.toISOString(),
      window_end: windowEnd.toISOString(),
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: durationMs,
      scanned: fixturesScannedTotal,
      upserted: inserted + updated,
      skipped: skippedTtl,
      failed: 0,
      scope: {
        requested_window_start: now.toISOString(),
        requested_window_end: windowEnd.toISOString(),
        api_calls: apiCalls,
        rpm_avg: avgRpm,
        leagues_scanned: ALLOWED_LEAGUE_IDS.length,
        fixtures_returned: fixturesScannedTotal,
        fixtures_in_window_kept: fixturesInWindowKept,
        fixtures_outside_window_dropped: fixturesOutsideWindowDropped,
        inserted,
        updated,
        skipped_ttl: skippedTtl,
        top_5_leagues: top5Leagues,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        scanned: fixturesScannedTotal,
        in_window: fixturesInWindowKept,
        dropped_outside: fixturesOutsideWindowDropped,
        inserted,
        updated,
        skipped_ttl: skippedTtl,
        api_calls: apiCalls,
        rpm_avg: avgRpm,
        top_5_leagues: top5Leagues,
        duration_ms: durationMs,
      }),
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
