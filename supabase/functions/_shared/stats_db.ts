// ============================================================================
// DB-Based Stats Recomputation - Single Source of Truth
// ============================================================================
// This module provides functions to recompute team stats purely from our local DB
// (fixtures + fixture_results) instead of calling API-Football.
//
// Used by:
// - stats-health-check (validation)
// - Fixture Analyzer (optional DB-based mode)
// - stats-refresh (when DB has sufficient history)
//
// KEY PRINCIPLE: If we have 5+ fixtures in fixture_results for a team,
// we can compute accurate stats without API calls.
// ============================================================================

import { MIN_SAMPLE_SIZE } from "./stats_integrity.ts";

// Re-export for backwards compatibility
export const MIN_FIXTURES_FOR_RELIABLE_STATS = MIN_SAMPLE_SIZE;
export const OPTIMAL_FIXTURE_COUNT = 5;

export interface DBStatsResult {
  team_id: number;
  goals: number;
  corners: number;
  cards: number;
  fouls: number;
  offsides: number;
  sample_size: number;
  fixture_ids: number[];
  goals_count: number;
  corners_count: number;
  cards_count: number;
  fouls_count: number;
  offsides_count: number;
  has_sufficient_history: boolean;
}

interface Fixture {
  id: number;
  league_id: number;
  teams_home: { id?: number | string } | null;
  teams_away: { id?: number | string } | null;
  timestamp: number;
  status: string;
}

interface FixtureResult {
  fixture_id: number;
  goals_home: number | null;
  goals_away: number | null;
  corners_home: number | null;
  corners_away: number | null;
  cards_home: number | null;
  cards_away: number | null;
  fouls_home: number | null;
  fouls_away: number | null;
  offsides_home: number | null;
  offsides_away: number | null;
}

/**
 * Recompute team stats from local DB (fixtures + fixture_results)
 * Returns null if insufficient data
 */
export async function recomputeTeamStatsFromDB(
  supabase: any,
  teamId: number,
  maxFixtures: number = 5
): Promise<DBStatsResult | null> {
  console.log(`[stats_db] Recomputing stats for team ${teamId} from DB (max ${maxFixtures} fixtures)`);

  // Get team's last N FINISHED fixtures from our DB
  const { data: fixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id, league_id, teams_home, teams_away, timestamp, status")
    .in("status", ["FT", "AET", "PEN"])
    .or(`teams_home->>id.eq.${teamId},teams_away->>id.eq.${teamId}`)
    .order("timestamp", { ascending: false })
    .limit(maxFixtures);

  if (fixturesError) {
    console.error(`[stats_db] Error fetching fixtures for team ${teamId}:`, fixturesError);
    return null;
  }

  if (!fixtures || fixtures.length === 0) {
    console.log(`[stats_db] Team ${teamId} has no finished fixtures in DB`);
    return null;
  }

  const typedFixtures = fixtures as Fixture[];
  const fixtureIds = typedFixtures.map((f: Fixture) => f.id);
  console.log(`[stats_db] Found ${typedFixtures.length} finished fixtures for team ${teamId}: [${fixtureIds.join(',')}]`);

  // Get fixture_results for these fixtures
  const { data: results, error: resultsError } = await supabase
    .from("fixture_results")
    .select("fixture_id, goals_home, goals_away, corners_home, corners_away, cards_home, cards_away, fouls_home, fouls_away, offsides_home, offsides_away")
    .in("fixture_id", fixtureIds);

  if (resultsError) {
    console.error(`[stats_db] Error fetching results for team ${teamId}:`, resultsError);
    return null;
  }

  const typedResults = (results || []) as FixtureResult[];
  const resultsMap = new Map<number, FixtureResult>(typedResults.map((r: FixtureResult) => [r.fixture_id, r]));
  
  // Check how many fixtures have results
  const fixturesWithResults = typedFixtures.filter((f: Fixture) => resultsMap.has(f.id));
  console.log(`[stats_db] Team ${teamId}: ${fixturesWithResults.length}/${typedFixtures.length} fixtures have results`);

  if (fixturesWithResults.length === 0) {
    console.log(`[stats_db] Team ${teamId} has no fixture_results`);
    return null;
  }

  // Compute per-metric averages
  let totalGoals = 0, countGoals = 0;
  let totalCorners = 0, countCorners = 0;
  let totalCards = 0, countCards = 0;
  let totalFouls = 0, countFouls = 0;
  let totalOffsides = 0, countOffsides = 0;
  const usedFixtureIds: number[] = [];

  for (const fixture of typedFixtures) {
    const result = resultsMap.get(fixture.id);
    if (!result) continue;

    usedFixtureIds.push(fixture.id);

    const homeId = Number(fixture.teams_home?.id);
    const isHome = homeId === teamId;

    // Goals
    const goals = isHome ? result.goals_home : result.goals_away;
    if (goals !== null && goals !== undefined) {
      totalGoals += goals;
      countGoals++;
    }

    // Corners
    const corners = isHome ? result.corners_home : result.corners_away;
    if (corners !== null && corners !== undefined) {
      totalCorners += corners;
      countCorners++;
    }

    // Cards
    const cards = isHome ? result.cards_home : result.cards_away;
    if (cards !== null && cards !== undefined) {
      totalCards += cards;
      countCards++;
    }

    // Fouls
    const fouls = isHome ? result.fouls_home : result.fouls_away;
    if (fouls !== null && fouls !== undefined) {
      totalFouls += fouls;
      countFouls++;
    }

    // Offsides
    const offsides = isHome ? result.offsides_home : result.offsides_away;
    if (offsides !== null && offsides !== undefined) {
      totalOffsides += offsides;
      countOffsides++;
    }
  }

  const hasSufficientHistory = countGoals >= MIN_FIXTURES_FOR_RELIABLE_STATS;

  const result: DBStatsResult = {
    team_id: teamId,
    goals: countGoals > 0 ? totalGoals / countGoals : 0,
    corners: countCorners > 0 ? totalCorners / countCorners : 0,
    cards: countCards > 0 ? totalCards / countCards : 0,
    fouls: countFouls > 0 ? totalFouls / countFouls : 0,
    offsides: countOffsides > 0 ? totalOffsides / countOffsides : 0,
    sample_size: countGoals,
    fixture_ids: usedFixtureIds,
    goals_count: countGoals,
    corners_count: countCorners,
    cards_count: countCards,
    fouls_count: countFouls,
    offsides_count: countOffsides,
    has_sufficient_history: hasSufficientHistory
  };

  console.log(`[stats_db] Team ${teamId} DB stats: goals=${result.goals.toFixed(2)} (${countGoals}), corners=${result.corners.toFixed(2)} (${countCorners}), cards=${result.cards.toFixed(2)} (${countCards}), sufficient=${hasSufficientHistory}`);

  return result;
}

/**
 * Get DB fixture count for a team (how many finished fixtures with results we have)
 */
export async function getTeamDBFixtureCount(supabase: any, teamId: number): Promise<number> {
  const { data: fixtures } = await supabase
    .from("fixtures")
    .select("id")
    .in("status", ["FT", "AET", "PEN"])
    .or(`teams_home->>id.eq.${teamId},teams_away->>id.eq.${teamId}`)
    .limit(20);

  if (!fixtures || fixtures.length === 0) return 0;

  const typedFixtures = fixtures as { id: number }[];
  const fixtureIds = typedFixtures.map((f: { id: number }) => f.id);
  
  const { count } = await supabase
    .from("fixture_results")
    .select("fixture_id", { count: "exact", head: true })
    .in("fixture_id", fixtureIds);

  return count || 0;
}

/**
 * Validate that stats_cache matches DB-recomputed stats
 * Returns validation result with diff details
 */
export interface StatsValidationResult {
  isValid: boolean;
  hasDBHistory: boolean;
  dbFixtureCount: number;
  cacheExists: boolean;
  cacheSampleSize: number;
  diffs: {
    metric: string;
    dbValue: number | null;
    cacheValue: number;
    diff: number;
    isAcceptable: boolean;
  }[];
  reason?: string;
}

const VALIDATION_THRESHOLDS = {
  goals: 0.3,
  corners: 1.0,
  cards: 0.8,
  fouls: 3.0,
  offsides: 1.5
};

export async function validateStatsAgainstDB(
  supabase: any,
  teamId: number
): Promise<StatsValidationResult> {
  const result: StatsValidationResult = {
    isValid: true,
    hasDBHistory: false,
    dbFixtureCount: 0,
    cacheExists: false,
    cacheSampleSize: 0,
    diffs: []
  };

  // Get stats_cache entry
  const { data: cacheEntry } = await supabase
    .from("stats_cache")
    .select("*")
    .eq("team_id", teamId)
    .maybeSingle();

  result.cacheExists = !!cacheEntry;
  result.cacheSampleSize = cacheEntry?.sample_size || 0;

  // Recompute from DB
  const dbStats = await recomputeTeamStatsFromDB(supabase, teamId);
  
  if (!dbStats) {
    result.hasDBHistory = false;
    result.dbFixtureCount = 0;
    // If no DB history, we can't validate - consider valid if cache exists
    result.isValid = result.cacheExists;
    result.reason = "No DB history to validate against";
    return result;
  }

  result.hasDBHistory = dbStats.has_sufficient_history;
  result.dbFixtureCount = dbStats.sample_size;

  if (!cacheEntry) {
    result.isValid = false;
    result.reason = "Missing stats_cache entry";
    return result;
  }

  // Only validate if DB has sufficient history
  if (!dbStats.has_sufficient_history) {
    result.reason = "Insufficient DB history for validation";
    return result;
  }

  // Compare each metric
  const metrics = [
    { name: 'goals', db: dbStats.goals, cache: cacheEntry.goals, count: dbStats.goals_count },
    { name: 'corners', db: dbStats.corners, cache: cacheEntry.corners, count: dbStats.corners_count },
    { name: 'cards', db: dbStats.cards, cache: cacheEntry.cards, count: dbStats.cards_count },
    { name: 'fouls', db: dbStats.fouls, cache: cacheEntry.fouls, count: dbStats.fouls_count },
    { name: 'offsides', db: dbStats.offsides, cache: cacheEntry.offsides, count: dbStats.offsides_count }
  ];

  for (const m of metrics) {
    // Skip if DB doesn't have this metric
    if (m.count < 2) continue;

    const diff = Math.abs(m.db - m.cache);
    const threshold = VALIDATION_THRESHOLDS[m.name as keyof typeof VALIDATION_THRESHOLDS] || 1.0;
    const isAcceptable = diff <= threshold;

    result.diffs.push({
      metric: m.name,
      dbValue: m.db,
      cacheValue: m.cache,
      diff,
      isAcceptable
    });

    if (!isAcceptable) {
      result.isValid = false;
    }
  }

  if (!result.isValid) {
    const failedMetrics = result.diffs.filter(d => !d.isAcceptable).map(d => d.metric);
    result.reason = `Metrics exceed threshold: ${failedMetrics.join(', ')}`;
  }

  return result;
}
