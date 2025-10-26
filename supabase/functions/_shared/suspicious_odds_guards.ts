/**
 * Suspicious odds guards - reject obviously wrong odds that indicate bookmaker data errors
 * These thresholds are configurable and conservative (err on keeping borderline cases)
 */

import { ODDS_MIN, ODDS_MAX } from "./config.ts";

export type Market = "goals" | "corners" | "cards" | "fouls" | "offsides";

interface GuardConfig {
  market: Market;
  line: number;
  maxOdds: number;
  description: string;
}

// Guard thresholds (can be tuned based on historical odds analysis)
const GUARDS: GuardConfig[] = [
  // Goals
  { market: "goals", line: 1.5, maxOdds: 3.8, description: "Goals O1.5 rarely exceeds 3.8" },
  { market: "goals", line: 2.5, maxOdds: 5.0, description: "Goals O2.5 rarely exceeds 5.0" },
  
  // Corners (mainlines 8.5-12.5)
  { market: "corners", line: 8.5, maxOdds: 6.0, description: "Corners O8.5 rarely exceeds 6.0" },
  { market: "corners", line: 9.5, maxOdds: 6.0, description: "Corners O9.5 rarely exceeds 6.0" },
  { market: "corners", line: 10.5, maxOdds: 6.0, description: "Corners O10.5 rarely exceeds 6.0" },
  { market: "corners", line: 11.5, maxOdds: 6.0, description: "Corners O11.5 rarely exceeds 6.0" },
  { market: "corners", line: 12.5, maxOdds: 6.0, description: "Corners O12.5 rarely exceeds 6.0" },
  
  // Cards
  { market: "cards", line: 2.5, maxOdds: 4.5, description: "Cards O2.5 rarely exceeds 4.5" },
];

/**
 * Check if odds are suspicious for a given market/line combination
 * Returns null if okay, or a warning message if suspicious
 */
export function checkSuspiciousOdds(
  market: Market,
  line: number,
  odds: number
): string | null {
  // First check global odds band
  if (odds < ODDS_MIN) {
    return `Out of band: ${market} Over ${line} @ ${odds.toFixed(2)} below minimum ${ODDS_MIN}`;
  }
  if (odds > ODDS_MAX) {
    return `Out of band: ${market} Over ${line} @ ${odds.toFixed(2)} above maximum ${ODDS_MAX}`;
  }
  
  // Then check market-specific guards
  const guard = GUARDS.find(
    g => g.market === market && Math.abs(g.line - line) < 0.01
  );
  
  if (!guard) return null; // No guard for this market/line
  
  if (odds >= guard.maxOdds) {
    return `Suspicious odds: ${market} Over ${line} @ ${odds.toFixed(2)} exceeds threshold ${guard.maxOdds} (${guard.description})`;
  }
  
  return null;
}

/**
 * Filter an array of selections, logging and removing suspicious odds
 */
export function filterSuspiciousOdds<T extends { market: string; line: number; odds: number }>(
  selections: T[],
  logPrefix = "[suspicious-odds]"
): T[] {
  return selections.filter(sel => {
    const warning = checkSuspiciousOdds(sel.market as Market, sel.line, sel.odds);
    if (warning) {
      console.warn(`${logPrefix} ${warning} - DROPPED`);
      return false;
    }
    return true;
  });
}
