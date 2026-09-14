/**
 * Frontend-facing settlement-safety presentation helpers (policy V3).
 *
 * The hold decision itself is made and enforced in the database
 * (public.evaluate_leg_hold_v3). The client only renders a safe, non-technical
 * explanation. Never surface alert internals, provider names or credentials.
 */

export const SETTLEMENT_POLICY_VERSION = "reschedule-integrity-v3";

export type SettlementHoldReason =
  | "kickoff_drift"
  | "team_direction_mismatch"
  | "identity_unverifiable"
  | "kickoff_unverifiable"
  | "manual_review_non_terminal";

export const SETTLEMENT_HOLD_REASONS: readonly SettlementHoldReason[] = [
  "kickoff_drift",
  "team_direction_mismatch",
  "identity_unverifiable",
  "kickoff_unverifiable",
  "manual_review_non_terminal",
];

export interface HeldLegLike {
  result_status?: string | null;
  settlement_hold_reason?: string | null;
}

export function isSettlementHeld(leg: HeldLegLike | null | undefined): boolean {
  return Boolean(leg?.settlement_hold_reason);
}

/** i18n keys — safe, user-facing copy only. */
export const SETTLEMENT_HOLD_COPY: Record<SettlementHoldReason | "default", {
  titleKey: string;
  reasonKey: string;
  fallbackTitle: string;
  fallbackReason: string;
}> = {
  kickoff_drift: {
    titleKey: "settlement.hold.title",
    reasonKey: "settlement.hold.reason.scheduleChanged",
    fallbackTitle: "Settlement under review",
    fallbackReason: "Match was moved to a different date",
  },
  team_direction_mismatch: {
    titleKey: "settlement.hold.title",
    reasonKey: "settlement.hold.reason.fixtureDetailsChanged",
    fallbackTitle: "Settlement under review",
    fallbackReason: "Match details no longer match this selection",
  },
  identity_unverifiable: {
    titleKey: "settlement.hold.title",
    reasonKey: "settlement.hold.reason.identityUnverifiable",
    fallbackTitle: "Settlement under review",
    fallbackReason: "We are confirming which match this selection belongs to",
  },
  kickoff_unverifiable: {
    titleKey: "settlement.hold.title",
    reasonKey: "settlement.hold.reason.kickoffUnverifiable",
    fallbackTitle: "Settlement under review",
    fallbackReason: "We are confirming the match start time",
  },
  manual_review_non_terminal: {
    titleKey: "settlement.hold.title",
    reasonKey: "settlement.hold.reason.manualReview",
    fallbackTitle: "Settlement under review",
    fallbackReason: "Match ended in a way that needs a manual check",
  },
  default: {
    titleKey: "settlement.hold.title",
    reasonKey: "settlement.hold.reason.generic",
    fallbackTitle: "Settlement under review",
    fallbackReason: "We are checking this match before settling",
  },
};

export function settlementHoldCopy(reason: string | null | undefined) {
  if (reason && (SETTLEMENT_HOLD_REASONS as readonly string[]).includes(reason)) {
    return SETTLEMENT_HOLD_COPY[reason as SettlementHoldReason];
  }
  return SETTLEMENT_HOLD_COPY.default;
}
