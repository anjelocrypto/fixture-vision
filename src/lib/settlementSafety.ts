/**
 * Frontend-facing settlement-safety presentation helpers.
 *
 * The hold decision itself is made and enforced in the database
 * (public.evaluate_leg_hold). The client only renders a safe, non-technical
 * explanation. Never surface alert internals, provider names or credentials.
 */

export const SETTLEMENT_POLICY_VERSION = "reschedule-integrity-v1";

export type SettlementHoldReason = "kickoff_drift" | "team_direction_mismatch";

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
    fallbackReason: "Fixture schedule changed",
  },
  team_direction_mismatch: {
    titleKey: "settlement.hold.title",
    reasonKey: "settlement.hold.reason.fixtureDetailsChanged",
    fallbackTitle: "Settlement under review",
    fallbackReason: "Fixture details changed",
  },
  default: {
    titleKey: "settlement.hold.title",
    reasonKey: "settlement.hold.reason.generic",
    fallbackTitle: "Settlement under review",
    fallbackReason: "Fixture schedule changed",
  },
};

export function settlementHoldCopy(reason: string | null | undefined) {
  if (reason === "kickoff_drift" || reason === "team_direction_mismatch") {
    return SETTLEMENT_HOLD_COPY[reason];
  }
  return SETTLEMENT_HOLD_COPY.default;
}
