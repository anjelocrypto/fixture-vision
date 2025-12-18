/**
 * Demo Mode Configuration
 * 
 * Curated historical fixtures for demonstration purposes.
 * These are finished matches only, used to showcase the app's features
 * without requiring authentication or live data.
 */

export interface DemoFixture {
  fixtureId: number;
  leagueId: number;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo: string;
  awayLogo: string;
  kickoff: string;
  score: { home: number; away: number };
  stats: {
    cornersHome: number;
    cornersAway: number;
    cardsHome: number;
    cardsAway: number;
  };
}

// Curated fixtures from December 2025 matchday (Big 5 leagues)
export const DEMO_FIXTURES: DemoFixture[] = [
  // Premier League
  {
    fixtureId: 1379118,
    leagueId: 39,
    leagueName: "Premier League",
    homeTeam: "Wolves",
    awayTeam: "Manchester United",
    homeLogo: "https://media.api-sports.io/football/teams/39.png",
    awayLogo: "https://media.api-sports.io/football/teams/33.png",
    kickoff: "2025-12-08T17:00:00Z",
    score: { home: 1, away: 4 },
    stats: { cornersHome: 1, cornersAway: 9, cardsHome: 3, cardsAway: 2 }
  },
  {
    fixtureId: 1379113,
    leagueId: 39,
    leagueName: "Premier League",
    homeTeam: "Fulham",
    awayTeam: "Crystal Palace",
    homeLogo: "https://media.api-sports.io/football/teams/36.png",
    awayLogo: "https://media.api-sports.io/football/teams/52.png",
    kickoff: "2025-12-07T15:00:00Z",
    score: { home: 1, away: 2 },
    stats: { cornersHome: 6, cornersAway: 4, cardsHome: 0, cardsAway: 0 }
  },
  // La Liga
  {
    fixtureId: 1390965,
    leagueId: 140,
    leagueName: "La Liga",
    homeTeam: "Real Madrid",
    awayTeam: "Celta Vigo",
    homeLogo: "https://media.api-sports.io/football/teams/541.png",
    awayLogo: "https://media.api-sports.io/football/teams/538.png",
    kickoff: "2025-12-07T20:00:00Z",
    score: { home: 0, away: 2 },
    stats: { cornersHome: 8, cornersAway: 1, cardsHome: 9, cardsAway: 1 }
  },
  {
    fixtureId: 1390967,
    leagueId: 140,
    leagueName: "La Liga",
    homeTeam: "Valencia",
    awayTeam: "Sevilla",
    homeLogo: "https://media.api-sports.io/football/teams/532.png",
    awayLogo: "https://media.api-sports.io/football/teams/536.png",
    kickoff: "2025-12-07T17:30:00Z",
    score: { home: 1, away: 1 },
    stats: { cornersHome: 2, cornersAway: 2, cardsHome: 3, cardsAway: 6 }
  },
  {
    fixtureId: 1390963,
    leagueId: 140,
    leagueName: "La Liga",
    homeTeam: "Espanyol",
    awayTeam: "Rayo Vallecano",
    homeLogo: "https://media.api-sports.io/football/teams/540.png",
    awayLogo: "https://media.api-sports.io/football/teams/728.png",
    kickoff: "2025-12-07T15:00:00Z",
    score: { home: 1, away: 0 },
    stats: { cornersHome: 6, cornersAway: 2, cardsHome: 5, cardsAway: 9 }
  },
  {
    fixtureId: 1390964,
    leagueId: 140,
    leagueName: "La Liga",
    homeTeam: "Osasuna",
    awayTeam: "Levante",
    homeLogo: "https://media.api-sports.io/football/teams/727.png",
    awayLogo: "https://media.api-sports.io/football/teams/539.png",
    kickoff: "2025-12-08T13:00:00Z",
    score: { home: 2, away: 0 },
    stats: { cornersHome: 3, cornersAway: 3, cardsHome: 2, cardsAway: 2 }
  },
  // Serie A
  {
    fixtureId: 1378001,
    leagueId: 135,
    leagueName: "Serie A",
    homeTeam: "Torino",
    awayTeam: "AC Milan",
    homeLogo: "https://media.api-sports.io/football/teams/503.png",
    awayLogo: "https://media.api-sports.io/football/teams/489.png",
    kickoff: "2025-12-08T19:45:00Z",
    score: { home: 2, away: 3 },
    stats: { cornersHome: 2, cornersAway: 4, cardsHome: 2, cardsAway: 1 }
  },
  {
    fixtureId: 1377998,
    leagueId: 135,
    leagueName: "Serie A",
    homeTeam: "Napoli",
    awayTeam: "Juventus",
    homeLogo: "https://media.api-sports.io/football/teams/492.png",
    awayLogo: "https://media.api-sports.io/football/teams/496.png",
    kickoff: "2025-12-07T19:45:00Z",
    score: { home: 2, away: 1 },
    stats: { cornersHome: 9, cornersAway: 0, cardsHome: 2, cardsAway: 1 }
  },
  {
    fixtureId: 1377997,
    leagueId: 135,
    leagueName: "Serie A",
    homeTeam: "Lazio",
    awayTeam: "Bologna",
    homeLogo: "https://media.api-sports.io/football/teams/487.png",
    awayLogo: "https://media.api-sports.io/football/teams/500.png",
    kickoff: "2025-12-07T17:00:00Z",
    score: { home: 1, away: 1 },
    stats: { cornersHome: 7, cornersAway: 3, cardsHome: 4, cardsAway: 3 }
  },
  {
    fixtureId: 1377994,
    leagueId: 135,
    leagueName: "Serie A",
    homeTeam: "Cagliari",
    awayTeam: "AS Roma",
    homeLogo: "https://media.api-sports.io/football/teams/490.png",
    awayLogo: "https://media.api-sports.io/football/teams/497.png",
    kickoff: "2025-12-07T14:00:00Z",
    score: { home: 1, away: 0 },
    stats: { cornersHome: 4, cornersAway: 1, cardsHome: 2, cardsAway: 2 }
  },
  {
    fixtureId: 1378002,
    leagueId: 135,
    leagueName: "Serie A",
    homeTeam: "Udinese",
    awayTeam: "Genoa",
    homeLogo: "https://media.api-sports.io/football/teams/494.png",
    awayLogo: "https://media.api-sports.io/football/teams/495.png",
    kickoff: "2025-12-08T14:00:00Z",
    score: { home: 1, away: 2 },
    stats: { cornersHome: 6, cornersAway: 2, cardsHome: 1, cardsAway: 0 }
  },
  // Bundesliga (if available - adding placeholder data)
  // Ligue 1
  {
    fixtureId: 1387828,
    leagueId: 61,
    leagueName: "Ligue 1",
    homeTeam: "Lorient",
    awayTeam: "Lyon",
    homeLogo: "https://media.api-sports.io/football/teams/97.png",
    awayLogo: "https://media.api-sports.io/football/teams/80.png",
    kickoff: "2025-12-07T16:00:00Z",
    score: { home: 1, away: 0 },
    stats: { cornersHome: 1, cornersAway: 7, cardsHome: 2, cardsAway: 3 }
  },
];

// Extract fixture IDs for validation
export const DEMO_FIXTURE_IDS = DEMO_FIXTURES.map(f => f.fixtureId);

// Metadata about the demo set
export const DEMO_METADATA = {
  matchday: "December 7-8, 2025",
  leagues: ["Premier League", "La Liga", "Serie A", "Ligue 1"],
  fixtureCount: DEMO_FIXTURES.length,
  description: "Past matches from top European leagues showcasing app features"
};
