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
    // Admin gate: verify user is whitelisted
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');

    if (!jwt) {
      console.error('[fetch-fixtures] No authorization token provided');
      return new Response(
        JSON.stringify({ success: false, error: 'authentication_required' }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${jwt}` } } }
    );

    const { data: isWhitelisted, error: whitelistError } = await supabaseUser.rpc('is_user_whitelisted');
    
    if (whitelistError) {
      console.error('[fetch-fixtures] is_user_whitelisted error:', whitelistError);
      return new Response(
        JSON.stringify({ success: false, error: 'auth_check_failed' }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!isWhitelisted) {
      console.warn('[fetch-fixtures] Non-admin user attempted access');
      return new Response(
        JSON.stringify({ success: false, error: 'forbidden_admin_only' }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log('[fetch-fixtures] Admin access verified');

    const { window_hours = 120 } = await req.json();
    
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

    // Season handling: default 2025, can override per league if needed
    const DEFAULT_SEASON = 2025;
    const seasonByLeague: Record<number, number> = {};
    const getSeasonForLeague = (leagueId: number) => seasonByLeague[leagueId] ?? DEFAULT_SEASON;

    // Comprehensive metrics tracking
    let apiCalls = 0;
    let fixturesScannedTotal = 0;
    let fixturesInWindowKept = 0;
    let fixturesOutsideWindowDropped = 0;
    let fixturesInserted = 0;
    let fixturesUpdated = 0;
    let fixturesSkippedTtl = 0;
    let fixturesFailed = 0;
    let leaguesUpserted = 0;
    let leaguesFailed = 0;
    
    const leagueFixtureCounts: Record<number, number> = {};
    const perLeagueCounters: Record<number, { requested: number; returned: number; in_window: number; inserted: number }> = {};
    const failureReasons: Record<string, number> = {};

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
        if (!perLeagueCounters[leagueId]) {
          perLeagueCounters[leagueId] = { requested: 0, returned: 0, in_window: 0, inserted: 0 };
        }
        perLeagueCounters[leagueId].requested++;
        
        const season = getSeasonForLeague(leagueId);
        const url = `${API_BASE}/fixtures?league=${leagueId}&season=${season}&date=${dateStr}`;
        
        try {
          const response = await fetch(url, { headers: apiHeaders() });
          apiCalls++;

          if (!response.ok) {
            console.error(`[fetch-fixtures] API error ${response.status} for league ${leagueId} on ${dateStr}`);
            failureReasons[`api_${response.status}`] = (failureReasons[`api_${response.status}`] || 0) + 1;
            continue;
          }

          const data = await response.json();
          
          if (data.response && data.response.length > 0) {
            perLeagueCounters[leagueId].returned += data.response.length;
            
            const validFixtures = data.response.filter((item: any) => {
              // Must have valid structure
              if (!item.fixture || !item.teams?.home || !item.teams?.away) {
                failureReasons.invalid_structure = (failureReasons.invalid_structure || 0) + 1;
                return false;
              }
              
              // Must have timestamp
              if (!item.fixture.timestamp) {
                failureReasons.missing_timestamp = (failureReasons.missing_timestamp || 0) + 1;
                return false;
              }
              
              // Must be prematch only (NS = Not Started, TBD = To Be Defined)
              if (!['NS', 'TBD'].includes(item.fixture.status.short)) {
                return false;
              }
              
              const fixtureTs = item.fixture.timestamp;
              
              // Strict window enforcement: [now, now+window_hours]
              if (fixtureTs < nowTs || fixtureTs >= endTs) {
                fixturesOutsideWindowDropped++;
                return false;
              }
              
              fixturesInWindowKept++;
              perLeagueCounters[leagueId].in_window++;
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
          failureReasons.fetch_error = (failureReasons.fetch_error || 0) + 1;
        }
      }
    }
    
    console.log(`[fetch-fixtures] Scanned ${fixturesScannedTotal}, kept ${fixturesInWindowKept} in window, dropped ${fixturesOutsideWindowDropped} outside`);
    
    // Step 1: Collect unique leagues and upsert them first
    const uniqueLeagues = new Map<number, any>();
    for (const item of allFixtures) {
      if (item.league && !uniqueLeagues.has(item.league.id)) {
        const season = getSeasonForLeague(item.league.id);
        uniqueLeagues.set(item.league.id, {
          id: item.league.id,
          name: item.league.name,
          logo: item.league.logo,
          season,
          country_id: item.league.country_id || null,
        });
      }
    }
    
    console.log(`[fetch-fixtures] Upserting ${uniqueLeagues.size} unique leagues before fixtures`);
    
    for (const leagueData of uniqueLeagues.values()) {
      try {
        const { error } = await supabaseClient
          .from("leagues")
          .upsert(leagueData, { onConflict: "id" });
        
        if (error) {
          console.error(
            `[fetch-fixtures] Error upserting league ${leagueData.id}: ${error.message}`,
            { payload: leagueData }
          );
          leaguesFailed++;
          failureReasons.league_upsert_error = (failureReasons.league_upsert_error || 0) + 1;
        } else {
          leaguesUpserted++;
        }
      } catch (error) {
        console.error(`[fetch-fixtures] Exception upserting league ${leagueData.id}:`, error);
        leaguesFailed++;
        failureReasons.league_exception = (failureReasons.league_exception || 0) + 1;
      }
    }
    
    console.log(`[fetch-fixtures] Leagues: ${leaguesUpserted} upserted, ${leaguesFailed} failed`);
    
    // Step 2: Upsert fixtures with detailed error tracking
    for (const item of allFixtures) {
      const fixtureId = item.fixture.id;
      
      // Skip if already fresh
      if (recentFixtureIds.has(fixtureId)) {
        fixturesSkippedTtl++;
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

      try {
        const { error } = await supabaseClient
          .from("fixtures")
          .upsert(fixtureData, { onConflict: "id" });

        if (error) {
          console.error(
            `[fetch-fixtures] Error upserting fixture ${fixtureId} (${item.teams.home.name} vs ${item.teams.away.name}): ${error.message}`,
            {
              payload: {
                fixture_id: fixtureId,
                league_id: item.league.id,
                season: getSeasonForLeague(item.league.id),
                kickoff_iso: new Date(item.fixture.timestamp * 1000).toISOString(),
                home_id: item.teams.home.id,
                away_id: item.teams.away.id,
              }
            }
          );
          fixturesFailed++;
          if (error.message.includes("foreign key")) {
            failureReasons.fk_constraint = (failureReasons.fk_constraint || 0) + 1;
          } else if (error.message.includes("unique") || error.message.includes("conflict")) {
            failureReasons.conflict = (failureReasons.conflict || 0) + 1;
          } else if (error.message.includes("null")) {
            failureReasons.null_violation = (failureReasons.null_violation || 0) + 1;
          } else {
            failureReasons.other_db_error = (failureReasons.other_db_error || 0) + 1;
          }
        } else {
          if (recentFixtureIds.has(fixtureId)) {
            fixturesUpdated++;
          } else {
            fixturesInserted++;
            const leagueId = item.league.id;
            if (perLeagueCounters[leagueId]) {
              perLeagueCounters[leagueId].inserted++;
            }
          }
        }
      } catch (error) {
        console.error(`[fetch-fixtures] Exception upserting fixture ${fixtureId}:`, error);
        fixturesFailed++;
        failureReasons.fixture_exception = (failureReasons.fixture_exception || 0) + 1;
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

    // Top 3 failure reasons
    const top3Failures = Object.entries(failureReasons)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([reason, count]) => ({ reason, count }));

    console.log(`[fetch-fixtures] Top 5 leagues: ${sortedLeagues.map(([id, cnt]) => `${LEAGUE_NAMES[Number(id)]}=${cnt}`).join(', ')}`);
    console.log(`[fetch-fixtures] Summary: ${apiCalls} API calls (${avgRpm} RPM)`);
    console.log(`[fetch-fixtures] Leagues: ${leaguesUpserted} upserted, ${leaguesFailed} failed`);
    console.log(`[fetch-fixtures] Fixtures: ${fixturesInserted} inserted, ${fixturesUpdated} updated, ${fixturesSkippedTtl} skipped (TTL), ${fixturesFailed} failed`);
    console.log(`[fetch-fixtures] Top failures:`, top3Failures);

    // Log to optimizer_run_logs
    await supabaseClient.from("optimizer_run_logs").insert({
      run_type: "fetch-fixtures",
      window_start: now.toISOString(),
      window_end: windowEnd.toISOString(),
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: durationMs,
      scanned: fixturesScannedTotal,
      upserted: fixturesInserted + fixturesUpdated,
      skipped: fixturesSkippedTtl,
      failed: fixturesFailed,
      scope: {
        window: `${now.toISOString()} → ${windowEnd.toISOString()}`,
        api_calls: apiCalls,
        rpm_avg: avgRpm,
        leagues_scanned: ALLOWED_LEAGUE_IDS.length,
        leagues_upserted: leaguesUpserted,
        leagues_failed: leaguesFailed,
        fixtures_returned: fixturesScannedTotal,
        fixtures_in_window_kept: fixturesInWindowKept,
        fixtures_outside_window_dropped: fixturesOutsideWindowDropped,
        fixtures_inserted: fixturesInserted,
        fixtures_updated: fixturesUpdated,
        fixtures_skipped_ttl: fixturesSkippedTtl,
        fixtures_failed: fixturesFailed,
        top_5_leagues: top5Leagues,
        top_3_failures: top3Failures,
        season_used: DEFAULT_SEASON,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        window: `${now.toISOString()} → ${windowEnd.toISOString()}`,
        scanned: fixturesScannedTotal,
        in_window: fixturesInWindowKept,
        dropped_outside: fixturesOutsideWindowDropped,
        leagues_upserted: leaguesUpserted,
        leagues_failed: leaguesFailed,
        inserted: fixturesInserted,
        updated: fixturesUpdated,
        skipped_ttl: fixturesSkippedTtl,
        failed: fixturesFailed,
        api_calls: apiCalls,
        rpm_avg: avgRpm,
        top_5_leagues: top5Leagues,
        top_3_failures: top3Failures,
        duration_ms: durationMs,
        season_used: DEFAULT_SEASON,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[fetch-fixtures] Fatal error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
