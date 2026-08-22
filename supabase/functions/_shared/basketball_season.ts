export type BasketballProvider = "nba" | "basketball";

export function getBasketballSeasonStartYear(
  seasonStartMonth: number,
  at: Date = new Date(),
): number {
  const month = Math.min(Math.max(Math.trunc(seasonStartMonth), 0), 11);
  return at.getUTCMonth() >= month ? at.getUTCFullYear() : at.getUTCFullYear() - 1;
}

export function getBasketballSeason(
  provider: BasketballProvider,
  seasonStartMonth: number,
  at: Date = new Date(),
): string {
  const startYear = getBasketballSeasonStartYear(seasonStartMonth, at);
  return provider === "nba" ? `${startYear}` : `${startYear}-${startYear + 1}`;
}

export function getBasketballSeasonDateRange(
  seasonStartMonth: number,
  at: Date = new Date(),
): { from: string; to: string } {
  const startYear = getBasketballSeasonStartYear(seasonStartMonth, at);
  return {
    from: new Date(Date.UTC(startYear, seasonStartMonth, 1)).toISOString().slice(0, 10),
    to: at.toISOString().slice(0, 10),
  };
}
