// ============================================================================
// Stats Integrity Helper - GOALS-FIRST Philosophy
// ============================================================================
// Shared validation for Filterizer, Ticket Creator, and Fixture Analyzer.
// 
// KEY PRINCIPLES:
// 1. GOALS are MANDATORY - fixture is invalid if goals sample < 3
// 2. Other metrics (corners/cards/fouls/offsides) are NICE-TO-HAVE
//    - Missing non-goal metrics should NOT block a fixture
//    - They should be marked as "unavailable" but fixture remains valid
// 3. CRITICAL violations only for truly corrupted data (impossible values)
// ============================================================================

export const MIN_SAMPLE_SIZE = 3;
export const GOALS_DIFF_THRESHOLD = 0.3;

interface StatsCache {
  team_id: number;
  sample_size: number;
  goals: number;
  corners: number;
  cards: number;
  fouls: number;
  offsides: number;
}

interface Violation {
  team_id: number;
  severity: string;
  metric: string;
}

// Per-metric availability info
export interface MetricAvailability {
  goals: { available: boolean; sample_size: number; value: number };
  corners: { available: boolean; sample_size: number; value: number };
  cards: { available: boolean; sample_size: number; value: number };
  fouls: { available: boolean; sample_size: number; value: number };
  offsides: { available: boolean; sample_size: number; value: number };
}

// Enhanced validation result with per-metric info
export interface StatsValidation {
  isValid: boolean;
  reason?: string;
  homeTeam: {
    hasCache: boolean;
    sampleSize: number;
    hasCriticalViolation: boolean;
    metrics?: MetricAvailability;
  };
  awayTeam: {
    hasCache: boolean;
    sampleSize: number;
    hasCriticalViolation: boolean;
    metrics?: MetricAvailability;
  };
}

/**
 * Determines metric availability based on value
 * A metric is "available" if it has a non-zero value or sample_size > 0
 * Goals always use the main sample_size; other metrics may be partial
 */
function buildMetricAvailability(cache: StatsCache | null): MetricAvailability {
  if (!cache) {
    return {
      goals: { available: false, sample_size: 0, value: 0 },
      corners: { available: false, sample_size: 0, value: 0 },
      cards: { available: false, sample_size: 0, value: 0 },
      fouls: { available: false, sample_size: 0, value: 0 },
      offsides: { available: false, sample_size: 0, value: 0 },
    };
  }

  // Goals are always based on sample_size (mandatory)
  const goalsAvailable = cache.sample_size >= MIN_SAMPLE_SIZE;
  
  // For other metrics, consider available if:
  // - Main sample_size >= 3 (we have enough fixtures), AND
  // - Value > 0 (API actually returned data for this metric)
  // Note: value = 0 could mean either "API returned 0" or "no data"
  // We treat value > 0 as definitely available; value = 0 as potentially unavailable
  const cornersAvailable = cache.sample_size >= MIN_SAMPLE_SIZE && cache.corners > 0;
  const cardsAvailable = cache.sample_size >= MIN_SAMPLE_SIZE && cache.cards >= 0; // Cards can legitimately be 0
  const foulsAvailable = cache.sample_size >= MIN_SAMPLE_SIZE && cache.fouls > 0;
  const offsidesAvailable = cache.sample_size >= MIN_SAMPLE_SIZE && cache.offsides >= 0; // Can be 0

  return {
    goals: { available: goalsAvailable, sample_size: cache.sample_size, value: cache.goals },
    corners: { available: cornersAvailable, sample_size: cache.sample_size, value: cache.corners },
    cards: { available: cardsAvailable, sample_size: cache.sample_size, value: cache.cards },
    fouls: { available: foulsAvailable, sample_size: cache.sample_size, value: cache.fouls },
    offsides: { available: offsidesAvailable, sample_size: cache.sample_size, value: cache.offsides },
  };
}

/**
 * Validates that both teams in a fixture have reliable GOALS stats
 * 
 * GOALS-FIRST LOGIC:
 * - Returns isValid=false ONLY if:
 *   1. No stats_cache entry for either team
 *   2. Goals sample_size < 3 for either team
 *   3. Active CRITICAL violation on GOALS metric
 * 
 * - Does NOT return isValid=false for:
 *   - Missing corners/cards/fouls/offsides (these are nice-to-have)
 *   - Low sample for non-goal metrics
 */
export async function validateFixtureStats(
  supabase: any,
  homeTeamId: number,
  awayTeamId: number
): Promise<StatsValidation> {
  // Fetch stats_cache for both teams
  const { data: statsCache } = await supabase
    .from("stats_cache")
    .select("team_id, sample_size, goals, corners, cards, fouls, offsides")
    .in("team_id", [homeTeamId, awayTeamId]);

  const cacheMap = new Map<number, StatsCache>(
    ((statsCache || []) as StatsCache[]).map((sc: StatsCache) => [sc.team_id, sc])
  );
  const homeCache = cacheMap.get(homeTeamId);
  const awayCache = cacheMap.get(awayTeamId);

  // Check for active CRITICAL violations on GOALS only
  const { data: violations } = await supabase
    .from("stats_health_violations")
    .select("team_id, severity, metric")
    .in("team_id", [homeTeamId, awayTeamId])
    .eq("metric", "goals")
    .eq("severity", "critical")
    .is("resolved_at", null);

  const violationMap = new Map<number, Violation>(
    ((violations || []) as Violation[]).map((v: Violation) => [v.team_id, v])
  );
  const homeViolation = violationMap.get(homeTeamId);
  const awayViolation = violationMap.get(awayTeamId);

  const result: StatsValidation = {
    isValid: true,
    homeTeam: {
      hasCache: !!homeCache,
      sampleSize: homeCache?.sample_size || 0,
      hasCriticalViolation: !!homeViolation,
      metrics: buildMetricAvailability(homeCache || null),
    },
    awayTeam: {
      hasCache: !!awayCache,
      sampleSize: awayCache?.sample_size || 0,
      hasCriticalViolation: !!awayViolation,
      metrics: buildMetricAvailability(awayCache || null),
    }
  };

  // GOALS-FIRST VALIDATION
  // Home team validation
  if (!homeCache) {
    result.isValid = false;
    result.reason = `Home team (${homeTeamId}) has no stats_cache`;
  } else if (homeCache.sample_size < MIN_SAMPLE_SIZE) {
    result.isValid = false;
    result.reason = `Home team (${homeTeamId}) has sample_size=${homeCache.sample_size} (need ${MIN_SAMPLE_SIZE}+ for goals)`;
  } else if (homeViolation) {
    result.isValid = false;
    result.reason = `Home team (${homeTeamId}) has CRITICAL goals violation`;
  }

  // Away team validation (only if home passed)
  if (result.isValid) {
    if (!awayCache) {
      result.isValid = false;
      result.reason = `Away team (${awayTeamId}) has no stats_cache`;
    } else if (awayCache.sample_size < MIN_SAMPLE_SIZE) {
      result.isValid = false;
      result.reason = `Away team (${awayTeamId}) has sample_size=${awayCache.sample_size} (need ${MIN_SAMPLE_SIZE}+ for goals)`;
    } else if (awayViolation) {
      result.isValid = false;
      result.reason = `Away team (${awayTeamId}) has CRITICAL goals violation`;
    }
  }

  return result;
}

/**
 * Batch validates multiple fixtures
 * Returns a map of fixture_id -> validation result
 */
export async function validateFixturesBatch(
  supabase: any,
  fixtures: Array<{ fixture_id: number; home_team_id: number; away_team_id: number }>
): Promise<Map<number, StatsValidation>> {
  const results = new Map<number, StatsValidation>();
  
  if (fixtures.length === 0) return results;

  // Collect all unique team IDs
  const teamIds = new Set<number>();
  for (const f of fixtures) {
    teamIds.add(f.home_team_id);
    teamIds.add(f.away_team_id);
  }

  // Fetch all stats_cache entries at once
  const { data: statsCache } = await supabase
    .from("stats_cache")
    .select("team_id, sample_size, goals, corners, cards, fouls, offsides")
    .in("team_id", Array.from(teamIds));

  const cacheMap = new Map<number, StatsCache>(
    ((statsCache || []) as StatsCache[]).map((sc: StatsCache) => [sc.team_id, sc])
  );

  // Fetch all active CRITICAL violations on GOALS at once
  const { data: violations } = await supabase
    .from("stats_health_violations")
    .select("team_id, severity, metric")
    .in("team_id", Array.from(teamIds))
    .eq("metric", "goals")
    .eq("severity", "critical")
    .is("resolved_at", null);

  const violationMap = new Map<number, Violation>(
    ((violations || []) as Violation[]).map((v: Violation) => [v.team_id, v])
  );

  // Validate each fixture
  for (const f of fixtures) {
    const homeCache = cacheMap.get(f.home_team_id);
    const awayCache = cacheMap.get(f.away_team_id);
    const homeViolation = violationMap.get(f.home_team_id);
    const awayViolation = violationMap.get(f.away_team_id);

    const validation: StatsValidation = {
      isValid: true,
      homeTeam: {
        hasCache: !!homeCache,
        sampleSize: homeCache?.sample_size || 0,
        hasCriticalViolation: !!homeViolation,
        metrics: buildMetricAvailability(homeCache || null),
      },
      awayTeam: {
        hasCache: !!awayCache,
        sampleSize: awayCache?.sample_size || 0,
        hasCriticalViolation: !!awayViolation,
        metrics: buildMetricAvailability(awayCache || null),
      }
    };

    // GOALS-FIRST validation
    if (!homeCache) {
      validation.isValid = false;
      validation.reason = `Home team missing cache`;
    } else if (homeCache.sample_size < MIN_SAMPLE_SIZE) {
      validation.isValid = false;
      validation.reason = `Home team low sample (${homeCache.sample_size})`;
    } else if (homeViolation) {
      validation.isValid = false;
      validation.reason = `Home team CRITICAL violation`;
    }

    if (validation.isValid) {
      if (!awayCache) {
        validation.isValid = false;
        validation.reason = `Away team missing cache`;
      } else if (awayCache.sample_size < MIN_SAMPLE_SIZE) {
        validation.isValid = false;
        validation.reason = `Away team low sample (${awayCache.sample_size})`;
      } else if (awayViolation) {
        validation.isValid = false;
        validation.reason = `Away team CRITICAL violation`;
      }
    }

    results.set(f.fixture_id, validation);
  }

  return results;
}
