// ============================================================================
// stats-turbo-backfill Edge Function - ONE-TIME AGGRESSIVE BACKFILL
// ============================================================================
// Orchestrates a "Turbo Backfill Day" to catch up on historical data using
// spare API-Football capacity. Does NOT change existing conservative automation.
// Uses centralized API client and respects daily budget limits.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { ALLOWED_LEAGUE_IDS, LEAGUE_NAMES } from "../_shared/leagues.ts";
import { fetchAPIFootball, fetchFixtureStatistics, getRateLimiterStats } from "../_shared/api_football.ts";
import { computeLastFiveAverages } from "../_shared/stats.ts";

// Priority league tiers for Turbo Backfill
const TIER_0_LEAGUES = [39, 140, 135, 78, 61]; // EPL, La Liga, Serie A, Bundesliga, Ligue 1
const TIER_1_LEAGUES = [88, 94, 203, 2, 3, 848]; // Eredivisie, Primeira Liga, Super Lig, UCL, UEL, UECL
const TIER_2_LEAGUES = [40, 136, 141, 79, 62, 144, 179, 218, 207]; // Championship, Serie B, La Liga 2, etc.

const DEFAULT_PRIORITY_LEAGUES = [...TIER_0_LEAGUES, ...TIER_1_LEAGUES, ...TIER_2_LEAGUES];

interface TurboRequest {
  maxAPICallsTotal?: number;
  targetCoveragePct?: number;
  priorityLeagues?: number[];
  daysLookback?: number;
  upcomingDays?: number;
  dryRun?: boolean;
  skipBudgetCheck?: boolean; // Force run even if budget estimate is high
}

interface CoverageMetrics {
  total_upcoming_teams: number;
  teams_with_stats: number;
  teams_sample_gte_5: number;
  teams_sample_gte_3: number;
  teams_missing_stats: number;
  coverage_pct_gte3: number;
  coverage_pct_gte5: number;
  per_league: Record<number, { league_name: string; teams: number; with_stats: number; coverage_pct: number }>;
}

interface StageResult {
  stage: string;
  processed: number;
  apiCalls: number;
  duration_ms: number;
  details?: Record<string, any>;
}

// Global API call counter for this run
let apiCallsUsed = 0;
let allowedBudget = 0;

function trackAPICall(count = 1): boolean {
  apiCallsUsed += count;
  if (apiCallsUsed >= allowedBudget) {
    console.log(`[turbo] ⚠️ API budget exhausted: ${apiCallsUsed}/${allowedBudget}`);
    return false; // Budget exhausted
  }
  return true;
}

function canContinue(): boolean {
  return apiCallsUsed < allowedBudget;
}

// Compute coverage metrics for upcoming fixtures
async function computeCoverageMetrics(
  supabase: any,
  upcomingDays: number,
  priorityLeagues: number[]
): Promise<CoverageMetrics> {
  const now = new Date();
  const futureLimit = new Date(now.getTime() + upcomingDays * 24 * 60 * 60 * 1000);
  const nowTs = Math.floor(now.getTime() / 1000);
  const futureTs = Math.floor(futureLimit.getTime() / 1000);

  // Get upcoming fixtures
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("id, league_id, teams_home, teams_away")
    .gte("timestamp", nowTs)
    .lte("timestamp", futureTs)
    .in("status", ["NS", "TBD", "SCHEDULED"]);

  if (!fixtures || fixtures.length === 0) {
    return {
      total_upcoming_teams: 0,
      teams_with_stats: 0,
      teams_sample_gte_5: 0,
      teams_sample_gte_3: 0,
      teams_missing_stats: 0,
      coverage_pct_gte3: 0,
      coverage_pct_gte5: 0,
      per_league: {},
    };
  }

  // Extract unique team IDs
  const teamIds = new Set<number>();
  const teamLeagueMap = new Map<number, Set<number>>();

  for (const fx of fixtures) {
    const homeId = fx.teams_home?.id;
    const awayId = fx.teams_away?.id;
    const leagueId = fx.league_id;

    if (homeId) {
      teamIds.add(homeId);
      if (!teamLeagueMap.has(leagueId)) teamLeagueMap.set(leagueId, new Set());
      teamLeagueMap.get(leagueId)!.add(homeId);
    }
    if (awayId) {
      teamIds.add(awayId);
      if (!teamLeagueMap.has(leagueId)) teamLeagueMap.set(leagueId, new Set());
      teamLeagueMap.get(leagueId)!.add(awayId);
    }
  }

  const teamIdsArray = Array.from(teamIds);

  // Get stats cache for these teams
  const { data: statsCache } = await supabase
    .from("stats_cache")
    .select("team_id, sample_size")
    .in("team_id", teamIdsArray);

  const statsCacheMap = new Map<number, number>();
  for (const sc of statsCache || []) {
    statsCacheMap.set(sc.team_id, sc.sample_size || 0);
  }

  let teamsWithStats = 0;
  let teamsGte5 = 0;
  let teamsGte3 = 0;

  for (const teamId of teamIdsArray) {
    const sampleSize = statsCacheMap.get(teamId) || 0;
    if (sampleSize > 0) teamsWithStats++;
    if (sampleSize >= 3) teamsGte3++;
    if (sampleSize >= 5) teamsGte5++;
  }

  // Per-league breakdown for priority leagues
  const perLeague: Record<number, { league_name: string; teams: number; with_stats: number; coverage_pct: number }> = {};
  
  for (const leagueId of priorityLeagues) {
    const leagueTeams = teamLeagueMap.get(leagueId);
    if (!leagueTeams || leagueTeams.size === 0) continue;

    let withStats = 0;
    for (const teamId of leagueTeams) {
      const sampleSize = statsCacheMap.get(teamId) || 0;
      if (sampleSize >= 3) withStats++;
    }

    perLeague[leagueId] = {
      league_name: LEAGUE_NAMES[leagueId] || `League ${leagueId}`,
      teams: leagueTeams.size,
      with_stats: withStats,
      coverage_pct: leagueTeams.size > 0 ? Math.round((withStats / leagueTeams.size) * 100) : 0,
    };
  }

  return {
    total_upcoming_teams: teamIdsArray.length,
    teams_with_stats: teamsWithStats,
    teams_sample_gte_5: teamsGte5,
    teams_sample_gte_3: teamsGte3,
    teams_missing_stats: teamIdsArray.length - teamsWithStats,
    coverage_pct_gte3: teamIdsArray.length > 0 ? Math.round((teamsGte3 / teamIdsArray.length) * 100) : 0,
    coverage_pct_gte5: teamIdsArray.length > 0 ? Math.round((teamsGte5 / teamIdsArray.length) * 100) : 0,
    per_league: perLeague,
  };
}

// Stage 1: Historical Fixtures Backfill
async function runHistoryBackfillStage(
  supabase: any,
  priorityLeagues: number[],
  daysLookback: number
): Promise<StageResult> {
  const startTime = Date.now();
  let processed = 0;
  let apiCalls = 0;

  const now = new Date();
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  const currentSeason = month >= 7 ? year : year - 1;
  const seasons = [currentSeason, currentSeason - 1]; // Current + previous season

  console.log(`[turbo] Stage 1: History backfill for ${priorityLeagues.length} leagues, seasons ${seasons.join(",")}`);

  for (const leagueId of priorityLeagues) {
    if (!canContinue()) {
      console.log(`[turbo] Stage 1: Budget exhausted at league ${leagueId}`);
      break;
    }

    for (const season of seasons) {
      if (!canContinue()) break;

      try {
        // Fetch fixtures from API
        const fixturesResult = await fetchAPIFootball(
          `/fixtures?league=${leagueId}&season=${season}&status=FT-AET-PEN`,
          { logPrefix: "[turbo-s1]" }
        );
        apiCalls++;
        if (!trackAPICall()) break;

        if (!fixturesResult.ok) continue;

        const apiFixtures = fixturesResult.data || [];
        if (apiFixtures.length === 0) continue;

        // Get existing fixture IDs
        const fixtureIds = apiFixtures.map((f: any) => f.fixture?.id).filter(Boolean);
        const { data: existingResults } = await supabase
          .from("fixture_results")
          .select("fixture_id")
          .in("fixture_id", fixtureIds);
        const existingResultIds = new Set((existingResults || []).map((r: any) => r.fixture_id));

        // Process fixtures missing results (limit to 50 per league to conserve budget)
        const fixturesToProcess = apiFixtures
          .filter((f: any) => f.fixture?.id && !existingResultIds.has(f.fixture?.id))
          .slice(0, 50);

        for (const apiFixture of fixturesToProcess) {
          if (!canContinue()) break;

          const fixtureId = apiFixture.fixture?.id;
          const timestamp = apiFixture.fixture?.timestamp;
          const homeTeam = apiFixture.teams?.home;
          const awayTeam = apiFixture.teams?.away;
          const goalsHome = apiFixture.goals?.home ?? 0;
          const goalsAway = apiFixture.goals?.away ?? 0;
          const fixtureStatus = apiFixture.fixture?.status?.short || "FT";

          // Upsert fixture
          await supabase.from("fixtures").upsert({
            id: fixtureId,
            league_id: leagueId,
            date: new Date(timestamp * 1000).toISOString().split("T")[0],
            timestamp: timestamp,
            teams_home: { id: homeTeam?.id, name: homeTeam?.name, logo: homeTeam?.logo },
            teams_away: { id: awayTeam?.id, name: awayTeam?.name, logo: awayTeam?.logo },
            status: fixtureStatus,
          }, { onConflict: "id" });

          // Fetch statistics
          const statsData = await fetchFixtureStatistics(fixtureId);
          apiCalls++;
          if (!trackAPICall()) break;

          let cornersHome: number | null = null, cornersAway: number | null = null;
          let cardsHome: number | null = null, cardsAway: number | null = null;
          let foulsHome: number | null = null, foulsAway: number | null = null;
          let offsidesHome: number | null = null, offsidesAway: number | null = null;

          if (statsData && Array.isArray(statsData) && statsData.length === 2) {
            const homeStats = statsData.find((s: any) => s.team?.id === homeTeam?.id);
            const awayStats = statsData.find((s: any) => s.team?.id === awayTeam?.id);

            if (homeStats?.statistics) {
              const cornersStat = homeStats.statistics.find((st: any) => st.type === "Corner Kicks" || st.type === "Corners");
              cornersHome = cornersStat?.value ?? null;
              const yellowCards = homeStats.statistics.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
              const redCards = homeStats.statistics.find((st: any) => st.type === "Red Cards")?.value ?? 0;
              cardsHome = (yellowCards || 0) + (redCards || 0);
              foulsHome = homeStats.statistics.find((st: any) => st.type === "Fouls")?.value ?? null;
              offsidesHome = homeStats.statistics.find((st: any) => st.type === "Offsides")?.value ?? null;
            }

            if (awayStats?.statistics) {
              const cornersStat = awayStats.statistics.find((st: any) => st.type === "Corner Kicks" || st.type === "Corners");
              cornersAway = cornersStat?.value ?? null;
              const yellowCards = awayStats.statistics.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
              const redCards = awayStats.statistics.find((st: any) => st.type === "Red Cards")?.value ?? 0;
              cardsAway = (yellowCards || 0) + (redCards || 0);
              foulsAway = awayStats.statistics.find((st: any) => st.type === "Fouls")?.value ?? null;
              offsidesAway = awayStats.statistics.find((st: any) => st.type === "Offsides")?.value ?? null;
            }
          }

          // Upsert result
          await supabase.from("fixture_results").upsert({
            fixture_id: fixtureId,
            league_id: leagueId,
            kickoff_at: new Date(timestamp * 1000).toISOString(),
            finished_at: new Date(timestamp * 1000).toISOString(),
            goals_home: goalsHome,
            goals_away: goalsAway,
            corners_home: cornersHome,
            corners_away: cornersAway,
            cards_home: cardsHome,
            cards_away: cardsAway,
            fouls_home: foulsHome,
            fouls_away: foulsAway,
            offsides_home: offsidesHome,
            offsides_away: offsidesAway,
            status: fixtureStatus,
            source: "turbo-backfill",
            fetched_at: new Date().toISOString(),
          }, { onConflict: "fixture_id" });

          processed++;
        }

        console.log(`[turbo-s1] League ${leagueId} season ${season}: ${fixturesToProcess.length} fixtures processed`);

      } catch (error) {
        console.error(`[turbo-s1] Error processing league ${leagueId} season ${season}:`, error);
      }
    }
  }

  return {
    stage: "history_backfill",
    processed,
    apiCalls,
    duration_ms: Date.now() - startTime,
  };
}

// Stage 2: Results Refresh for recent fixtures
async function runResultsRefreshStage(
  supabase: any,
  daysLookback: number
): Promise<StageResult> {
  const startTime = Date.now();
  let processed = 0;
  let apiCalls = 0;

  console.log(`[turbo] Stage 2: Results refresh for last ${daysLookback} days`);

  const lookbackLimit = new Date(Date.now() - daysLookback * 24 * 3600 * 1000);
  const finishedThreshold = Math.floor((Date.now() - 2 * 3600 * 1000) / 1000);

  // Find fixtures that might be finished but missing results
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("id, league_id, timestamp, status")
    .lt("timestamp", finishedThreshold)
    .gte("timestamp", Math.floor(lookbackLimit.getTime() / 1000))
    .order("timestamp", { ascending: false })
    .limit(500);

  if (!fixtures || fixtures.length === 0) {
    console.log("[turbo-s2] No fixtures need results refresh");
    return { stage: "results_refresh", processed: 0, apiCalls: 0, duration_ms: Date.now() - startTime };
  }

  // Check which already have results
  const fixtureIds = fixtures.map((f: any) => f.id);
  const { data: existingResults } = await supabase
    .from("fixture_results")
    .select("fixture_id")
    .in("fixture_id", fixtureIds);
  const existingIds = new Set((existingResults || []).map((r: any) => r.fixture_id));

  const fixturesToProcess = fixtures.filter((f: any) => !existingIds.has(f.id)).slice(0, 200);
  console.log(`[turbo-s2] ${fixturesToProcess.length} fixtures need results (of ${fixtures.length} total)`);

  for (const fixture of fixturesToProcess) {
    if (!canContinue()) {
      console.log("[turbo-s2] Budget exhausted");
      break;
    }

    try {
      // Fetch fixture details
      const fixtureResult = await fetchAPIFootball(`/fixtures?id=${fixture.id}`, { logPrefix: "[turbo-s2]" });
      apiCalls++;
      if (!trackAPICall()) break;

      if (!fixtureResult.ok || !fixtureResult.data?.length) continue;

      const apiFixture = fixtureResult.data[0];
      const apiStatus = apiFixture.fixture?.status?.short || "NS";
      const isFinished = ["FT", "AET", "PEN", "AWD", "WO"].includes(apiStatus);

      if (!isFinished) continue;

      const goalsHome = apiFixture.goals?.home ?? 0;
      const goalsAway = apiFixture.goals?.away ?? 0;

      // Fetch statistics
      const statsData = await fetchFixtureStatistics(fixture.id);
      apiCalls++;
      if (!trackAPICall()) break;

      let cornersHome: number | null = null, cornersAway: number | null = null;
      let cardsHome: number | null = null, cardsAway: number | null = null;
      let foulsHome: number | null = null, foulsAway: number | null = null;
      let offsidesHome: number | null = null, offsidesAway: number | null = null;

      if (statsData && Array.isArray(statsData) && statsData.length === 2) {
        const homeStats = statsData.find((s: any) => s.team?.id === apiFixture.teams?.home?.id);
        const awayStats = statsData.find((s: any) => s.team?.id === apiFixture.teams?.away?.id);

        if (homeStats?.statistics) {
          const cornersStat = homeStats.statistics.find((st: any) => st.type === "Corner Kicks" || st.type === "Corners");
          cornersHome = cornersStat?.value ?? null;
          const yellowCards = homeStats.statistics.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
          const redCards = homeStats.statistics.find((st: any) => st.type === "Red Cards")?.value ?? 0;
          cardsHome = (yellowCards || 0) + (redCards || 0);
          foulsHome = homeStats.statistics.find((st: any) => st.type === "Fouls")?.value ?? null;
          offsidesHome = homeStats.statistics.find((st: any) => st.type === "Offsides")?.value ?? null;
        }

        if (awayStats?.statistics) {
          const cornersStat = awayStats.statistics.find((st: any) => st.type === "Corner Kicks" || st.type === "Corners");
          cornersAway = cornersStat?.value ?? null;
          const yellowCards = awayStats.statistics.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
          const redCards = awayStats.statistics.find((st: any) => st.type === "Red Cards")?.value ?? 0;
          cardsAway = (yellowCards || 0) + (redCards || 0);
          foulsAway = awayStats.statistics.find((st: any) => st.type === "Fouls")?.value ?? null;
          offsidesAway = awayStats.statistics.find((st: any) => st.type === "Offsides")?.value ?? null;
        }
      }

      // Upsert result
      await supabase.from("fixture_results").upsert({
        fixture_id: fixture.id,
        league_id: fixture.league_id,
        kickoff_at: new Date(fixture.timestamp * 1000).toISOString(),
        finished_at: new Date().toISOString(),
        goals_home: goalsHome,
        goals_away: goalsAway,
        corners_home: cornersHome,
        corners_away: cornersAway,
        cards_home: cardsHome,
        cards_away: cardsAway,
        fouls_home: foulsHome,
        fouls_away: foulsAway,
        offsides_home: offsidesHome,
        offsides_away: offsidesAway,
        status: apiStatus,
        source: "turbo-results",
        fetched_at: new Date().toISOString(),
      }, { onConflict: "fixture_id" });

      // Update fixture status
      if (fixture.status !== apiStatus) {
        await supabase.from("fixtures").update({ status: apiStatus }).eq("id", fixture.id);
      }

      processed++;

    } catch (error) {
      console.error(`[turbo-s2] Error processing fixture ${fixture.id}:`, error);
    }
  }

  console.log(`[turbo-s2] Processed ${processed} fixtures`);

  return {
    stage: "results_refresh",
    processed,
    apiCalls,
    duration_ms: Date.now() - startTime,
  };
}

// Stage 3: Stats Cache Refresh for upcoming teams
async function runStatsCacheRefreshStage(
  supabase: any,
  upcomingDays: number,
  priorityLeagues: number[]
): Promise<StageResult> {
  const startTime = Date.now();
  let processed = 0;
  let apiCalls = 0;

  console.log(`[turbo] Stage 3: Stats cache refresh for teams with fixtures in next ${upcomingDays} days`);

  const now = new Date();
  const futureLimit = new Date(now.getTime() + upcomingDays * 24 * 60 * 60 * 1000);
  const nowTs = Math.floor(now.getTime() / 1000);
  const futureTs = Math.floor(futureLimit.getTime() / 1000);

  // Get upcoming fixtures in priority leagues first
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("id, league_id, teams_home, teams_away")
    .gte("timestamp", nowTs)
    .lte("timestamp", futureTs)
    .in("status", ["NS", "TBD", "SCHEDULED"])
    .in("league_id", priorityLeagues);

  if (!fixtures || fixtures.length === 0) {
    console.log("[turbo-s3] No upcoming fixtures in priority leagues");
    return { stage: "stats_cache_refresh", processed: 0, apiCalls: 0, duration_ms: Date.now() - startTime };
  }

  // Extract unique team IDs
  const teamIds = new Set<number>();
  for (const fx of fixtures) {
    if (fx.teams_home?.id) teamIds.add(fx.teams_home.id);
    if (fx.teams_away?.id) teamIds.add(fx.teams_away.id);
  }

  const teamIdsArray = Array.from(teamIds);

  // Get current stats cache
  const { data: statsCache } = await supabase
    .from("stats_cache")
    .select("team_id, sample_size, computed_at")
    .in("team_id", teamIdsArray);

  const statsCacheMap = new Map<number, { sample_size: number; computed_at: string }>();
  for (const sc of statsCache || []) {
    statsCacheMap.set(sc.team_id, { sample_size: sc.sample_size || 0, computed_at: sc.computed_at });
  }

  // Find teams that need refresh (missing, weak, or stale)
  const staleThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
  const teamsNeedingRefresh: number[] = [];

  for (const teamId of teamIdsArray) {
    const cached = statsCacheMap.get(teamId);
    if (!cached) {
      teamsNeedingRefresh.push(teamId);
    } else if (cached.sample_size < 5) {
      teamsNeedingRefresh.push(teamId);
    } else if (new Date(cached.computed_at) < staleThreshold) {
      teamsNeedingRefresh.push(teamId);
    }
  }

  console.log(`[turbo-s3] ${teamsNeedingRefresh.length} teams need stats refresh (of ${teamIdsArray.length} total)`);

  // Process teams (each computeLastFiveAverages uses ~11 API calls)
  for (const teamId of teamsNeedingRefresh) {
    if (!canContinue()) {
      console.log("[turbo-s3] Budget exhausted");
      break;
    }

    try {
      const beforeApiCalls = apiCallsUsed;
      
      // computeLastFiveAverages uses fetchAPIFootball internally
      const stats = await computeLastFiveAverages(teamId, supabase);
      
      // Estimate API calls used (1 for fixtures list + up to 10 for stats)
      const estimatedCalls = 11;
      apiCalls += estimatedCalls;
      trackAPICall(estimatedCalls);

      if (stats.sample_size > 0) {
        await supabase.from("stats_cache").upsert({
          team_id: teamId,
          goals: stats.goals,
          corners: stats.corners,
          cards: stats.cards,
          fouls: stats.fouls,
          offsides: stats.offsides,
          sample_size: stats.sample_size,
          last_five_fixture_ids: stats.last_five_fixture_ids,
          last_final_fixture: stats.last_final_fixture,
          computed_at: new Date().toISOString(),
          source: "turbo-stats",
        }, { onConflict: "team_id" });

        processed++;
      }

      if (processed % 10 === 0) {
        console.log(`[turbo-s3] Progress: ${processed} teams refreshed, ${apiCallsUsed}/${allowedBudget} API calls`);
      }

    } catch (error) {
      console.error(`[turbo-s3] Error refreshing stats for team ${teamId}:`, error);
    }
  }

  console.log(`[turbo-s3] Refreshed stats for ${processed} teams`);

  return {
    stage: "stats_cache_refresh",
    processed,
    apiCalls,
    duration_ms: Date.now() - startTime,
  };
}

// Estimate API calls used in last 24 hours from optimizer_run_logs
// CONSERVATIVE estimate - stats_cache already caches data, so API calls are much lower than worst case
async function estimateRecentAPIUsage(supabase: any): Promise<number> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: logs } = await supabase
    .from("optimizer_run_logs")
    .select("scanned, upserted, run_type")
    .gte("started_at", oneDayAgo);

  if (!logs || logs.length === 0) return 0;

  // CONSERVATIVE estimate: most data is cached, so actual API calls are much lower
  // Real-world observation: ~25k-35k calls/day with current automation
  let estimatedCalls = 0;
  for (const log of logs) {
    const upserted = log.upserted || 0; // Use upserted (actual work done) not scanned
    switch (log.run_type) {
      case "stats-refresh-batch":
        // Most teams already have cached stats, only ~2 API calls for delta
        estimatedCalls += upserted * 3;
        break;
      case "results-refresh":
        estimatedCalls += upserted * 2;
        break;
      case "history-backfill":
        estimatedCalls += upserted * 2;
        break;
      case "cron-warmup-odds":
      case "warmup-optimizer":
        estimatedCalls += upserted * 1;
        break;
      default:
        estimatedCalls += upserted;
    }
  }

  // Cap the estimate to a reasonable max - if it seems too high, it's probably wrong
  return Math.min(estimatedCalls, 50000);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  // Reset global counters for this run
  apiCallsUsed = 0;
  allowedBudget = 0;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse("Missing Supabase configuration", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Auth check (same as other admin functions)
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    let isAuthorized = false;

    if (cronKeyHeader) {
      const { data: dbKey } = await supabase.rpc("get_cron_internal_key").single();
      if (dbKey && cronKeyHeader === dbKey) {
        isAuthorized = true;
        console.log("[turbo] Authorized via X-CRON-KEY");
      }
    }

    if (!isAuthorized && authHeader) {
      if (authHeader === `Bearer ${serviceRoleKey}`) {
        isAuthorized = true;
        console.log("[turbo] Authorized via service role");
      } else {
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
        if (anonKey) {
          const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
          });
          const { data: isWhitelisted } = await userClient.rpc("is_user_whitelisted").single();
          if (isWhitelisted) {
            isAuthorized = true;
            console.log("[turbo] Authorized via admin user");
          }
        }
      }
    }

    if (!isAuthorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }

    // Parse request body
    let body: TurboRequest = {};
    try {
      body = await req.json();
    } catch {
      // Use defaults
    }

    const maxAPICallsTotal = body.maxAPICallsTotal ?? 25000;
    const targetCoveragePct = body.targetCoveragePct ?? 90;
    const priorityLeagues = body.priorityLeagues ?? DEFAULT_PRIORITY_LEAGUES;
    const daysLookback = body.daysLookback ?? 60;
    const upcomingDays = body.upcomingDays ?? 7;
    const dryRun = body.dryRun ?? false;
    const skipBudgetCheck = body.skipBudgetCheck ?? false;

    console.log(`[turbo] Starting Turbo Backfill Day`);
    console.log(`[turbo] Config: maxAPICallsTotal=${maxAPICallsTotal}, targetCoverage=${targetCoveragePct}%, daysLookback=${daysLookback}, upcomingDays=${upcomingDays}, skipBudgetCheck=${skipBudgetCheck}`);
    console.log(`[turbo] Priority leagues: ${priorityLeagues.length}`);

    // Calculate available budget
    const estimatedRecentUsage = await estimateRecentAPIUsage(supabase);
    const dailyLimit = 60000; // Conservative daily limit (75k plan with 20% margin)
    const remainingBudget = Math.max(0, dailyLimit - estimatedRecentUsage);
    
    // If skipBudgetCheck is true, use maxAPICallsTotal directly
    allowedBudget = skipBudgetCheck ? maxAPICallsTotal : Math.min(maxAPICallsTotal, remainingBudget);

    console.log(`[turbo] API Budget: estimated recent usage=${estimatedRecentUsage}, remaining=${remainingBudget}, allowed for this run=${allowedBudget}${skipBudgetCheck ? " (budget check SKIPPED)" : ""}`);

    if (!skipBudgetCheck && allowedBudget <= 1000) {
      console.log("[turbo] ⚠️ Insufficient API budget, skipping Turbo Backfill");
      return jsonResponse({
        success: false,
        message: "Insufficient API budget for Turbo Backfill. Use skipBudgetCheck: true to override.",
        estimated_recent_usage: estimatedRecentUsage,
        remaining_budget: remainingBudget,
        allowed_budget: allowedBudget,
      }, origin, 200, req);
    }

    // Compute baseline metrics quickly before starting background job
    console.log("[turbo] Computing baseline coverage metrics...");
    const beforeMetrics = await computeCoverageMetrics(supabase, upcomingDays, priorityLeagues);
    console.log(`[turbo] BEFORE: ${beforeMetrics.teams_sample_gte_3}/${beforeMetrics.total_upcoming_teams} teams with stats (${beforeMetrics.coverage_pct_gte3}%)`);

    if (dryRun) {
      console.log("[turbo] DRY RUN - skipping actual backfill");
      return jsonResponse({
        success: true,
        mode: "dry_run",
        allowed_budget: allowedBudget,
        before_metrics: beforeMetrics,
        priority_leagues: priorityLeagues.length,
      }, origin, 200, req);
    }

    // =========================================================================
    // Background processing using EdgeRuntime.waitUntil to avoid timeout
    // =========================================================================
    const totalStartTime = Date.now();

    const backgroundJob = async () => {
      try {
        console.log("[turbo-bg] Starting background processing...");
        const stageResults: StageResult[] = [];

        // STAGE 1: Historical Fixtures Backfill
        if (canContinue()) {
          const s1Result = await runHistoryBackfillStage(supabase, priorityLeagues, daysLookback);
          stageResults.push(s1Result);
          console.log(`[turbo-bg] Stage 1 complete: ${s1Result.processed} processed, ${s1Result.apiCalls} API calls`);
        }

        // STAGE 2: Results Refresh
        if (canContinue()) {
          const s2Result = await runResultsRefreshStage(supabase, daysLookback);
          stageResults.push(s2Result);
          console.log(`[turbo-bg] Stage 2 complete: ${s2Result.processed} processed, ${s2Result.apiCalls} API calls`);
        }

        // STAGE 3: Stats Cache Refresh
        if (canContinue()) {
          const s3Result = await runStatsCacheRefreshStage(supabase, upcomingDays, priorityLeagues);
          stageResults.push(s3Result);
          console.log(`[turbo-bg] Stage 3 complete: ${s3Result.processed} processed, ${s3Result.apiCalls} API calls`);
        }

        // STAGE 4: Post-run coverage metrics
        console.log("[turbo-bg] Computing post-run coverage metrics...");
        const afterMetrics = await computeCoverageMetrics(supabase, upcomingDays, priorityLeagues);
        console.log(`[turbo-bg] AFTER: ${afterMetrics.teams_sample_gte_3}/${afterMetrics.total_upcoming_teams} teams with stats (${afterMetrics.coverage_pct_gte3}%)`);

        const totalDuration = Date.now() - totalStartTime;
        const budgetExhausted = apiCallsUsed >= allowedBudget;

        // Log to optimizer_run_logs
        await supabase.from("optimizer_run_logs").insert({
          run_type: "stats-turbo-backfill",
          window_start: new Date(totalStartTime).toISOString(),
          window_end: new Date().toISOString(),
          scope: {
            max_api_calls: maxAPICallsTotal,
            target_coverage_pct: targetCoveragePct,
            priority_leagues: priorityLeagues.length,
            days_lookback: daysLookback,
            upcoming_days: upcomingDays,
          },
          scanned: stageResults.reduce((sum, s) => sum + s.processed, 0),
          upserted: stageResults.reduce((sum, s) => sum + s.processed, 0),
          failed: 0,
          started_at: new Date(totalStartTime).toISOString(),
          finished_at: new Date().toISOString(),
          duration_ms: totalDuration,
          notes: JSON.stringify({
            api_calls_used: apiCallsUsed,
            allowed_budget: allowedBudget,
            budget_exhausted: budgetExhausted,
            before_coverage: beforeMetrics.coverage_pct_gte3,
            after_coverage: afterMetrics.coverage_pct_gte3,
            stages: stageResults,
          }),
        });

        console.log(`[turbo-bg] ✅ Turbo Backfill complete: ${apiCallsUsed} API calls, ${totalDuration}ms`);
        console.log(`[turbo-bg] Coverage improvement: ${beforeMetrics.coverage_pct_gte3}% → ${afterMetrics.coverage_pct_gte3}%`);

      } catch (error) {
        console.error("[turbo-bg] Background job error:", error);
        // Log error to optimizer_run_logs
        await supabase.from("optimizer_run_logs").insert({
          run_type: "stats-turbo-backfill",
          window_start: new Date(totalStartTime).toISOString(),
          window_end: new Date().toISOString(),
          started_at: new Date(totalStartTime).toISOString(),
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - totalStartTime,
          failed: 1,
          notes: `Error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    };

    // Schedule background job using EdgeRuntime.waitUntil
    // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(backgroundJob());
      console.log("[turbo] Background job scheduled via EdgeRuntime.waitUntil");
    } else {
      // Fallback: run in background without waiting (fire-and-forget)
      backgroundJob().catch((err) => console.error("[turbo] Background job failed:", err));
      console.log("[turbo] Background job started (fallback mode)");
    }

    // Return immediately with "started" response
    return jsonResponse({
      success: true,
      status: "started",
      message: "Turbo Backfill job started in background. Check logs and optimizer_run_logs for progress.",
      allowed_budget: allowedBudget,
      estimated_recent_usage: estimatedRecentUsage,
      before_metrics: beforeMetrics,
      priority_leagues_count: priorityLeagues.length,
    }, origin, 200, req);

  } catch (error) {
    console.error("[turbo] Fatal error:", error);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
