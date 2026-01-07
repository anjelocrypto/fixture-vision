/**
 * WIN RATE OPTIMIZATION CONFIG
 * 
 * Based on historical ticket outcome analysis (Jan 2026):
 * - Only goals/corners/cards with side=over and known line are scorable
 * - Historical win rates derived from 297 scorable legs with fixture_results
 * 
 * HIGH-PERFORMING LINES (>70% historical win rate):
 * - Goals Over 1.5: 86.1% (31/36 wins)
 * - Cards Over 3.5: 91.7% (11/12 wins)
 * 
 * POOR-PERFORMING LINES (<35% historical win rate):
 * - Goals Over 2.5: 28.6% (6/21 wins)
 * - Cards Over 4.5: 25.0% (5/20 wins)
 * 
 * SCORABLE MARKETS:
 * Only these combinations can be verified against fixture_results:
 * - goals + over + line (total_goals > line)
 * - corners + over + line (total_corners > line)  
 * - cards + over + line (total_cards > line)
 */

// Markets that can be scored against fixture_results
export const SCORABLE_MARKETS = ["goals", "corners", "cards"] as const;
export type ScorableMarket = typeof SCORABLE_MARKETS[number];

// Only "over" side is currently scorable
export const SCORABLE_SIDES = ["over"] as const;

// High-probability lines based on historical data (>70% win rate with n≥10)
export const HIGH_WIN_RATE_LINES: Record<ScorableMarket, number[]> = {
  goals: [1.5],      // 86.1% win rate
  corners: [8.5],    // Limited data but corners overs tend to hit
  cards: [2.5, 3.5], // Cards Over 2.5-3.5 perform well
};

// Lines to AVOID in max win rate mode (historically <35% win rate)
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

// League performance weights (based on scorable leg analysis)
// Only leagues with ≥3 scorable legs are weighted
export const LEAGUE_WEIGHTS: Record<number, { weight: number; name: string }> = {
  // HIGH PERFORMERS (>70% win rate)
  40: { weight: 1.3, name: "Championship" },       // 78.9%
  39: { weight: 1.2, name: "Premier League" },     // 77.8%
  3: { weight: 1.1, name: "UEFA Europa League" }, // 75.0%
  848: { weight: 1.1, name: "UEFA Conference" },  // 71.4%
  
  // AVERAGE PERFORMERS (50-70%)
  2: { weight: 1.0, name: "UEFA Champions League" }, // 61.5%
  135: { weight: 1.0, name: "Serie A" },             // 60.0%
  88: { weight: 0.95, name: "Eredivisie" },          // 66.7%
  
  // LOW PERFORMERS (<50% win rate - penalize)
  140: { weight: 0.7, name: "La Liga" },        // 37.5%
  61: { weight: 0.5, name: "Ligue 1" },         // 12.5%
  307: { weight: 0.3, name: "Pro League Saudi" }, // 0%
};

// Default weight for leagues not in the list
export const DEFAULT_LEAGUE_WEIGHT = 0.9;

// Ticket mode configurations
export interface TicketModeConfig {
  name: string;
  description: string;
  // Constraints
  minLegs: number;
  maxLegs: number;
  minOdds: number;
  maxOdds: number;
  // Market restrictions
  allowedMarkets: string[];
  allowedSides: string[];
  preferredLines: Record<string, number[]> | null;
  avoidLines: Record<string, number[]> | null;
  // Scoring adjustments
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

// Get league weight with Bayesian shrinkage
export function getLeagueWeight(leagueId: number): number {
  const known = LEAGUE_WEIGHTS[leagueId];
  if (known) return known.weight;
  return DEFAULT_LEAGUE_WEIGHT;
}

// Check if a line is preferred for max win rate mode
export function isPreferredLine(market: string, line: number): boolean {
  const preferred = HIGH_WIN_RATE_LINES[market as ScorableMarket];
  if (!preferred) return false;
  return preferred.includes(line);
}

// Check if a line should be avoided in max win rate mode
export function shouldAvoidLine(market: string, line: number): boolean {
  const avoid = LOW_WIN_RATE_LINES[market as ScorableMarket];
  if (!avoid) return false;
  return avoid.includes(line);
}
