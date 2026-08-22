import { describe, it, expect } from "vitest";
import {
  evaluateLegHold,
  kickoffDriftSeconds,
  normalizeTeamName,
  MAX_KICKOFF_DRIFT_SECONDS,
  SETTLEMENT_POLICY_VERSION,
} from "../../supabase/functions/_shared/settlement_safety";
import {
  settlementHoldCopy,
  isSettlementHeld,
  SETTLEMENT_POLICY_VERSION as FRONTEND_POLICY_VERSION,
} from "@/lib/settlementSafety";

const BASE = "2026-02-10T19:45:00Z";
const iso = (base: string, offsetSeconds: number) =>
  new Date(new Date(base).getTime() + offsetSeconds * 1000).toISOString();

const identity = {
  legHomeTeamId: 7612,
  legAwayTeamId: 8657,
  fixtureHomeTeamId: 7612,
  fixtureAwayTeamId: 8657,
};

describe("kickoff drift eligibility", () => {
  it("treats an exact match as eligible", () => {
    expect(evaluateLegHold({ legKickoff: BASE, fixtureKickoff: BASE, ...identity })).toBeNull();
  });

  it("keeps 23h59m drift eligible", () => {
    const drifted = iso(BASE, 23 * 3600 + 59 * 60);
    expect(kickoffDriftSeconds({ legKickoff: BASE, fixtureKickoff: drifted })).toBe(86340);
    expect(evaluateLegHold({ legKickoff: BASE, fixtureKickoff: drifted, ...identity })).toBeNull();
  });

  it("keeps exactly 24h eligible and holds beyond it", () => {
    expect(
      evaluateLegHold({ legKickoff: BASE, fixtureKickoff: iso(BASE, MAX_KICKOFF_DRIFT_SECONDS), ...identity }),
    ).toBeNull();
    expect(
      evaluateLegHold({ legKickoff: BASE, fixtureKickoff: iso(BASE, MAX_KICKOFF_DRIFT_SECONDS + 1), ...identity }),
    ).toBe("kickoff_drift");
  });

  it("holds the real 1401863 reschedule (Feb 10 -> Apr 14)", () => {
    expect(
      evaluateLegHold({
        legKickoff: "2026-02-10T19:45:00Z",
        fixtureKickoff: "2026-04-14T18:45:00Z",
        ...identity,
      }),
    ).toBe("kickoff_drift");
  });

  it("holds drift in either direction", () => {
    expect(
      evaluateLegHold({ legKickoff: BASE, fixtureKickoff: iso(BASE, -5 * 86400), ...identity }),
    ).toBe("kickoff_drift");
  });

  it("does not hold when a kickoff is unknown", () => {
    expect(evaluateLegHold({ legKickoff: null, fixtureKickoff: BASE, ...identity })).toBeNull();
    expect(kickoffDriftSeconds({ legKickoff: null, fixtureKickoff: BASE })).toBeNull();
  });
});

describe("directional identity", () => {
  it("holds an inverted home/away pairing regardless of kickoff", () => {
    expect(
      evaluateLegHold({
        legKickoff: BASE,
        fixtureKickoff: BASE,
        legHomeTeamId: 8657,
        legAwayTeamId: 7612,
        fixtureHomeTeamId: 7612,
        fixtureAwayTeamId: 8657,
      }),
    ).toBe("team_direction_mismatch");
  });

  it("prioritises direction mismatch over drift", () => {
    expect(
      evaluateLegHold({
        legKickoff: BASE,
        fixtureKickoff: iso(BASE, 30 * 86400),
        legHomeTeamId: 8657,
        legAwayTeamId: 7612,
        fixtureHomeTeamId: 7612,
        fixtureAwayTeamId: 8657,
      }),
    ).toBe("team_direction_mismatch");
  });

  it("holds a completely different pairing", () => {
    expect(
      evaluateLegHold({
        legKickoff: BASE,
        fixtureKickoff: BASE,
        legHomeTeamId: 1,
        legAwayTeamId: 2,
        fixtureHomeTeamId: 3,
        fixtureAwayTeamId: 4,
      }),
    ).toBe("team_direction_mismatch");
  });

  it("mirrors the 1524397 inversion case by name fallback", () => {
    expect(
      evaluateLegHold({
        legKickoff: "2026-03-02T18:15:00Z",
        fixtureKickoff: "2026-04-13T14:45:00Z",
        legHomeTeamName: "Al-Duhail SC",
        legAwayTeamName: "Al-Ahli Jeddah",
        fixtureHomeTeamName: "Al-Ahli Jeddah",
        fixtureAwayTeamName: "Al-Duhail SC",
      }),
    ).toBe("team_direction_mismatch");
  });
});

describe("cosmetic name equivalence", () => {
  const cases: Array<[string, string]> = [
    ["Fenerbahce", "Fenerbahçe"],
    ["Ferencvarosi TC", "Ferencvarosi"],
    ["Bath City", "Bath City FC"],
    ["AFC Totton", "Totton"],
    ["Weston-super-Mare", "Weston super Mare"],
    ["Bayern Munchen", "Bayern München"],
  ];

  it.each(cases)("treats %s and %s as the same club", (a, b) => {
    expect(normalizeTeamName(a)).toBe(normalizeTeamName(b));
  });

  it("does not raise a false hold on cosmetic differences", () => {
    expect(
      evaluateLegHold({
        legKickoff: BASE,
        fixtureKickoff: BASE,
        legHomeTeamName: "Fenerbahce",
        legAwayTeamName: "Ferencvarosi TC",
        fixtureHomeTeamName: "Fenerbahçe",
        fixtureAwayTeamName: "Ferencvarosi",
      }),
    ).toBeNull();
  });

  it("still distinguishes genuinely different clubs", () => {
    expect(normalizeTeamName("Bath City")).not.toBe(normalizeTeamName("Bristol Rovers"));
  });

  it("returns null for empty input", () => {
    expect(normalizeTeamName(null)).toBeNull();
    expect(normalizeTeamName("  ")).toBeNull();
  });
});

describe("policy version and presentation", () => {
  it("keeps backend and frontend policy versions aligned", () => {
    expect(SETTLEMENT_POLICY_VERSION).toBe(FRONTEND_POLICY_VERSION);
    expect(SETTLEMENT_POLICY_VERSION).toBe("reschedule-integrity-v1");
  });

  it("flags held legs without inventing a new status", () => {
    expect(isSettlementHeld({ result_status: "PENDING", settlement_hold_reason: "kickoff_drift" })).toBe(true);
    expect(isSettlementHeld({ result_status: "PENDING", settlement_hold_reason: null })).toBe(false);
  });

  it("renders a safe, non-technical reason", () => {
    const copy = settlementHoldCopy("kickoff_drift");
    expect(copy.fallbackTitle).toBe("Settlement under review");
    expect(copy.fallbackReason).toBe("Fixture schedule changed");
    expect(JSON.stringify(copy)).not.toMatch(/api-football|cron|service_role|key/i);
  });
});
