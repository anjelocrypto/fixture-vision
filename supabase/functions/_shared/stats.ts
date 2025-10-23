// Shared stats computation utilities

import { API_BASE, apiHeaders } from "./api.ts";

export type Last5Result = {
  team_id: number;
  goals: number;
  corners: number;
  cards: number;
  fouls: number;
  offsides: number;
  sample_size: number;
  last_five_fixture_ids: number[];
  last_final_fixture: number | null;
  computed_at?: string;
  source?: string;
};

export async function fetchTeamLast5FixtureIds(teamId: number): Promise<number[]> {
  console.log(`[stats] Fetching last 5 fixture IDs for team ${teamId}`);
  console.log(`[stats] Using API_BASE: ${API_BASE}`);
  
  const url = `${API_BASE}/fixtures?team=${teamId}&last=5&status=FT`;
  const res = await fetch(url, { headers: apiHeaders() });
  
  if (!res.ok) {
    console.error(`[stats] Failed to fetch fixtures for team ${teamId}: ${res.status}`);
    return [];
  }
  
  const json = await res.json();
  const ids = (json?.response ?? [])
    .map((f: any) => Number(f.fixture?.id))
    .filter(Number.isFinite);
  
  console.log(`[stats] Found ${ids.length} finished fixtures for team ${teamId}: [${ids.join(', ')}]`);
  return ids;
}

// Extract one team's statistics from a finished fixture
async function fetchFixtureTeamStats(fixtureId: number, teamId: number) {
  console.log(`[stats] Fetching stats for team ${teamId} in fixture ${fixtureId}`);
  
  // First, get the fixture details to determine goals and team side
  const fixtureUrl = `${API_BASE}/fixtures?id=${fixtureId}`;
  const fixtureRes = await fetch(fixtureUrl, { headers: apiHeaders() });
  
  if (!fixtureRes.ok) {
    console.error(`[stats] Failed to fetch fixture ${fixtureId}: ${fixtureRes.status}`);
    return { goals: 0, corners: 0, offsides: 0, fouls: 0, cards: 0 };
  }
  
  const fixtureJson = await fixtureRes.json();
  const fixture = fixtureJson?.response?.[0];
  
  let goals = 0;
  if (fixture) {
    const homeId = fixture?.teams?.home?.id;
    const awayId = fixture?.teams?.away?.id;
    const gHome = Number(fixture?.goals?.home ?? fixture?.score?.fulltime?.home ?? 0);
    const gAway = Number(fixture?.goals?.away ?? fixture?.score?.fulltime?.away ?? 0);
    
    if (teamId === homeId) {
      goals = gHome;
      console.log(`[stats] Team ${teamId} is home team: ${gHome} goals`);
    } else if (teamId === awayId) {
      goals = gAway;
      console.log(`[stats] Team ${teamId} is away team: ${gAway} goals`);
    }
  }
  
  // Now fetch statistics
  const statsUrl = `${API_BASE}/fixtures/statistics?fixture=${fixtureId}`;
  const statsRes = await fetch(statsUrl, { headers: apiHeaders() });
  
  if (!statsRes.ok) {
    console.warn(`[stats] Failed to fetch statistics for fixture ${fixtureId}, team ${teamId}: ${statsRes.status}`);
    return { goals, corners: 0, offsides: 0, fouls: 0, cards: 0 };
  }
  
  const statsJson = await statsRes.json();
  
  // Find the statistics for this specific team
  const teamStats = (statsJson?.response ?? []).find((r: any) => r?.team?.id === teamId);
  
  if (!teamStats) {
    console.warn(`[stats] No statistics found for team ${teamId} in fixture ${fixtureId}`);
    return { goals, corners: 0, offsides: 0, fouls: 0, cards: 0 };
  }
  
  const statsArr = teamStats?.statistics ?? [];
  
  // Helper: find numeric value by type
  const val = (type: string) => {
    const row = statsArr.find((s: any) => 
      (s?.type || "").toLowerCase() === type.toLowerCase()
    );
    const v = row?.value;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      // Handle cases like "10%" or "10"
      const num = parseFloat(String(v).replace(/[^0-9.]/g, ""));
      return isNaN(num) ? 0 : num;
    }
    return 0;
  };
  
  const corners = val("Corner Kicks");
  const offsides = val("Offsides");
  const fouls = val("Fouls");
  const yellow = val("Yellow Cards");
  const red = val("Red Cards");
  const cards = yellow + red;
  
  console.log(`[stats] Team ${teamId} fixture ${fixtureId}: goals=${goals}, corners=${corners}, cards=${cards}, fouls=${fouls}, offsides=${offsides}`);
  
  return { goals, corners, offsides, fouls, cards };
}

export async function computeLastFiveAverages(teamId: number): Promise<Last5Result> {
  console.log(`[stats] Computing last 5 averages for team ${teamId}`);
  
  const fixtures = await fetchTeamLast5FixtureIds(teamId);
  const stats: Array<{ goals: number; corners: number; offsides: number; fouls: number; cards: number }> = [];
  
  for (const fxId of fixtures) {
    try {
      const s = await fetchFixtureTeamStats(fxId, teamId);
      stats.push(s);
    } catch (error) {
      console.error(`[stats] Error fetching stats for fixture ${fxId}:`, error);
    }
  }
  
  const n = stats.length || 0;
  const sum = (k: 'goals' | 'corners' | 'cards' | 'fouls' | 'offsides') => 
    stats.reduce((a: number, s) => a + (Number(s[k]) || 0), 0);
  const avg = (x: number) => (n ? x / n : 0);
  
  const result = {
    team_id: teamId,
    goals: avg(sum("goals")),
    corners: avg(sum("corners")),
    cards: avg(sum("cards")),
    fouls: avg(sum("fouls")),
    offsides: avg(sum("offsides")),
    sample_size: n,
    last_five_fixture_ids: fixtures,
    last_final_fixture: fixtures[0] ?? null,
    computed_at: new Date().toISOString(),
    source: "api-football",
  };
  
  console.log(`[stats] Team ${teamId} averages (${n} matches): goals=${result.goals.toFixed(2)}, corners=${result.corners.toFixed(2)}, cards=${result.cards.toFixed(2)}`);
  
  return result;
}
