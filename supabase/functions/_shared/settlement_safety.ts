/**
 * SETTLEMENT SAFETY (shared, pure)
 *
 * Mirrors public.evaluate_leg_hold / public.normalize_team_name in SQL.
 * The database is the enforcement point; this module exists so edge functions
 * and tests can reason about the same rules without a round-trip.
 *
 * Rules:
 * - |kickoff drift| <= 24h and identity matches  -> eligible
 * - |kickoff drift|  > 24h                        -> hold: kickoff_drift
 * - home/away inverted or different match         -> hold: team_direction_mismatch
 * - cosmetic name differences (accents, FC/AFC/SC suffixes, punctuation) are equal
 */

export const SETTLEMENT_POLICY_VERSION = "reschedule-integrity-v1";

/** Maximum tolerated absolute kickoff drift, in seconds. */
export const MAX_KICKOFF_DRIFT_SECONDS = 86400;

export type SettlementHoldReason = "kickoff_drift" | "team_direction_mismatch";

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
    if (lh && la && fh && fa) {
      if (!(lh === fh && la === fa)) return "team_direction_mismatch";
    }
    // Neither IDs nor names available: identity cannot be disproved.
  }

  const drift = kickoffDriftSeconds(input);
  if (drift !== null && Math.abs(drift) > MAX_KICKOFF_DRIFT_SECONDS) {
    return "kickoff_drift";
  }

  return null;
}
