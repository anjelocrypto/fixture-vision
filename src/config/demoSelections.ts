/**
 * Demo Selections - Pre-computed picks with historical results
 * 
 * These are realistic betting selections from the demo fixtures
 * with actual outcomes calculated from match results.
 */

import { DEMO_FIXTURES } from "./demoFixtures";

export interface DemoSelection {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  leagueName: string;
  kickoff: string;
  market: "goals" | "corners" | "cards";
  side: "over" | "under";
  line: number;
  odds: number;
  bookmaker: string;
  // Pre-computed averages (what model would predict)
  combinedAvg: number;
  // Actual result from match
  result: {
    actual: number;
    hit: boolean;
  };
}

// Calculate if selection hit based on actual stats
function calculateHit(actual: number, line: number, side: "over" | "under"): boolean {
  if (side === "over") return actual > line;
  return actual < line;
}

// Generate selections from demo fixtures
function generateDemoSelections(): DemoSelection[] {
  const selections: DemoSelection[] = [];

  DEMO_FIXTURES.forEach((fixture) => {
    const totalGoals = fixture.score.home + fixture.score.away;
    const totalCorners = fixture.stats.cornersHome + fixture.stats.cornersAway;
    const totalCards = fixture.stats.cardsHome + fixture.stats.cardsAway;

    // Goals Over 2.5
    selections.push({
      fixtureId: fixture.fixtureId,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      leagueName: fixture.leagueName,
      kickoff: fixture.kickoff,
      market: "goals",
      side: "over",
      line: 2.5,
      odds: 1.75 + Math.random() * 0.3,
      bookmaker: "Demo Odds",
      combinedAvg: 2.4 + Math.random() * 0.8,
      result: { actual: totalGoals, hit: calculateHit(totalGoals, 2.5, "over") }
    });

    // Goals Under 2.5
    selections.push({
      fixtureId: fixture.fixtureId,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      leagueName: fixture.leagueName,
      kickoff: fixture.kickoff,
      market: "goals",
      side: "under",
      line: 2.5,
      odds: 2.0 + Math.random() * 0.3,
      bookmaker: "Demo Odds",
      combinedAvg: 2.2 + Math.random() * 0.6,
      result: { actual: totalGoals, hit: calculateHit(totalGoals, 2.5, "under") }
    });

    // Goals Over 1.5
    selections.push({
      fixtureId: fixture.fixtureId,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      leagueName: fixture.leagueName,
      kickoff: fixture.kickoff,
      market: "goals",
      side: "over",
      line: 1.5,
      odds: 1.35 + Math.random() * 0.2,
      bookmaker: "Demo Odds",
      combinedAvg: 2.0 + Math.random() * 0.5,
      result: { actual: totalGoals, hit: calculateHit(totalGoals, 1.5, "over") }
    });

    // Corners Over 9.5
    selections.push({
      fixtureId: fixture.fixtureId,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      leagueName: fixture.leagueName,
      kickoff: fixture.kickoff,
      market: "corners",
      side: "over",
      line: 9.5,
      odds: 1.85 + Math.random() * 0.3,
      bookmaker: "Demo Odds",
      combinedAvg: 9.2 + Math.random() * 2,
      result: { actual: totalCorners, hit: calculateHit(totalCorners, 9.5, "over") }
    });

    // Corners Under 9.5
    selections.push({
      fixtureId: fixture.fixtureId,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      leagueName: fixture.leagueName,
      kickoff: fixture.kickoff,
      market: "corners",
      side: "under",
      line: 9.5,
      odds: 1.90 + Math.random() * 0.25,
      bookmaker: "Demo Odds",
      combinedAvg: 9.0 + Math.random() * 1.5,
      result: { actual: totalCorners, hit: calculateHit(totalCorners, 9.5, "under") }
    });

    // Corners Over 10.5
    selections.push({
      fixtureId: fixture.fixtureId,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      leagueName: fixture.leagueName,
      kickoff: fixture.kickoff,
      market: "corners",
      side: "over",
      line: 10.5,
      odds: 2.10 + Math.random() * 0.4,
      bookmaker: "Demo Odds",
      combinedAvg: 10.0 + Math.random() * 2,
      result: { actual: totalCorners, hit: calculateHit(totalCorners, 10.5, "over") }
    });

    // Cards Over 3.5
    selections.push({
      fixtureId: fixture.fixtureId,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      leagueName: fixture.leagueName,
      kickoff: fixture.kickoff,
      market: "cards",
      side: "over",
      line: 3.5,
      odds: 1.70 + Math.random() * 0.35,
      bookmaker: "Demo Odds",
      combinedAvg: 3.8 + Math.random() * 1.5,
      result: { actual: totalCards, hit: calculateHit(totalCards, 3.5, "over") }
    });

    // Cards Under 4.5
    selections.push({
      fixtureId: fixture.fixtureId,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      leagueName: fixture.leagueName,
      kickoff: fixture.kickoff,
      market: "cards",
      side: "under",
      line: 4.5,
      odds: 1.65 + Math.random() * 0.3,
      bookmaker: "Demo Odds",
      combinedAvg: 4.2 + Math.random() * 1.2,
      result: { actual: totalCards, hit: calculateHit(totalCards, 4.5, "under") }
    });

    // Cards Over 4.5
    selections.push({
      fixtureId: fixture.fixtureId,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      leagueName: fixture.leagueName,
      kickoff: fixture.kickoff,
      market: "cards",
      side: "over",
      line: 4.5,
      odds: 2.20 + Math.random() * 0.4,
      bookmaker: "Demo Odds",
      combinedAvg: 4.5 + Math.random() * 1.5,
      result: { actual: totalCards, hit: calculateHit(totalCards, 4.5, "over") }
    });
  });

  // Round odds to 2 decimal places
  return selections.map(s => ({
    ...s,
    odds: Math.round(s.odds * 100) / 100,
    combinedAvg: Math.round(s.combinedAvg * 100) / 100
  }));
}

export const DEMO_SELECTIONS = generateDemoSelections();

// Available markets and lines for demo filtering
export const DEMO_MARKET_OPTIONS = [
  { id: "goals", label: "Goals", lines: [1.5, 2.5, 3.5] },
  { id: "corners", label: "Corners", lines: [8.5, 9.5, 10.5, 11.5] },
  { id: "cards", label: "Cards", lines: [2.5, 3.5, 4.5, 5.5] },
];
