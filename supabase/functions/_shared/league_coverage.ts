// League coverage utilities for checking which competitions have reliable stats

export type LeagueCoverage = {
  league_id: number;
  skip_goals: boolean;
  skip_corners: boolean;
  skip_cards: boolean;
  skip_fouls: boolean;
  skip_offsides: boolean;
};

// Cache for league coverage data (refreshed periodically)
let coverageCache: Map<number, LeagueCoverage> | null = null;
let cacheLastUpdated: number = 0;
const CACHE_TTL_MS = 3600000; // 1 hour

/**
 * Load league coverage data from database
 * This tells us which leagues/cups have poor stats coverage per metric
 */
export async function loadLeagueCoverage(supabase: any): Promise<Map<number, LeagueCoverage>> {
  const now = Date.now();
  
  // Return cached data if still fresh
  if (coverageCache && (now - cacheLastUpdated) < CACHE_TTL_MS) {
    return coverageCache;
  }

  console.log("[league_coverage] Loading league coverage data from database...");

  const { data, error } = await supabase
    .from("league_stats_coverage")
    .select("league_id, skip_goals, skip_corners, skip_cards, skip_fouls, skip_offsides");

  if (error) {
    console.error("[league_coverage] Error loading coverage data:", error);
    // Return empty map on error, don't crash
    return new Map();
  }

  const map = new Map<number, LeagueCoverage>();
  
  if (data) {
    for (const row of data) {
      map.set(row.league_id, {
        league_id: row.league_id,
        skip_goals: row.skip_goals,
        skip_corners: row.skip_corners,
        skip_cards: row.skip_cards,
        skip_fouls: row.skip_fouls,
        skip_offsides: row.skip_offsides,
      });
    }
  }

  console.log(`[league_coverage] Loaded coverage data for ${map.size} leagues`);
  
  // Update cache
  coverageCache = map;
  cacheLastUpdated = now;

  return map;
}

/**
 * Check if a fixture should be skipped for a specific metric
 * based on its league's coverage data
 */
export function shouldSkipFixtureForMetric(
  leagueId: number,
  metric: 'goals' | 'corners' | 'cards' | 'fouls' | 'offsides',
  coverageMap: Map<number, LeagueCoverage>
): boolean {
  const coverage = coverageMap.get(leagueId);
  
  if (!coverage) {
    // No coverage data for this league = assume it's OK (don't skip)
    return false;
  }

  switch (metric) {
    case 'goals':
      return coverage.skip_goals;
    case 'corners':
      return coverage.skip_corners;
    case 'cards':
      return coverage.skip_cards;
    case 'fouls':
      return coverage.skip_fouls;
    case 'offsides':
      return coverage.skip_offsides;
    default:
      return false;
  }
}

/**
 * Get skip flags for a specific league
 */
export function getLeagueSkipFlags(
  leagueId: number,
  coverageMap: Map<number, LeagueCoverage>
): LeagueCoverage | null {
  return coverageMap.get(leagueId) || null;
}
