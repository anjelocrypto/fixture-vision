import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiHeaders, API_BASE } from "../_shared/api.ts";
import { ALLOWED_LEAGUE_IDS, LEAGUE_NAMES } from "../_shared/leagues.ts";
import { RPM_LIMIT } from "../_shared/config.ts";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

const FIXTURE_TTL_HOURS = 12;
const REQUEST_DELAY_MS = 1300; // ~46 RPM to stay under 50 RPM limit

serve(async (req) => {
  const origin = req.headers.get('origin');
  
  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      return errorResponse("Missing environment variables", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Standardized auth: X-CRON-KEY or whitelisted user
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    
    let isAuthorized = false;

    // Check X-CRON-KEY first
    if (cronKeyHeader) {
      const { data: dbKey, error: keyError } = await supabase
        .rpc("get_cron_internal_key")
        .single();
      
      if (!keyError && dbKey && cronKeyHeader === dbKey) {
        isAuthorized = true;
        console.log("[fetch-fixtures] Authorized via X-CRON-KEY");
      }
    }

    // If not authorized via cron key, check user whitelist
    if (!isAuthorized && authHeader) {
      const userClient = createClient(
        supabaseUrl,
        supabaseAnonKey,
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: isWhitelisted, error: whitelistError } = await userClient
        .rpc("is_user_whitelisted")
        .single();

      if (whitelistError) {
        console.error("[fetch-fixtures] Whitelist check failed:", whitelistError);
        return errorResponse("Auth check failed", origin, 401, req);
      }

      if (!isWhitelisted) {
        console.warn("[fetch-fixtures] User not whitelisted");
        return errorResponse("Forbidden: Admin access required", origin, 403, req);
      }

      console.log("[fetch-fixtures] Authorized via whitelisted user");
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return errorResponse("Unauthorized: missing/invalid X-CRON-KEY or user not whitelisted", origin, 401, req);
    }

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

    // Use service role client for DB operations
    const supabaseClient = supabase;

    // Acquire mutex to prevent overlapping runs triggered from UI
    const jobName = 'fetch-fixtures-admin';
    const { data: lockAcquired, error: lockError } = await supabaseClient.rpc('acquire_cron_lock', {
      p_job_name: jobName,
      p_duration_minutes: 20,
    });

    if (lockError) {
      console.error('[fetch-fixtures] Lock error:', lockError);
      return errorResponse('lock_acquire_failed', origin, 423, req);
    }

    if (!lockAcquired) {
      console.warn('[fetch-fixtures] Another run is already in progress');
      return jsonResponse({ success: false, busy: true, message: 'Another fetch-fixtures run is in progress' }, origin, 200, req);
    }

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

    // Fetch fixtures per date to minimize API calls and keep runtime under gateway timeout
    const allFixtures: any[] = [];
    
    // Build the list of distinct dates within the window
    const days = Math.max(1, Math.ceil(window_hours / 24));
    const dateSet: string[] = [];
    for (let d = 0; d < days; d++) {
      const date = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
      dateSet.push(date.toISOString().split('T')[0]);
    }
    
    for (const dateStr of dateSet) {
      const url = `${API_BASE}/fixtures?date=${dateStr}&timezone=UTC`;
      
      try {
        const response = await fetch(url, { headers: apiHeaders() });
        apiCalls++;

        if (!response.ok) {
          console.error(`[fetch-fixtures] API error ${response.status} for date ${dateStr}`);
          failureReasons[`api_${response.status}`] = (failureReasons[`api_${response.status}`] || 0) + 1;
          continue;
        }

        const data = await response.json();
        
        if (data.response && data.response.length > 0) {
          fixturesScannedTotal += data.response.length;

          const validFixtures = data.response.filter((item: any) => {
            if (!item.fixture || !item.teams?.home || !item.teams?.away || !item.league?.id) {
              failureReasons.invalid_structure = (failureReasons.invalid_structure || 0) + 1;
              return false;
            }
            
            // Only keep allowed leagues
            if (!ALLOWED_LEAGUE_IDS.includes(item.league.id)) {
              return false;
            }
            
            if (!item.fixture.timestamp) {
              failureReasons.missing_timestamp = (failureReasons.missing_timestamp || 0) + 1;
              return false;
            }
            
            // Prematch only
            if (!['NS', 'TBD'].includes(item.fixture.status?.short)) {
              return false;
            }
            
            const fixtureTs = item.fixture.timestamp;
            if (fixtureTs < nowTs || fixtureTs >= endTs) {
              fixturesOutsideWindowDropped++;
              return false;
            }
            
            fixturesInWindowKept++;
            leagueFixtureCounts[item.league.id] = (leagueFixtureCounts[item.league.id] || 0) + 1;
            if (!perLeagueCounters[item.league.id]) {
              perLeagueCounters[item.league.id] = { requested: 0, returned: 0, in_window: 0, inserted: 0 };
            }
            perLeagueCounters[item.league.id].returned++;
            perLeagueCounters[item.league.id].in_window++;
            return true;
          });

          allFixtures.push(...validFixtures);
        }
      } catch (error) {
        console.error(`[fetch-fixtures] Error fetching date ${dateStr}:`, error);
        failureReasons.fetch_error = (failureReasons.fetch_error || 0) + 1;
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

    // Step 11: Return success with all metrics
    const summaryData = {
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
    };
    
    return jsonResponse(summaryData, origin, 200, req);
  } catch (error) {
    console.error("[fetch-fixtures] Fatal error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(errorMessage, origin, 500, req);
  }
});
