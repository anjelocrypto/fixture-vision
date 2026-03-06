/**
 * GREEN ALLOWLIST — Single Source of Truth
 * 
 * Based on the verified 60-day audit (March 2026):
 * - Only data-qualified market×line combos with positive ROI
 * - Only leagues with proven positive ROI at ≥50 sample threshold
 * - Global odds cap at 2.30 (everything above is catastrophic)
 * 
 * Used by: generate-ticket, populate-safe-zone-picks, optimize-selections-refresh
 */

// ============================================================================
// LEAGUE ALLOWLIST (positive ROI, ≥50 samples)
// ============================================================================
export const ALLOWED_LEAGUE_IDS: number[] = [
  45,  // FA Cup         — 72.64% hit, +24.16% ROI (106 samples)
  40,  // Championship   — 68.00% hit, +0.42% ROI  (125 samples)
  39,  // Premier League — 61.98% hit, +0.28% ROI  (192 samples)
];

// ============================================================================
// MARKET×LINE ALLOWLIST (positive ROI, ≥30 samples)
// ============================================================================
export interface AllowedMarketLine {
  market: string;
  side: "over";
  line: number;
  odds_min: number;
  odds_max: number;
}

export const ALLOWED_MARKET_LINES: AllowedMarketLine[] = [
  { market: "goals",   side: "over", line: 1.5, odds_min: 1.30, odds_max: 1.60 },
  { market: "corners", side: "over", line: 9.5, odds_min: 1.40, odds_max: 2.30 },
];

// ============================================================================
// GLOBAL CONSTRAINTS
// ============================================================================
export const GLOBAL_ODDS_CAP = 2.30;
export const BANNED_MARKETS: string[] = ["cards"];

// Max legs per ticket (audit: 8+ legs = 0% win rate)
export const MAX_TICKET_LEGS = 2;
export const DEFAULT_TICKET_LEGS = 1;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Normalize line to nearest 0.5 */
export function normalizeLine(line: number): number {
  return Math.round(line * 2) / 2;
}

/** Check if a candidate passes the green allowlist */
export function isAllowlisted(candidate: {
  league_id: number;
  market: string;
  side: string;
  line: number;
  odds: number | null;
}): { allowed: boolean; reason?: string } {
  // 1. League check
  if (!ALLOWED_LEAGUE_IDS.includes(candidate.league_id)) {
    return { allowed: false, reason: `league_id=${candidate.league_id} not in allowlist` };
  }

  // 2. Banned market check
  if (BANNED_MARKETS.includes(candidate.market)) {
    return { allowed: false, reason: `market=${candidate.market} is banned` };
  }

  // 3. Odds must exist
  if (candidate.odds == null) {
    return { allowed: false, reason: "odds is null" };
  }

  // 4. Global odds cap
  if (candidate.odds > GLOBAL_ODDS_CAP) {
    return { allowed: false, reason: `odds=${candidate.odds} > cap=${GLOBAL_ODDS_CAP}` };
  }

  // 5. Market×line×odds band check
  const lineNorm = normalizeLine(candidate.line);
  const match = ALLOWED_MARKET_LINES.find(
    (ml) =>
      ml.market === candidate.market &&
      ml.side === candidate.side &&
      normalizeLine(ml.line) === lineNorm
  );

  if (!match) {
    return {
      allowed: false,
      reason: `${candidate.market}/${candidate.side}/${lineNorm} not in allowed combos`,
    };
  }

  // 6. Market-specific odds band
  if (candidate.odds < match.odds_min || candidate.odds > match.odds_max) {
    return {
      allowed: false,
      reason: `odds=${candidate.odds} outside [${match.odds_min}, ${match.odds_max}] for ${candidate.market}/${lineNorm}`,
    };
  }

  return { allowed: true };
}

/** Filter an array of candidates through the allowlist, returning passed + violations */
export function filterByAllowlist<T extends { league_id: number; market: string; side: string; line: number; odds: number | null }>(
  candidates: T[]
): { passed: T[]; violations: Array<{ candidate: T; reason: string }> } {
  const passed: T[] = [];
  const violations: Array<{ candidate: T; reason: string }> = [];

  for (const c of candidates) {
    const result = isAllowlisted(c);
    if (result.allowed) {
      passed.push(c);
    } else {
      violations.push({ candidate: c, reason: result.reason! });
    }
  }

  return { passed, violations };
}
