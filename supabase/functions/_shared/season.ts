// Leagues whose API-Football season key follows the calendar year.
const CALENDAR_YEAR_FOOTBALL_LEAGUES = new Set([
  1, 4, 5, 9, 17, 29, 31, 32, 33, 34, 36, 71, 72, 98, 99, 103, 113,
  114, 128, 129, 165, 239, 242, 244, 250, 253, 254, 262, 263, 265, 274,
  292, 960, 964,
]);

export function getFootballSeasonForLeague(leagueId: number, at: Date = new Date()): number {
  const year = at.getUTCFullYear();
  if (CALENDAR_YEAR_FOOTBALL_LEAGUES.has(leagueId)) return year;
  return at.getUTCMonth() >= 6 ? year : year - 1;
}

export function getFootballSeasonStartForLeagueUtc(leagueId: number, at: Date = new Date()): string {
  const season = getFootballSeasonForLeague(leagueId, at);
  const month = CALENDAR_YEAR_FOOTBALL_LEAGUES.has(leagueId) ? 0 : 6;
  return new Date(Date.UTC(season, month, 1)).toISOString();
}

export function getCrossYearSeasonLabel(at: Date = new Date()): string {
  const startYear = at.getUTCMonth() >= 6 ? at.getUTCFullYear() : at.getUTCFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
}

export function getFootballSeasonStartUtc(at: Date = new Date()): string {
  const startYear = at.getUTCMonth() >= 6 ? at.getUTCFullYear() : at.getUTCFullYear() - 1;
  return new Date(Date.UTC(startYear, 6, 1)).toISOString();
}
