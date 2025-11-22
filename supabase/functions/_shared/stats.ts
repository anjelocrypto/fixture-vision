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
  
  // Determine current season (Nov-June = current year, July-Oct = next year)
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const year = now.getFullYear();
  const season = (month >= 6) ? year : year - 1; // Season starts in July/August
  
  // Fetch finished fixtures for current season, sorted by date descending
  const url = `${API_BASE}/fixtures?team=${teamId}&season=${season}&status=FT`;
  console.log(`[stats] 🔍 API Request: ${url}`);
  
  const res = await fetch(url, { headers: apiHeaders() });
  
  if (!res.ok) {
    console.error(`[stats] ❌ Failed to fetch fixtures for team ${teamId}: ${res.status}`);
    return [];
  }
  
  const json = await res.json();
  const fixtures = json?.response ?? [];
  
  // Sort by date descending (most recent first) and take first 5
  const sorted = fixtures
    .filter((f: any) => f?.fixture?.id && f?.fixture?.timestamp)
    .sort((a: any, b: any) => b.fixture.timestamp - a.fixture.timestamp)
    .slice(0, 5);
  
  const ids = sorted.map((f: any) => Number(f.fixture.id)).filter(Number.isFinite);
  
  console.log(`[stats] ✅ Found ${ids.length} finished fixtures for team ${teamId} (season ${season}): [${ids.join(', ')}]`);
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
  let teamSide = "unknown";
  if (fixture) {
    const homeId = fixture?.teams?.home?.id;
    const awayId = fixture?.teams?.away?.id;
    const gHome = Number(fixture?.goals?.home ?? fixture?.score?.fulltime?.home ?? 0);
    const gAway = Number(fixture?.goals?.away ?? fixture?.score?.fulltime?.away ?? 0);
    
    if (teamId === homeId) {
      goals = gHome;
      teamSide = "home";
      console.log(`[stats] Team ${teamId} is home team: ${gHome} goals`);
    } else if (teamId === awayId) {
      goals = gAway;
      teamSide = "away";
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
  
  // Find the statistics for this specific team (handle both number and string IDs)
  const teamStats = (statsJson?.response ?? []).find((r: any) => {
    const responseTeamId = Number(r?.team?.id);
    const targetTeamId = Number(teamId);
    return responseTeamId === targetTeamId;
  });
  
  if (!teamStats) {
    console.warn(`[stats] ❌ No statistics found for team ${teamId} in fixture ${fixtureId}`);
    return { goals, corners: 0, offsides: 0, fouls: 0, cards: 0 };
  }
  
  const statsArr = teamStats?.statistics ?? [];
  
  // Helper: find numeric value by type (supports multiple type names)
  const val = (...types: string[]) => {
    for (const type of types) {
      const row = statsArr.find((s: any) => 
        (s?.type || "").toLowerCase() === type.toLowerCase()
      );
      if (row) {
        const v = row.value;
        if (typeof v === "number") return v;
        if (typeof v === "string") {
          // Handle cases like "10%" or "10"
          const num = parseFloat(String(v).replace(/[^0-9.]/g, ""));
          if (!isNaN(num)) return num;
        }
        if (v === null || v === undefined) continue;
      }
    }
    return 0;
  };
  
  // Try multiple variations of stat names (API-FOOTBALL may use different names)
  const corners = val("Corner Kicks", "Corners");
  const offsides = val("Offsides");
  const fouls = val("Fouls");
  const yellow = val("Yellow Cards");
  const red = val("Red Cards");
  const cards = yellow + red;
  
  console.log(`[stats] Team ${teamId} fixture ${fixtureId}: goals=${goals}, corners=${corners}, cards=${cards}, fouls=${fouls}, offsides=${offsides}`);
  
  return { goals, corners, offsides, fouls, cards };
}

export async function computeLastFiveAverages(teamId: number): Promise<Last5Result> {
  console.log(`[stats] 🔍 Computing last 5 averages for team ${teamId}`);
  
  const fixtures = await fetchTeamLast5FixtureIds(teamId);
  const stats: Array<{ goals: number; corners: number; offsides: number; fouls: number; cards: number }> = [];
  const validFixtures: number[] = [];
  const debugDetails: Array<{fxId: number, goals: number, corners: number, cards: number, fouls: number, offsides: number}> = [];
  
  // Fetch stats for each fixture
  for (const fxId of fixtures) {
    try {
      const s = await fetchFixtureTeamStats(fxId, teamId);
      
      // DEBUG: Log each match's raw stats
      console.log(`[stats] 📊 Fixture ${fxId}: goals=${s.goals}, corners=${s.corners}, cards=${s.cards}, fouls=${s.fouls}, offsides=${s.offsides}`);
      debugDetails.push({ fxId, ...s });
      
      // Only include matches where we got actual meaningful stats
      // Check if at least one metric is defined (goals should always be defined for FT matches)
      const hasAnyData = (
        (typeof s.goals === 'number') ||
        (typeof s.corners === 'number' && s.corners > 0) ||
        (typeof s.cards === 'number' && s.cards > 0) ||
        (typeof s.fouls === 'number' && s.fouls > 0) ||
        (typeof s.offsides === 'number' && s.offsides > 0)
      );
      
      if (hasAnyData) {
        stats.push(s);
        validFixtures.push(fxId);
      } else {
        console.warn(`[stats] ⚠️ Fixture ${fxId} has no valid stats data, excluding from average`);
      }
    } catch (error) {
      console.error(`[stats] ❌ Error fetching stats for fixture ${fxId}:`, error);
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
    last_five_fixture_ids: validFixtures,
    last_final_fixture: validFixtures[0] ?? null,
    computed_at: new Date().toISOString(),
    source: "api-football",
  };
  
  // DETAILED DEBUG LOG
  console.log(`[stats] ✅ Team ${teamId} FINAL AVERAGES (${n} valid matches):`);
  console.log(`[stats]    Goals: ${result.goals.toFixed(2)} (total: ${sum("goals")})`);
  console.log(`[stats]    Corners: ${result.corners.toFixed(2)} (total: ${sum("corners")})`);
  console.log(`[stats]    Cards: ${result.cards.toFixed(2)} (total: ${sum("cards")})`);
  console.log(`[stats]    Fouls: ${result.fouls.toFixed(2)} (total: ${sum("fouls")})`);
  console.log(`[stats]    Offsides: ${result.offsides.toFixed(2)} (total: ${sum("offsides")})`);
  console.log(`[stats]    Fixture IDs: [${validFixtures.join(', ')}]`);
  
  // Log detailed match breakdown
  console.log(`[stats] 📋 Match-by-match breakdown for team ${teamId}:`);
  debugDetails.forEach((d) => {
    console.log(`[stats]    Fixture ${d.fxId}: G=${d.goals}, C=${d.corners}, Cards=${d.cards}, F=${d.fouls}, O=${d.offsides}`);
  });
  
  // Validation warnings
  if (n < 5) {
    console.warn(`[stats] ⚠️ Team ${teamId} has only ${n} matches with valid stats (expected 5)`);
  }
  
  if (result.corners < 3 && n >= 3) {
    console.warn(`[stats] ⚠️ Team ${teamId} has unusually low corners average (${result.corners.toFixed(2)} from ${n} matches)`);
  }
  
  if (result.goals < 0.5 && n >= 3) {
    console.warn(`[stats] ⚠️ Team ${teamId} has unusually low goals average (${result.goals.toFixed(2)} from ${n} matches)`);
  }
  
  return result;
}

// Multipliers for combined stats (v2 formula)
const METRIC_MULTIPLIERS = {
  goals: 1.6,
  corners: 1.75,
  offsides: 1.8,
  fouls: 1.8,
  cards: 1.8,
} as const;

// Sanity clamps
const METRIC_BOUNDS = {
  goals: { min: 0, max: 12 },
  corners: { min: 0, max: 25 },
  offsides: { min: 0, max: 10 },
  fouls: { min: 0, max: 40 },
  cards: { min: 0, max: 15 },
} as const;

type MetricKey = 'goals' | 'corners' | 'offsides' | 'fouls' | 'cards';

export type CombinedMetrics = {
  goals: number | null;
  corners: number | null;
  offsides: number | null;
  fouls: number | null;
  cards: number | null;
  sample_size: number;
};

/**
 * Compute combined metrics using v2 formula:
 * combined(metric) = ((home_avg + away_avg) / 2) × multiplier
 * 
 * Requires minimum 3 matches per team for each metric.
 * Returns null for metrics with insufficient data.
 */
export function computeCombinedMetrics(
  homeStats: Last5Result,
  awayStats: Last5Result
): CombinedMetrics {
  const minSampleSize = Math.min(homeStats.sample_size, awayStats.sample_size);
  
  const combined: CombinedMetrics = {
    goals: null,
    corners: null,
    offsides: null,
    fouls: null,
    cards: null,
    sample_size: minSampleSize,
  };

  // Only compute if we have at least 3 matches for both teams
  if (homeStats.sample_size < 3 || awayStats.sample_size < 3) {
    console.log(`[stats] Insufficient sample size: home=${homeStats.sample_size}, away=${awayStats.sample_size} (min 3 required)`);
    return combined;
  }

  const metrics: MetricKey[] = ['goals', 'corners', 'offsides', 'fouls', 'cards'];
  
  for (const metric of metrics) {
    const homeAvg = Number(homeStats[metric]) || 0;
    const awayAvg = Number(awayStats[metric]) || 0;
    const multiplier = METRIC_MULTIPLIERS[metric];
    const bounds = METRIC_BOUNDS[metric];
    
    // Formula: ((home_avg + away_avg) / 2) × multiplier
    let value = ((homeAvg + awayAvg) / 2) * multiplier;
    
    // Apply bounds
    value = Math.max(bounds.min, Math.min(bounds.max, value));
    
    // Round to 1 decimal
    combined[metric] = Math.round(value * 10) / 10;
  }

  console.log(
    `[stats] combined v2: goals=${combined.goals} corners=${combined.corners} offsides=${combined.offsides} fouls=${combined.fouls} cards=${combined.cards} (samples: H=${homeStats.sample_size}/A=${awayStats.sample_size})`
  );

  return combined;
}
