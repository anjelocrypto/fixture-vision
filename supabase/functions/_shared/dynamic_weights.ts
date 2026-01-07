/**
 * Dynamic Performance Weights
 * 
 * Loads performance weights from the database and provides helper functions
 * to replace static line preferences with data-driven decisions.
 * 
 * Falls back to static defaults if weights not available.
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Minimum sample size to trust dynamic weights
const MIN_SAMPLE_SIZE = 10;

// Bayesian thresholds for preference/avoidance
const HIGH_BAYES_THRESHOLD = 0.58;  // Prefer lines above this
const LOW_BAYES_THRESHOLD = 0.42;   // Avoid lines below this
const LOW_WEIGHT_THRESHOLD = 0.80;  // Avoid leagues/lines below this weight

interface PerformanceWeight {
  market: string;
  side: string;
  line: number;
  league_id: number | null;
  sample_size: number;
  bayes_win_rate: number;
  weight: number;
  raw_win_rate: number;
  roi_pct: number;
}

// In-memory cache for weights (loaded once per request)
let weightsCache: Map<string, PerformanceWeight> | null = null;
let globalWeightsCache: Map<string, PerformanceWeight> | null = null;
let weightsCacheLoaded = false;

/**
 * Load performance weights from database.
 * Call once at start of request handling.
 */
export async function loadPerformanceWeights(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("performance_weights")
      .select("market, side, line, league_id, sample_size, bayes_win_rate, weight, raw_win_rate, roi_pct");

    if (error) {
      console.error("[dynamic_weights] Failed to load weights:", error.message);
      return false;
    }

    if (!data || data.length === 0) {
      console.warn("[dynamic_weights] No weights found in database");
      return false;
    }

    // Build lookup maps
    weightsCache = new Map();
    globalWeightsCache = new Map();

    for (const row of data) {
      const w = row as PerformanceWeight;
      
      if (w.league_id === null) {
        // Global weight (no league)
        const globalKey = `${w.market}|${w.side}|${w.line}`;
        globalWeightsCache.set(globalKey, w);
      } else {
        // League-specific weight
        const leagueKey = `${w.market}|${w.side}|${w.line}|${w.league_id}`;
        weightsCache.set(leagueKey, w);
      }
    }

    weightsCacheLoaded = true;
    console.log(`[dynamic_weights] Loaded ${data.length} weights (${globalWeightsCache.size} global, ${weightsCache.size} league-specific)`);
    return true;
  } catch (err) {
    console.error("[dynamic_weights] Exception loading weights:", err);
    return false;
  }
}

/**
 * Clear cached weights (call at end of request if needed).
 */
export function clearWeightsCache(): void {
  weightsCache = null;
  globalWeightsCache = null;
  weightsCacheLoaded = false;
}

/**
 * Get weight for a specific market/side/line combo, optionally for a specific league.
 * Returns league-specific weight if available, otherwise global weight, otherwise default 1.0.
 */
export function getDynamicWeight(
  market: string,
  side: string,
  line: number,
  leagueId?: number | null
): number {
  if (!weightsCacheLoaded || !weightsCache || !globalWeightsCache) {
    return 1.0; // Fallback to neutral weight
  }

  // Try league-specific first
  if (leagueId !== null && leagueId !== undefined) {
    const leagueKey = `${market}|${side}|${line}|${leagueId}`;
    const leagueWeight = weightsCache.get(leagueKey);
    if (leagueWeight && leagueWeight.sample_size >= MIN_SAMPLE_SIZE) {
      return leagueWeight.weight;
    }
  }

  // Fall back to global
  const globalKey = `${market}|${side}|${line}`;
  const globalWeight = globalWeightsCache.get(globalKey);
  if (globalWeight && globalWeight.sample_size >= MIN_SAMPLE_SIZE) {
    return globalWeight.weight;
  }

  return 1.0; // Default neutral
}

/**
 * Get full weight record for a specific market/side/line combo.
 */
export function getWeightRecord(
  market: string,
  side: string,
  line: number,
  leagueId?: number | null
): PerformanceWeight | null {
  if (!weightsCacheLoaded || !weightsCache || !globalWeightsCache) {
    return null;
  }

  // Try league-specific first
  if (leagueId !== null && leagueId !== undefined) {
    const leagueKey = `${market}|${side}|${line}|${leagueId}`;
    const leagueWeight = weightsCache.get(leagueKey);
    if (leagueWeight && leagueWeight.sample_size >= MIN_SAMPLE_SIZE) {
      return leagueWeight;
    }
  }

  // Fall back to global
  const globalKey = `${market}|${side}|${line}`;
  const globalWeight = globalWeightsCache.get(globalKey);
  if (globalWeight && globalWeight.sample_size >= MIN_SAMPLE_SIZE) {
    return globalWeight;
  }

  return null;
}

/**
 * Check if a line is dynamically preferred (high Bayesian win rate).
 * Replaces static isPreferredLine() checks.
 */
export function isDynamicallyPreferred(
  market: string,
  side: string,
  line: number,
  leagueId?: number | null
): boolean {
  const record = getWeightRecord(market, side, line, leagueId);
  if (!record) return false; // No data = not preferred
  
  return record.bayes_win_rate >= HIGH_BAYES_THRESHOLD;
}

/**
 * Check if a line should be dynamically avoided (low Bayesian win rate).
 * Replaces static shouldAvoidLine() checks.
 */
export function shouldDynamicallyAvoid(
  market: string,
  side: string,
  line: number,
  leagueId?: number | null
): boolean {
  const record = getWeightRecord(market, side, line, leagueId);
  if (!record) return false; // No data = don't avoid (conservative)
  
  return record.bayes_win_rate < LOW_BAYES_THRESHOLD || record.weight < LOW_WEIGHT_THRESHOLD;
}

/**
 * Get league weight dynamically (average weight across all markets for that league).
 * Replaces static LEAGUE_WEIGHTS map.
 */
export function getDynamicLeagueWeight(leagueId: number): number {
  if (!weightsCacheLoaded || !weightsCache) {
    return 0.9; // Default fallback
  }

  // Calculate average weight for this league
  let totalWeight = 0;
  let count = 0;

  for (const [key, weight] of weightsCache.entries()) {
    if (key.endsWith(`|${leagueId}`) && weight.sample_size >= MIN_SAMPLE_SIZE) {
      totalWeight += weight.weight;
      count++;
    }
  }

  if (count === 0) return 0.9; // No data for this league
  return totalWeight / count;
}

/**
 * Check if weights are loaded and available.
 */
export function areWeightsLoaded(): boolean {
  return weightsCacheLoaded && weightsCache !== null && globalWeightsCache !== null;
}

// Static fallbacks (from original code) - used when weights not loaded
export const STATIC_HIGH_WIN_RATE_LINES: Record<string, number[]> = {
  goals: [1.5],
  corners: [8.5],
  cards: [2.5, 3.5],
};

export const STATIC_LOW_WIN_RATE_LINES: Record<string, number[]> = {
  goals: [2.5, 3.5],
  corners: [10.5, 11.5],
  cards: [4.5, 5.5],
};

export const STATIC_LEAGUE_WEIGHTS: Record<number, number> = {
  40: 1.3,   // Championship 78.9%
  39: 1.2,   // Premier League 77.8%
  3: 1.1,    // Europa League 75%
  848: 1.1,  // Conference League 71.4%
  2: 1.0,    // Champions League 61.5%
  135: 1.0,  // Serie A 60%
  140: 0.7,  // La Liga 37.5%
  61: 0.5,   // Ligue 1 12.5%
  307: 0.3,  // Pro League Saudi 0%
};
