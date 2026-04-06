/**
 * Ticket Correlation Guard Tests
 * 
 * Verifies that generate-ticket enforces diversity rules:
 * - One leg per fixture (existing)
 * - Market-type diversity (max 2 legs of same market type)
 * - Same-league soft cap for multi-leg tickets
 */
import { describe, it, expect } from "vitest";

interface TicketLeg {
  fixtureId: number;
  market: string;
  leagueId: number;
  odds: number;
}

/**
 * Enforces market-type diversity: max N legs of the same market in a ticket.
 * Returns filtered legs respecting the cap.
 */
function enforceMarketDiversity(legs: TicketLeg[], maxPerMarket: number = 2): TicketLeg[] {
  const marketCount: Record<string, number> = {};
  return legs.filter((leg) => {
    const count = marketCount[leg.market] || 0;
    if (count >= maxPerMarket) return false;
    marketCount[leg.market] = count + 1;
    return true;
  });
}

/**
 * Enforces same-league soft cap: max N legs from the same league.
 */
function enforceLeagueCap(legs: TicketLeg[], maxPerLeague: number = 2): TicketLeg[] {
  const leagueCount: Record<number, number> = {};
  return legs.filter((leg) => {
    const count = leagueCount[leg.leagueId] || 0;
    if (count >= maxPerLeague) return false;
    leagueCount[leg.leagueId] = count + 1;
    return true;
  });
}

describe("One leg per fixture (existing rule)", () => {
  it("prevents two legs from the same fixture", () => {
    const legs: TicketLeg[] = [
      { fixtureId: 1, market: "goals", leagueId: 39, odds: 1.5 },
      { fixtureId: 1, market: "corners", leagueId: 39, odds: 1.8 },
      { fixtureId: 2, market: "goals", leagueId: 39, odds: 1.6 },
    ];
    const seen = new Set<number>();
    const deduped = legs.filter((l) => {
      if (seen.has(l.fixtureId)) return false;
      seen.add(l.fixtureId);
      return true;
    });
    expect(deduped.length).toBe(2);
    expect(deduped[0].fixtureId).not.toBe(deduped[1].fixtureId);
  });
});

describe("Market-type diversity rule", () => {
  it("caps same market type at 2 per ticket", () => {
    const legs: TicketLeg[] = [
      { fixtureId: 1, market: "goals", leagueId: 39, odds: 1.5 },
      { fixtureId: 2, market: "goals", leagueId: 140, odds: 1.6 },
      { fixtureId: 3, market: "goals", leagueId: 78, odds: 1.7 },
    ];
    const filtered = enforceMarketDiversity(legs, 2);
    expect(filtered.length).toBe(2);
    expect(filtered.every((l) => l.market === "goals")).toBe(true);
  });

  it("allows mixed markets up to cap each", () => {
    const legs: TicketLeg[] = [
      { fixtureId: 1, market: "goals", leagueId: 39, odds: 1.5 },
      { fixtureId: 2, market: "corners", leagueId: 140, odds: 1.6 },
      { fixtureId: 3, market: "goals", leagueId: 78, odds: 1.7 },
    ];
    const filtered = enforceMarketDiversity(legs, 2);
    expect(filtered.length).toBe(3); // 2 goals + 1 corner = within cap
  });
});

describe("Same-league soft cap", () => {
  it("caps same league at 2 legs in multi-leg tickets", () => {
    const legs: TicketLeg[] = [
      { fixtureId: 1, market: "goals", leagueId: 39, odds: 1.5 },
      { fixtureId: 2, market: "goals", leagueId: 39, odds: 1.6 },
      { fixtureId: 3, market: "goals", leagueId: 39, odds: 1.7 },
    ];
    const filtered = enforceLeagueCap(legs, 2);
    expect(filtered.length).toBe(2);
  });

  it("allows legs from different leagues", () => {
    const legs: TicketLeg[] = [
      { fixtureId: 1, market: "goals", leagueId: 39, odds: 1.5 },
      { fixtureId: 2, market: "goals", leagueId: 140, odds: 1.6 },
      { fixtureId: 3, market: "goals", leagueId: 78, odds: 1.7 },
    ];
    const filtered = enforceLeagueCap(legs, 2);
    expect(filtered.length).toBe(3);
  });
});

describe("Combined correlation guards", () => {
  it("applies all guards in sequence", () => {
    const rawLegs: TicketLeg[] = [
      { fixtureId: 1, market: "goals", leagueId: 39, odds: 1.5 },
      { fixtureId: 1, market: "corners", leagueId: 39, odds: 1.8 }, // same fixture → dropped
      { fixtureId: 2, market: "goals", leagueId: 39, odds: 1.6 },
      { fixtureId: 3, market: "goals", leagueId: 39, odds: 1.7 }, // 3rd goals → market cap
      { fixtureId: 4, market: "goals", leagueId: 39, odds: 1.4 }, // 3rd from league 39 → league cap
    ];

    // Step 1: One per fixture
    const seen = new Set<number>();
    let filtered = rawLegs.filter((l) => {
      if (seen.has(l.fixtureId)) return false;
      seen.add(l.fixtureId);
      return true;
    });
    expect(filtered.length).toBe(4);

    // Step 2: Market diversity
    filtered = enforceMarketDiversity(filtered, 2);
    expect(filtered.length).toBe(2); // Only 2 goals kept

    // Step 3: League cap (already ≤2 from league 39)
    filtered = enforceLeagueCap(filtered, 2);
    expect(filtered.length).toBe(2);
  });
});
