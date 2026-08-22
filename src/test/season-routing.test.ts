import { describe, expect, it } from "vitest";
import {
  getBasketballSeason,
  getBasketballSeasonDateRange,
} from "../../supabase/functions/_shared/basketball_season";
import { getFootballSeasonForLeague } from "../../supabase/functions/_shared/season";

describe("provider season routing", () => {
  it("uses the prior NBA season before the October rollover", () => {
    const august = new Date("2026-08-22T23:30:00.000Z");
    expect(getBasketballSeason("nba", 9, august)).toBe("2025");
    expect(getBasketballSeason("basketball", 9, august)).toBe("2025-2026");
  });

  it("moves NBA and European basketball to the new season in October", () => {
    const october = new Date("2026-10-01T00:00:00.000Z");
    expect(getBasketballSeason("nba", 9, october)).toBe("2026");
    expect(getBasketballSeason("basketball", 9, october)).toBe("2026-2027");
    expect(getBasketballSeasonDateRange(9, october)).toEqual({
      from: "2026-10-01",
      to: "2026-10-01",
    });
  });

  it("honors the G League November rollover independently", () => {
    expect(getBasketballSeason("nba", 10, new Date("2026-10-31T23:59:59.999Z"))).toBe("2025");
    expect(getBasketballSeason("nba", 10, new Date("2026-11-01T00:00:00.000Z"))).toBe("2026");
  });

  it("distinguishes cross-year football leagues from calendar-year leagues", () => {
    const august = new Date("2026-08-22T12:00:00.000Z");
    const may = new Date("2026-05-22T12:00:00.000Z");
    expect(getFootballSeasonForLeague(39, august)).toBe(2026);
    expect(getFootballSeasonForLeague(39, may)).toBe(2025);
    expect(getFootballSeasonForLeague(253, may)).toBe(2026);
  });
});
