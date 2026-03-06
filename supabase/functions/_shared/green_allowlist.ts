/**
 * GREEN ALLOWLIST — Data-Driven from green_buckets table
 * 
 * The green_buckets table is the SINGLE SOURCE OF TRUTH for allowed selections.
 * Static constants below are FALLBACK only (used if green_buckets can't be loaded).
 * 
 * Used by: generate-ticket, populate-safe-zone-picks, optimize-selections-refresh
 */

// ============================================================================
// FALLBACK CONSTANTS (used only when green_buckets table unavailable)
// ============================================================================
export const ALLOWED_LEAGUE_IDS: number[] = [
  45,  // FA Cup
  40,  // Championship
  39,  // Premier League
];

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
export const MAX_TICKET_LEGS = 3;
export const DEFAULT_TICKET_LEGS = 1;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Normalize line to nearest 0.5 */
export function normalizeLine(line: number): number {
  return Math.round(line * 2) / 2;
}

/** Compute odds band label (must match rebuild-green-buckets) */
export function computeOddsBand(odds: number): string {
  if (odds < 1.20) return "<1.20";
  if (odds < 1.30) return "1.20-1.30";
  if (odds < 1.40) return "1.30-1.40";
  if (odds < 1.50) return "1.40-1.50";
  if (odds < 1.60) return "1.50-1.60";
  if (odds < 1.70) return "1.60-1.70";
  if (odds < 1.80) return "1.70-1.80";
  if (odds < 1.90) return "1.80-1.90";
  if (odds < 2.00) return "1.90-2.00";
  if (odds < 2.10) return "2.00-2.10";
  if (odds < 2.20) return "2.10-2.20";
  if (odds < 2.30) return "2.20-2.30";
  return "2.30+";
}

// ============================================================================
// GREEN BUCKETS RUNTIME CONTEXT
// ============================================================================

export interface GreenBucket {
  league_id: number;
  market: string;
  side: string;
  line_norm: number;
  odds_band: string;
  hit_rate_pct: number;
  sample_size: number;
  roi_pct: number;
}

export interface GreenBucketsContext {
  bucketSet: Set<string>;
  bucketMap: Map<string, { hit_rate_pct: number; sample_size: number; roi_pct: number }>;
  leagueIds: number[];
  markets: string[];
  sides: string[];
}

/** Build a runtime context from green_buckets rows */
export function buildGreenBucketsContext(rows: GreenBucket[]): GreenBucketsContext {
  const bucketSet = new Set<string>();
  const bucketMap = new Map<string, { hit_rate_pct: number; sample_size: number; roi_pct: number }>();
  const leagueSet = new Set<number>();
  const marketSet = new Set<string>();
  const sideSet = new Set<string>();

  for (const b of rows) {
    const key = `${b.league_id}|${b.market}|${b.side}|${b.line_norm}|${b.odds_band}`;
    bucketSet.add(key);
    bucketMap.set(key, { hit_rate_pct: b.hit_rate_pct, sample_size: b.sample_size, roi_pct: b.roi_pct });
    leagueSet.add(b.league_id);
    marketSet.add(b.market);
    sideSet.add(b.side);
  }

  return {
    bucketSet,
    bucketMap,
    leagueIds: [...leagueSet],
    markets: [...marketSet],
    sides: [...sideSet],
  };
}

/** Make a bucket key from candidate fields */
export function makeBucketKey(leagueId: number, market: string, side: string, line: number, odds: number): string {
  return `${leagueId}|${market}|${side}|${normalizeLine(line)}|${computeOddsBand(odds)}`;
}

/** Check if a candidate passes the green_buckets filter */
export function isInGreenBucket(
  ctx: GreenBucketsContext,
  candidate: { league_id: number; market: string; side: string; line: number; odds: number | null }
): { allowed: boolean; reason?: string; bucketKey?: string } {
  if (candidate.odds == null) return { allowed: false, reason: "odds is null" };
  if (candidate.odds > GLOBAL_ODDS_CAP) return { allowed: false, reason: `odds=${candidate.odds} > cap=${GLOBAL_ODDS_CAP}` };
  if (BANNED_MARKETS.includes(candidate.market)) return { allowed: false, reason: `market=${candidate.market} is banned` };

  const key = makeBucketKey(candidate.league_id, candidate.market, candidate.side, candidate.line, candidate.odds);
  if (!ctx.bucketSet.has(key)) {
    return { allowed: false, reason: `no green bucket for ${key}` };
  }
  return { allowed: true, bucketKey: key };
}

// ============================================================================
// LEGACY: Static allowlist check (kept for backward compat, not primary)
// ============================================================================

/** Check if a candidate passes the static allowlist (LEGACY - prefer isInGreenBucket) */
export function isAllowlisted(candidate: {
  league_id: number;
  market: string;
  side: string;
  line: number;
  odds: number | null;
}): { allowed: boolean; reason?: string } {
  if (!ALLOWED_LEAGUE_IDS.includes(candidate.league_id)) {
    return { allowed: false, reason: `league_id=${candidate.league_id} not in allowlist` };
  }
  if (BANNED_MARKETS.includes(candidate.market)) {
    return { allowed: false, reason: `market=${candidate.market} is banned` };
  }
  if (candidate.odds == null) {
    return { allowed: false, reason: "odds is null" };
  }
  if (candidate.odds > GLOBAL_ODDS_CAP) {
    return { allowed: false, reason: `odds=${candidate.odds} > cap=${GLOBAL_ODDS_CAP}` };
  }
  const lineNorm = normalizeLine(candidate.line);
  const match = ALLOWED_MARKET_LINES.find(
    (ml) => ml.market === candidate.market && ml.side === candidate.side && normalizeLine(ml.line) === lineNorm
  );
  if (!match) {
    return { allowed: false, reason: `${candidate.market}/${candidate.side}/${lineNorm} not in allowed combos` };
  }
  if (candidate.odds < match.odds_min || candidate.odds > match.odds_max) {
    return { allowed: false, reason: `odds=${candidate.odds} outside [${match.odds_min}, ${match.odds_max}]` };
  }
  return { allowed: true };
}

/** Filter an array of candidates through the allowlist */
export function filterByAllowlist<T extends { league_id: number; market: string; side: string; line: number; odds: number | null }>(
  candidates: T[]
): { passed: T[]; violations: Array<{ candidate: T; reason: string }> } {
  const passed: T[] = [];
  const violations: Array<{ candidate: T; reason: string }> = [];
  for (const c of candidates) {
    const result = isAllowlisted(c);
    if (result.allowed) passed.push(c);
    else violations.push({ candidate: c, reason: result.reason! });
  }
  return { passed, violations };
}

/** Filter an array using green_buckets context */
export function filterByGreenBuckets<T extends { league_id: number; market: string; side: string; line: number; odds: number | null }>(
  ctx: GreenBucketsContext,
  candidates: T[]
): { passed: T[]; violations: Array<{ candidate: T; reason: string }> } {
  const passed: T[] = [];
  const violations: Array<{ candidate: T; reason: string }> = [];
  for (const c of candidates) {
    const result = isInGreenBucket(ctx, c);
    if (result.allowed) passed.push(c);
    else violations.push({ candidate: c, reason: result.reason! });
  }
  return { passed, violations };
}
