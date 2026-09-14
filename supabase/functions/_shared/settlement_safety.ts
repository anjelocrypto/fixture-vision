/**
 * SETTLEMENT SAFETY (shared, pure) — canonical policy V3.
 *
 * Exact mirror of public.evaluate_leg_hold_v3 / public.normalize_team_name.
 * The database is the enforcement point; this module exists so edge functions
 * and tests can reason about the same rules without a round-trip.
 *
 * Rules (evaluated in this order, fail CLOSED):
 * - provider team IDs on both sides: must match directionally, else
 *   `team_direction_mismatch`
 * - otherwise fall back to normalized names; if any of the four names is
 *   missing, identity cannot be verified -> `identity_unverifiable`
 * - missing leg or fixture kickoff -> `kickoff_unverifiable`
 * - |kickoff drift| > 24h -> `kickoff_drift`
 * - otherwise eligible (null)
 */

export const SETTLEMENT_POLICY_VERSION = "reschedule-integrity-v3";

/** Maximum tolerated absolute kickoff drift, in seconds. */
export const MAX_KICKOFF_DRIFT_SECONDS = 86400;

export type SettlementHoldReason =
  | "kickoff_drift"
  | "team_direction_mismatch"
  | "identity_unverifiable"
  | "kickoff_unverifiable"
  | "manual_review_non_terminal";

/** Every reason the database constraint accepts. */
export const SETTLEMENT_HOLD_REASONS: readonly SettlementHoldReason[] = [
  "kickoff_drift",
  "team_direction_mismatch",
  "identity_unverifiable",
  "kickoff_unverifiable",
  "manual_review_non_terminal",
];

const ACCENTS = "àáâãäåāăąèéêëēĕėęěìíîïĩīĭįıòóôõöøōŏőùúûüũūŭůűųçćĉċčñńņňýÿŷšśşžźżđğłß";
const PLAIN = "aaaaaaaaaeeeeeeeeeiiiiiiiiiooooooooouuuuuuuuuucccccnnnnyyyssszzzdgls";

const SUFFIX_TOKENS =
  /\b(fc|afc|sc|cf|ac|ss|ssc|cd|ud|sv|fk|nk|bk|if|tc|club|city|calcio|futbol|football)\b/g;

export function normalizeTeamName(name: string | null | undefined): string | null {
  if (!name) return null;
  const lowered = name.toLowerCase();
  let translated = "";
  for (const ch of lowered) {
    const idx = ACCENTS.indexOf(ch);
    translated += idx >= 0 ? PLAIN[idx] : ch;
  }
  const stripped = translated.replace(SUFFIX_TOKENS, " ").replace(/[^a-z0-9]/g, "");
  return stripped.length > 0 ? stripped : null;
}

export interface LegHoldInput {
  legKickoff: string | Date | null;
  fixtureKickoff: string | Date | null;
  legHomeTeamId?: number | null;
  legAwayTeamId?: number | null;
  fixtureHomeTeamId?: number | null;
  fixtureAwayTeamId?: number | null;
  legHomeTeamName?: string | null;
  legAwayTeamName?: string | null;
  fixtureHomeTeamName?: string | null;
  fixtureAwayTeamName?: string | null;
}

function toMs(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function kickoffDriftSeconds(input: LegHoldInput): number | null {
  const legMs = toMs(input.legKickoff);
  const fixtureMs = toMs(input.fixtureKickoff);
  if (legMs === null || fixtureMs === null) return null;
  return Math.round((fixtureMs - legMs) / 1000);
}

/** Returns null when the leg is safe to settle, otherwise the hold reason. */
export function evaluateLegHold(input: LegHoldInput): SettlementHoldReason | null {
  const {
    legHomeTeamId,
    legAwayTeamId,
    fixtureHomeTeamId,
    fixtureAwayTeamId,
  } = input;

  const haveIds =
    legHomeTeamId != null && legAwayTeamId != null &&
    fixtureHomeTeamId != null && fixtureAwayTeamId != null;

  if (haveIds) {
    if (!(legHomeTeamId === fixtureHomeTeamId && legAwayTeamId === fixtureAwayTeamId)) {
      return "team_direction_mismatch";
    }
  } else {
    const lh = normalizeTeamName(input.legHomeTeamName);
    const la = normalizeTeamName(input.legAwayTeamName);
    const fh = normalizeTeamName(input.fixtureHomeTeamName);
    const fa = normalizeTeamName(input.fixtureAwayTeamName);
    // Fail closed: without four comparable names identity is unverifiable.
    if (!lh || !la || !fh || !fa) return "identity_unverifiable";
    if (!(lh === fh && la === fa)) return "team_direction_mismatch";
  }

  const drift = kickoffDriftSeconds(input);
  // Fail closed: a missing kickoff on either side cannot be verified.
  if (drift === null) return "kickoff_unverifiable";
  if (Math.abs(drift) > MAX_KICKOFF_DRIFT_SECONDS) return "kickoff_drift";

  return null;
}
