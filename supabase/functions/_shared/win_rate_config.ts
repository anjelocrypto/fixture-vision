/**
 * WIN RATE OPTIMIZATION CONFIG
 * 
 * Now reads dynamic weights from performance_weights table (populated by
 * update-performance-weights edge function running weekly).
 * Falls back to static defaults if DB lookup fails.
 * 
 * Based on historical ticket outcome analysis (Jan 2026):
 * - Only goals/corners/cards with side=over and known line are scorable
 * - Historical win rates derived from 297 scorable legs with fixture_results
 */

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// Markets that can be scored against fixture_results
export const SCORABLE_MARKETS = ["goals", "corners", "cards"] as const;
export type ScorableMarket = typeof SCORABLE_MARKETS[number];

// Only "over" side is currently scorable
export const SCORABLE_SIDES = ["over"] as const;

// Static fallback: High-probability lines based on historical data (>70% win rate with n≥10)
export const HIGH_WIN_RATE_LINES: Record<ScorableMarket, number[]> = {
  goals: [1.5],      // 86.1% win rate
  corners: [8.5],    // Limited data but corners overs tend to hit
  cards: [2.5, 3.5], // Cards Over 2.5-3.5 perform well
};

// Static fallback: Lines to AVOID in max win rate mode (historically <35% win rate)
export const LOW_WIN_RATE_LINES: Record<ScorableMarket, number[]> = {
  goals: [2.5, 3.5],   // Over 2.5 only 28.6%, Over 3.5 risky
  corners: [10.5, 11.5], // High corner lines rarely hit
  cards: [4.5, 5.5],   // Over 4.5 only 25% win rate
};

// Bayesian shrinkage: blend observed win rate with prior
// prior = 0.5 (uninformed), strength = 10 (equivalent to 10 prior observations)
export function bayesianWinRate(wins: number, total: number, priorStrength = 10): number {
  const prior = 0.5;
  return (wins + prior * priorStrength) / (total + priorStrength);
}

// Static fallback: League performance weights
export const LEAGUE_WEIGHTS: Record<number, { weight: number; name: string }> = {
  // HIGH PERFORMERS (>70% win rate)
  40: { weight: 1.3, name: "Championship" },
  39: { weight: 1.2, name: "Premier League" },
  3: { weight: 1.1, name: "UEFA Europa League" },
  848: { weight: 1.1, name: "UEFA Conference" },
  
  // AVERAGE PERFORMERS (50-70%)
  2: { weight: 1.0, name: "UEFA Champions League" },
  135: { weight: 1.0, name: "Serie A" },
  88: { weight: 0.95, name: "Eredivisie" },
  
  // LOW PERFORMERS (<50% win rate - penalize)
  140: { weight: 0.7, name: "La Liga" },
  61: { weight: 0.5, name: "Ligue 1" },
  307: { weight: 0.3, name: "Pro League Saudi" },
};

// Default weight for leagues not in the list
export const DEFAULT_LEAGUE_WEIGHT = 0.9;

// Ticket mode configurations
export interface TicketModeConfig {
  name: string;
  description: string;
  minLegs: number;
  maxLegs: number;
  minOdds: number;
  maxOdds: number;
  allowedMarkets: string[];
  allowedSides: string[];
  preferredLines: Record<string, number[]> | null;
  avoidLines: Record<string, number[]> | null;
  useLeagueWeights: boolean;
  minLeagueWeight: number;
}

export const TICKET_MODES: Record<string, TicketModeConfig> = {
  max_win_rate: {
    name: "Max Win Rate",
    description: "Singles/doubles only, high-probability lines, top leagues",
    minLegs: 1,
    maxLegs: 2,
    minOdds: 1.5,
    maxOdds: 4.0,
    allowedMarkets: ["goals", "corners", "cards"],
    allowedSides: ["over"],
    preferredLines: HIGH_WIN_RATE_LINES,
    avoidLines: LOW_WIN_RATE_LINES,
    useLeagueWeights: true,
    minLeagueWeight: 0.8,
  },
  balanced: {
    name: "Balanced",
    description: "Standard ticket generation with all markets",
    minLegs: 3,
    maxLegs: 8,
    minOdds: 5,
    maxOdds: 20,
    allowedMarkets: ["goals", "corners", "cards"],
    allowedSides: ["over"],
    preferredLines: null,
    avoidLines: null,
    useLeagueWeights: false,
    minLeagueWeight: 0,
  },
  high_risk: {
    name: "High Risk",
    description: "More legs, higher odds, all markets",
    minLegs: 5,
    maxLegs: 15,
    minOdds: 15,
    maxOdds: 50,
    allowedMarkets: ["goals", "corners", "cards"],
    allowedSides: ["over"],
    preferredLines: null,
    avoidLines: null,
    useLeagueWeights: false,
    minLeagueWeight: 0,
  },
};

// Check if a leg is scorable against fixture_results
export function isScorableLeg(market: string, side: string | null, line: number | null): boolean {
  if (!SCORABLE_MARKETS.includes(market as ScorableMarket)) return false;
  if (side !== "over") return false;
  if (line === null || line === undefined) return false;
  return true;
}

// Score a leg against fixture results
export function scoreLeg(
  market: string,
  side: string,
  line: number,
  result: { total_goals?: number; total_corners?: number; total_cards?: number }
): "win" | "loss" | "push" | "not_scorable" {
  if (!isScorableLeg(market, side, line)) return "not_scorable";
  
  let actual: number | undefined;
  if (market === "goals") actual = result.total_goals;
  else if (market === "corners") actual = result.total_corners;
  else if (market === "cards") actual = result.total_cards;
  
  if (actual === undefined || actual === null) return "not_scorable";
  
  if (side === "over") {
    if (actual > line) return "win";
    if (actual === line) return "push";
    return "loss";
  }
  
  // Under case (not currently in scorable sides but kept for future)
  if (actual < line) return "win";
  if (actual === line) return "push";
  return "loss";
}

// Get league weight with Bayesian shrinkage (static fallback)
export function getLeagueWeight(leagueId: number): number {
  const known = LEAGUE_WEIGHTS[leagueId];
  if (known) return known.weight;
  return DEFAULT_LEAGUE_WEIGHT;
}

// Check if a line is preferred for max win rate mode (static fallback)
export function isPreferredLine(market: string, line: number): boolean {
  const preferred = HIGH_WIN_RATE_LINES[market as ScorableMarket];
  if (!preferred) return false;
  return preferred.includes(line);
}

// Check if a line should be avoided in max win rate mode (static fallback)
export function shouldAvoidLine(market: string, line: number): boolean {
  const avoid = LOW_WIN_RATE_LINES[market as ScorableMarket];
  if (!avoid) return false;
  return avoid.includes(line);
}

// ============================================================================
// DYNAMIC WEIGHT LOOKUP (from performance_weights table)
// ============================================================================

export interface PerformanceWeight {
  market: string;
  side: string;
  line: number;
  league_id: number | null;
  sample_size: number;
  wins: number;
  losses: number;
  pushes: number;
  raw_win_rate: number;
  roi_pct: number;
  bayes_win_rate: number;
  weight: number;
  computed_at: string;
}

// Cache for performance weights (TTL: 1 hour)
let weightsCache: Map<string, PerformanceWeight> | null = null;
let weightsCacheTime: number = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getWeightKey(market: string, side: string, line: number, leagueId: number | null): string {
  return `${market}|${side}|${line}|${leagueId ?? "global"}`;
}

/**
 * Load performance weights from DB into cache
 */
export async function loadPerformanceWeights(supabase: SupabaseClient): Promise<void> {
  const now = Date.now();
  if (weightsCache && (now - weightsCacheTime) < CACHE_TTL_MS) {
    return; // Cache is still valid
  }

  const { data, error } = await supabase
    .from("performance_weights")
    .select("*");

  if (error) {
    console.error("[win_rate_config] Failed to load performance_weights:", error.message);
    return; // Keep using static fallbacks
  }

  weightsCache = new Map();
  for (const row of data ?? []) {
    const key = getWeightKey(row.market, row.side, row.line, row.league_id);
    weightsCache.set(key, row as PerformanceWeight);
  }
  weightsCacheTime = now;
  console.log(`[win_rate_config] Loaded ${weightsCache.size} performance weights from DB`);
}

/**
 * Get dynamic weight for a specific market/side/line/league combination.
 * Returns the weight from performance_weights if available, otherwise uses static fallback.
 */
export function getDynamicWeight(
  market: string,
  side: string,
  line: number,
  leagueId: number | null
): number {
  if (!weightsCache) {
    // Cache not loaded, use static league weight as fallback
    return leagueId ? getLeagueWeight(leagueId) : 1.0;
  }

  // Try league-specific weight first
  if (leagueId !== null) {
    const leagueKey = getWeightKey(market, side, line, leagueId);
    const leagueWeight = weightsCache.get(leagueKey);
    if (leagueWeight && leagueWeight.sample_size >= 5) {
      return leagueWeight.weight;
    }
  }

  // Fall back to global weight for this market/side/line
  const globalKey = getWeightKey(market, side, line, null);
  const globalWeight = weightsCache.get(globalKey);
  if (globalWeight && globalWeight.sample_size >= 10) {
    return globalWeight.weight;
  }

  // Ultimate fallback: static league weight
  return leagueId ? getLeagueWeight(leagueId) : 1.0;
}

/**
 * Check if a line is high-performing based on dynamic weights.
 * A line is preferred if its Bayesian win rate > 0.6 (60%).
 */
export function isDynamicallyPreferred(
  market: string,
  side: string,
  line: number
): boolean {
  if (!weightsCache) {
    return isPreferredLine(market, line); // Static fallback
  }

  const key = getWeightKey(market, side, line, null);
  const weight = weightsCache.get(key);
  if (weight && weight.sample_size >= 10) {
    return weight.bayes_win_rate > 0.6;
  }
  return isPreferredLine(market, line);
}

/**
 * Check if a line should be avoided based on dynamic weights.
 * A line should be avoided if its Bayesian win rate < 0.4 (40%).
 */
export function shouldDynamicallyAvoid(
  market: string,
  side: string,
  line: number
): boolean {
  if (!weightsCache) {
    return shouldAvoidLine(market, line); // Static fallback
  }

  const key = getWeightKey(market, side, line, null);
  const weight = weightsCache.get(key);
  if (weight && weight.sample_size >= 10) {
    return weight.bayes_win_rate < 0.4;
  }
  return shouldAvoidLine(market, line);
}

/**
 * Get all cached weights (for debugging/logging)
 */
export function getCachedWeights(): Map<string, PerformanceWeight> | null {
  return weightsCache;
}
