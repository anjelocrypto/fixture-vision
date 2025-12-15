// ============================================================================
// Admin Remediate Stats Gaps Edge Function
// ============================================================================
// Comprehensive remediation function to fix stats coverage gaps for:
// - Leagues with bad fixture_results coverage
// - Teams missing stats_cache entries
// - UEFA competitions and domestic cups with zero fixtures
//
// Source of truth: STATS_FULL_PROJECT_QA_REPORT.md and STATS_GLOBAL_INTEGRITY_REPORT.md
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { computeLastFiveAverages } from "../_shared/stats.ts";
import { LEAGUE_NAMES, ALLOWED_LEAGUE_IDS } from "../_shared/leagues.ts";
import { fetchAPIFootball, fetchFixtureStatistics, getRateLimiterStats } from "../_shared/api_football.ts";

// ============================================================================
// CONFIGURATION: Derived from QA Reports
// ============================================================================

// P0: Leagues with bad fixture_results coverage (< 90%)
const LEAGUES_WITH_BAD_RESULTS_COVERAGE = [
  39,   // Premier League - 71.4% (28 missing)
  140,  // La Liga - 70.5% (26 missing)
  88,   // Eredivisie - 54.1% (50 missing)
  62,   // Ligue 2 - 50 missing (from report)
  71,   // Serie A Brazil - 30% stats coverage
];

// P0: Leagues with 0 fixtures that need backfill
const LEAGUES_WITH_ZERO_FIXTURES = [
  3,    // UEFA Europa League
  848,  // UEFA Europa Conference League
  48,   // EFL Cup (Carabao Cup)
  66,   // Coupe de France
];

// P1: Key EPL teams missing stats_cache (from report section 4.3)
const PRIORITY_TEAMS_MISSING_CACHE = [
  33,   // Arsenal
  42,   // Chelsea
  47,   // Tottenham
  49,   // Manchester City
  50,   // Manchester United (was listed as "missing")
  45,   // Everton
  65,   // Nottingham Forest
  52,   // Crystal Palace
  39,   // Wolverhampton (Wolves)
];

// P1: Leagues with low upcoming coverage (< 60%)
const LEAGUES_WITH_LOW_UPCOMING_COVERAGE = [
  39,   // EPL - 55%
  140,  // La Liga - 25%
  45,   // FA Cup - 37.5%
  98,   // J-League - 10%
  51,   // Serie B - 52.4%
  80,   // Bundesliga 2 - 50%
  141,  // Segunda - 27.3%
];

// All priority leagues combined
const ALL_PRIORITY_LEAGUES = [
  ...new Set([
    ...LEAGUES_WITH_BAD_RESULTS_COVERAGE,
    ...LEAGUES_WITH_ZERO_FIXTURES,
    ...LEAGUES_WITH_LOW_UPCOMING_COVERAGE,
    // Major domestic cups
    45, 48, 143, 137, 81, 66,
    // UEFA competitions
    2, 3, 848,
    // Top domestic leagues
    39, 140, 135, 78, 61, 94, 88,
  ])
];

// ============================================================================
// TYPES
// ============================================================================

interface RequestBody {
  force?: boolean;
  leagueIds?: number[];
  teamIds?: number[];
  skipFixtureBackfill?: boolean;
  skipResultsRefresh?: boolean;
  skipStatsRefresh?: boolean;
  skipHealthCheck?: boolean;
  mode?: 'default' | 'weekly';  // 'weekly' mode for scheduled remediation
  maxAPICallsPerRun?: number;   // Limit API calls to respect rate limits
}

interface RemediationResult {
  success: boolean;
  leagues_processed: number[];
  teams_refreshed: number[];
  fixtures_backfilled: number;
  results_fetched: number;
  stats_computed: number;
  coverage_before: Record<string, number>;
  coverage_after: Record<string, number>;
  critical_violations_before: number;
  critical_violations_after: number;
  errors: string[];
  notes: string[];
  duration_ms: number;
}

// ============================================================================
// HELPERS
// ============================================================================

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Get current violations count
async function getCriticalViolationsCount(supabase: any): Promise<number> {
  const { count } = await supabase
    .from("stats_health_violations")
    .select("*", { count: "exact", head: true })
    .eq("severity", "critical")
    .is("resolved_at", null);
  return count || 0;
}

// Get stats coverage for upcoming teams
async function getUpcomingCoverage(supabase: any): Promise<Record<string, number>> {
  const now = Math.floor(Date.now() / 1000);
  const weekLater = now + 7 * 24 * 60 * 60;

  // Get upcoming fixtures
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("league_id, teams_home, teams_away")
    .eq("status", "NS")
    .gte("timestamp", now)
    .lte("timestamp", weekLater);

  if (!fixtures || fixtures.length === 0) {
    return {};
  }

  // Group teams by league
  const leagueTeams: Record<number, Set<number>> = {};
  for (const f of fixtures) {
    const leagueId = f.league_id;
    const homeId = (f.teams_home as any)?.id;
    const awayId = (f.teams_away as any)?.id;
    
    if (!leagueTeams[leagueId]) {
      leagueTeams[leagueId] = new Set();
    }
    if (homeId) leagueTeams[leagueId].add(homeId);
    if (awayId) leagueTeams[leagueId].add(awayId);
  }

  // Get stats_cache coverage
  const coverage: Record<string, number> = {};
  
  for (const [leagueIdStr, teams] of Object.entries(leagueTeams)) {
    const leagueId = Number(leagueIdStr);
    const teamIds = Array.from(teams);
    
    const { data: cached } = await supabase
      .from("stats_cache")
      .select("team_id")
      .in("team_id", teamIds)
      .gte("sample_size", 3);

    const cachedCount = cached?.length || 0;
    const totalTeams = teamIds.length;
    const pct = totalTeams > 0 ? Math.round((cachedCount / totalTeams) * 100 * 10) / 10 : 0;
    
    const leagueName = LEAGUE_NAMES[leagueId] || `League ${leagueId}`;
    coverage[leagueName] = pct;
  }

  return coverage;
}

// Backfill fixtures for a league using centralized API client
async function backfillLeagueFixtures(
  supabase: any,
  leagueId: number,
  season: number
): Promise<{ fixtures: number; errors: string[]; apiCalls: number }> {
  const errors: string[] = [];
  let fixturesUpserted = 0;
  let apiCalls = 0;

  try {
    const result = await fetchAPIFootball(
      `/fixtures?league=${leagueId}&season=${season}&status=NS-FT-AET-PEN`,
      { logPrefix: "[remediate]" }
    );
    apiCalls++;
    
    if (!result.ok) {
      errors.push(`Failed to fetch fixtures for league ${leagueId}: ${result.error}`);
      return { fixtures: 0, errors, apiCalls };
    }

    const apiFixtures = result.data || [];
    
    if (apiFixtures.length === 0) {
      console.log(`[remediate] No fixtures returned for league ${leagueId} season ${season}`);
      return { fixtures: 0, errors, apiCalls };
    }

    // Prepare upsert batch
    const rows = apiFixtures.map((f: any) => ({
      id: f.fixture.id,
      league_id: leagueId,
      date: f.fixture.date?.split("T")[0],
      timestamp: f.fixture.timestamp,
      status: f.fixture.status?.short || "NS",
      teams_home: { id: f.teams.home.id, name: f.teams.home.name, logo: f.teams.home.logo },
      teams_away: { id: f.teams.away.id, name: f.teams.away.name, logo: f.teams.away.logo },
    }));

    const { error } = await supabase
      .from("fixtures")
      .upsert(rows, { onConflict: "id" });

    if (error) {
      errors.push(`Upsert error for league ${leagueId}: ${error.message}`);
    } else {
      fixturesUpserted = rows.length;
      console.log(`[remediate] Upserted ${fixturesUpserted} fixtures for league ${leagueId}`);
    }
  } catch (e: any) {
    errors.push(`Exception backfilling league ${leagueId}: ${e.message}`);
  }

  return { fixtures: fixturesUpserted, errors, apiCalls };
}

// Fetch results for finished fixtures in a league using centralized API client
async function refreshLeagueResults(
  supabase: any,
  leagueId: number,
  maxFixtures = 25
): Promise<{ results: number; errors: string[]; apiCalls: number }> {
  const errors: string[] = [];
  let resultsFetched = 0;
  let apiCalls = 0;

  try {
    // Find finished fixtures without results
    const { data: missingResults } = await supabase
      .from("fixtures")
      .select("id, timestamp")
      .eq("league_id", leagueId)
      .in("status", ["FT", "AET", "PEN"])
      .order("timestamp", { ascending: false })
      .limit(100);

    if (!missingResults || missingResults.length === 0) {
      return { results: 0, errors, apiCalls };
    }

    // Check which ones actually have results
    const fixtureIds = missingResults.map((f: any) => f.id);
    const { data: existingResults } = await supabase
      .from("fixture_results")
      .select("fixture_id")
      .in("fixture_id", fixtureIds);

    const existingIds = new Set((existingResults || []).map((r: any) => r.fixture_id));
    const needsResults = missingResults.filter((f: any) => !existingIds.has(f.id));

    console.log(`[remediate] League ${leagueId}: ${needsResults.length} fixtures need results`);

    // Process in small batches
    for (let i = 0; i < Math.min(needsResults.length, maxFixtures); i++) {
      const fixture = needsResults[i];
      
      try {
        // Fetch fixture details using centralized client
        const fixtureResult = await fetchAPIFootball(
          `/fixtures?id=${fixture.id}`,
          { logPrefix: "[remediate]" }
        );
        apiCalls++;
        
        if (!fixtureResult.ok || !fixtureResult.data?.length) continue;
        
        const apiFixture = fixtureResult.data[0];
        if (!apiFixture) continue;

        // Fetch statistics using centralized client
        const statsData = await fetchFixtureStatistics(fixture.id);
        apiCalls++;

        // Extract home/away stats
        const homeTeamId = apiFixture.teams.home.id;
        const awayTeamId = apiFixture.teams.away.id;
        
        const homeStats = (statsData || []).find((s: any) => s.team?.id === homeTeamId)?.statistics || [];
        const awayStats = (statsData || []).find((s: any) => s.team?.id === awayTeamId)?.statistics || [];

        const getStat = (stats: any[], types: string[]): number | null => {
          for (const type of types) {
            const stat = stats.find((s: any) => s.type?.toLowerCase() === type.toLowerCase());
            if (stat?.value !== null && stat?.value !== undefined) {
              return typeof stat.value === "number" ? stat.value : parseInt(stat.value) || null;
            }
          }
          return null;
        };

        // Build result row
        const resultRow = {
          fixture_id: fixture.id,
          league_id: leagueId,
          kickoff_at: new Date(fixture.timestamp * 1000).toISOString(),
          finished_at: new Date().toISOString(),
          goals_home: apiFixture.goals?.home ?? 0,
          goals_away: apiFixture.goals?.away ?? 0,
          corners_home: getStat(homeStats, ["Corner Kicks", "Corners"]),
          corners_away: getStat(awayStats, ["Corner Kicks", "Corners"]),
          cards_home: (getStat(homeStats, ["Yellow Cards"]) || 0) + (getStat(homeStats, ["Red Cards"]) || 0),
          cards_away: (getStat(awayStats, ["Yellow Cards"]) || 0) + (getStat(awayStats, ["Red Cards"]) || 0),
          fouls_home: getStat(homeStats, ["Fouls"]),
          fouls_away: getStat(awayStats, ["Fouls"]),
          offsides_home: getStat(homeStats, ["Offsides"]),
          offsides_away: getStat(awayStats, ["Offsides"]),
          status: apiFixture.fixture.status?.short || "FT",
          source: "api-football",
          fetched_at: new Date().toISOString(),
        };

        const { error: upsertError } = await supabase
          .from("fixture_results")
          .upsert(resultRow, { onConflict: "fixture_id" });

        if (!upsertError) {
          resultsFetched++;
        }
      } catch (e: any) {
        errors.push(`Error fetching result for fixture ${fixture.id}: ${e.message}`);
      }
    }
  } catch (e: any) {
    errors.push(`Exception refreshing results for league ${leagueId}: ${e.message}`);
  }

  return { results: resultsFetched, errors, apiCalls };
}

// Refresh stats for a team
async function refreshTeamStats(
  supabase: any,
  teamId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await computeLastFiveAverages(teamId, supabase);
    
    if (!result) {
      return { success: false, error: "No result returned" };
    }

    const { error } = await supabase
      .from("stats_cache")
      .upsert({
        team_id: result.team_id,
        goals: result.goals,
        corners: result.corners,
        cards: result.cards,
        fouls: result.fouls,
        offsides: result.offsides,
        sample_size: result.sample_size,
        last_five_fixture_ids: result.last_five_fixture_ids,
        last_final_fixture: result.last_final_fixture,
        computed_at: new Date().toISOString(),
        source: "admin-remediate",
      }, { onConflict: "team_id" });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse("Missing Supabase configuration", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ========================================================================
    // AUTH CHECK - NO .single() on scalar RPCs!
    // ========================================================================
    const cronKeyHeader = req.headers.get("x-cron-key") ?? req.headers.get("X-CRON-KEY");
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    let isAuthorized = false;

    if (cronKeyHeader) {
      const { data: dbKey, error: keyError } = await supabase.rpc("get_cron_internal_key");
      if (keyError) {
        console.error("[remediate] get_cron_internal_key error:", keyError);
      } else {
        const expectedKey = String(dbKey || "").trim();
        const providedKey = String(cronKeyHeader || "").trim();
        if (providedKey && expectedKey && providedKey === expectedKey) {
          isAuthorized = true;
          console.log("[remediate] Authorized via X-CRON-KEY");
        }
      }
    }

    if (!isAuthorized && authHeader) {
      if (authHeader === `Bearer ${serviceRoleKey}`) {
        isAuthorized = true;
        console.log("[remediate] Authorized via service role");
      } else {
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
        if (anonKey) {
          const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } }
          });
          const { data: isWhitelisted, error: wlError } = await userClient.rpc("is_user_whitelisted");
          if (wlError) {
            console.error("[remediate] is_user_whitelisted error:", wlError);
          } else if (isWhitelisted === true) {
            isAuthorized = true;
            console.log("[remediate] Authorized via admin user");
          }
        }
      }
    }

    if (!isAuthorized) {
      console.error("[remediate] Authorization failed - no valid credentials");
      return errorResponse("Unauthorized", origin, 401, req);
    }

    // ========================================================================
    // PARSE REQUEST
    // ========================================================================
    let body: RequestBody = {};
    try {
      body = await req.json();
    } catch {
      // Use defaults
    }

    const targetLeagues = body.leagueIds?.length ? body.leagueIds : ALL_PRIORITY_LEAGUES;
    const targetTeams = body.teamIds?.length ? body.teamIds : PRIORITY_TEAMS_MISSING_CACHE;
    const skipFixtureBackfill = body.skipFixtureBackfill ?? false;
    const skipResultsRefresh = body.skipResultsRefresh ?? false;
    const skipStatsRefresh = body.skipStatsRefresh ?? false;
    const skipHealthCheck = body.skipHealthCheck ?? false;

    console.log(`[remediate] Starting remediation:`);
    console.log(`  - Leagues: ${targetLeagues.length}`);
    console.log(`  - Priority teams: ${targetTeams.length}`);

    // ========================================================================
    // CAPTURE BEFORE STATE
    // ========================================================================
    const criticalBefore = await getCriticalViolationsCount(supabase);
    const coverageBefore = await getUpcomingCoverage(supabase);

    console.log(`[remediate] BEFORE: ${criticalBefore} critical violations`);
    console.log(`[remediate] BEFORE coverage:`, coverageBefore);

    const result: RemediationResult = {
      success: true,
      leagues_processed: [],
      teams_refreshed: [],
      fixtures_backfilled: 0,
      results_fetched: 0,
      stats_computed: 0,
      coverage_before: coverageBefore,
      coverage_after: {},
      critical_violations_before: criticalBefore,
      critical_violations_after: 0,
      errors: [],
      notes: [],
      duration_ms: 0,
    };

    // ========================================================================
    // STEP 1: BACKFILL FIXTURES FOR LEAGUES WITH ZERO/LOW COVERAGE
    // ========================================================================
    if (!skipFixtureBackfill) {
      console.log("[remediate] Step 1: Backfilling fixtures...");
      
      const now = new Date();
      const season = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
      
      for (const leagueId of LEAGUES_WITH_ZERO_FIXTURES) {
        console.log(`[remediate] Backfilling league ${leagueId} (${LEAGUE_NAMES[leagueId] || 'Unknown'})`);
        
        const { fixtures, errors } = await backfillLeagueFixtures(supabase, leagueId, season);
        result.fixtures_backfilled += fixtures;
        result.errors.push(...errors);
        result.leagues_processed.push(leagueId);
        
        await sleep(500); // Rate limit between leagues
      }

      result.notes.push(`Backfilled ${result.fixtures_backfilled} fixtures from ${LEAGUES_WITH_ZERO_FIXTURES.length} leagues`);
    }

    // ========================================================================
    // STEP 2: REFRESH RESULTS FOR LEAGUES WITH BAD COVERAGE
    // ========================================================================
    if (!skipResultsRefresh) {
      console.log("[remediate] Step 2: Refreshing results...");
      
      for (const leagueId of LEAGUES_WITH_BAD_RESULTS_COVERAGE) {
        if (result.leagues_processed.includes(leagueId)) continue;
        
        console.log(`[remediate] Refreshing results for league ${leagueId}`);
        
        const { results, errors } = await refreshLeagueResults(supabase, leagueId);
        result.results_fetched += results;
        result.errors.push(...errors);
        result.leagues_processed.push(leagueId);
        
        await sleep(500);
      }

      result.notes.push(`Fetched ${result.results_fetched} results from ${LEAGUES_WITH_BAD_RESULTS_COVERAGE.length} leagues`);
    }

    // ========================================================================
    // STEP 3: REFRESH STATS FOR PRIORITY TEAMS
    // ========================================================================
    if (!skipStatsRefresh) {
      console.log("[remediate] Step 3: Refreshing stats for priority teams...");
      
      // First, refresh the explicitly listed priority teams
      for (const teamId of targetTeams) {
        console.log(`[remediate] Refreshing stats for team ${teamId}`);
        
        const { success, error } = await refreshTeamStats(supabase, teamId);
        
        if (success) {
          result.teams_refreshed.push(teamId);
          result.stats_computed++;
        } else if (error) {
          result.errors.push(`Team ${teamId}: ${error}`);
        }
        
        await sleep(300);
      }

      // Then find additional teams with upcoming fixtures but missing cache
      const now = Math.floor(Date.now() / 1000);
      const weekLater = now + 7 * 24 * 60 * 60;

      const { data: upcomingFixtures } = await supabase
        .from("fixtures")
        .select("teams_home, teams_away")
        .in("league_id", LEAGUES_WITH_LOW_UPCOMING_COVERAGE)
        .eq("status", "NS")
        .gte("timestamp", now)
        .lte("timestamp", weekLater)
        .limit(50);

      if (upcomingFixtures) {
        const upcomingTeamIds = new Set<number>();
        for (const f of upcomingFixtures) {
          const homeId = (f.teams_home as any)?.id;
          const awayId = (f.teams_away as any)?.id;
          if (homeId && !targetTeams.includes(homeId)) upcomingTeamIds.add(homeId);
          if (awayId && !targetTeams.includes(awayId)) upcomingTeamIds.add(awayId);
        }

        // Check which ones are missing cache
        const teamIdList = Array.from(upcomingTeamIds);
        const { data: cached } = await supabase
          .from("stats_cache")
          .select("team_id")
          .in("team_id", teamIdList)
          .gte("sample_size", 3);

        const cachedSet = new Set((cached || []).map((c: any) => c.team_id));
        const missingTeams = teamIdList.filter(id => !cachedSet.has(id));

        console.log(`[remediate] Found ${missingTeams.length} additional teams needing stats refresh`);

        // Process up to 20 additional teams
        for (const teamId of missingTeams.slice(0, 20)) {
          const { success, error } = await refreshTeamStats(supabase, teamId);
          
          if (success) {
            result.teams_refreshed.push(teamId);
            result.stats_computed++;
          } else if (error) {
            result.errors.push(`Team ${teamId}: ${error}`);
          }
          
          await sleep(300);
        }
      }

      result.notes.push(`Refreshed stats for ${result.stats_computed} teams`);
    }

    // ========================================================================
    // STEP 4: CAPTURE AFTER STATE
    // ========================================================================
    result.coverage_after = await getUpcomingCoverage(supabase);
    result.critical_violations_after = await getCriticalViolationsCount(supabase);

    console.log(`[remediate] AFTER: ${result.critical_violations_after} critical violations`);
    console.log(`[remediate] AFTER coverage:`, result.coverage_after);

    // ========================================================================
    // STEP 5: LOG RUN
    // ========================================================================
    result.duration_ms = Date.now() - startTime;

    await supabase.from("optimizer_run_logs").insert({
      run_type: "admin-remediate-stats-gaps",
      window_start: new Date().toISOString(),
      window_end: new Date().toISOString(),
      scope: {
        leagues_processed: result.leagues_processed,
        teams_refreshed: result.teams_refreshed.length,
        fixtures_backfilled: result.fixtures_backfilled,
        results_fetched: result.results_fetched,
        stats_computed: result.stats_computed,
      },
      scanned: result.leagues_processed.length,
      upserted: result.stats_computed,
      failed: result.errors.length,
      duration_ms: result.duration_ms,
      notes: JSON.stringify({
        coverage_before: result.coverage_before,
        coverage_after: result.coverage_after,
        violations_before: result.critical_violations_before,
        violations_after: result.critical_violations_after,
        notes: result.notes,
        errors: result.errors.slice(0, 10), // Limit errors in log
      }),
    });

    // ========================================================================
    // RETURN RESULT
    // ========================================================================
    return jsonResponse(result, origin, 200, req);

  } catch (e: any) {
    console.error("[remediate] Fatal error:", e);
    return errorResponse(`Internal error: ${e.message}`, origin, 500, req);
  }
});
