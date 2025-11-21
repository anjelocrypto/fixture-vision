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
  const fixtures = json?.response ?? [];
  
  // Enhanced logging for Man City (team_id 50)
  if (teamId === 50) {
    console.log(`[stats] 🔍 DEBUG Man City - Raw fixtures response:`, JSON.stringify(fixtures.map((f: any) => ({
      fixture_id: f.fixture?.id,
      date: f.fixture?.date,
      league: f.league?.name,
      home: f.teams?.home?.name,
      away: f.teams?.away?.name,
      status: f.fixture?.status?.short
    })), null, 2));
  }
  
  const ids = fixtures
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
  
  // Enhanced logging for Man City (team_id 50)
  if (teamId === 50) {
    console.log(`[stats] 🔍 DEBUG Man City fixture ${fixtureId} - Raw statistics response:`, JSON.stringify(statsJson?.response?.map((r: any) => ({
      team_id: r?.team?.id,
      team_name: r?.team?.name,
      statistics_count: r?.statistics?.length
    })), null, 2));
  }
  
  // Find the statistics for this specific team (handle both number and string IDs)
  const teamStats = (statsJson?.response ?? []).find((r: any) => {
    const responseTeamId = Number(r?.team?.id);
    const targetTeamId = Number(teamId);
    return responseTeamId === targetTeamId;
  });
  
  if (!teamStats) {
    console.warn(`[stats] ❌ No statistics found for team ${teamId} in fixture ${fixtureId}`);
    if (teamId === 50) {
      console.log(`[stats] 🔍 Available teams in response:`, (statsJson?.response ?? []).map((r: any) => ({
        id: r?.team?.id,
        name: r?.team?.name
      })));
    }
    return { goals, corners: 0, offsides: 0, fouls: 0, cards: 0 };
  }
  
  const statsArr = teamStats?.statistics ?? [];
  
  // Enhanced logging for Man City
  if (teamId === 50) {
    console.log(`[stats] 🔍 DEBUG Man City fixture ${fixtureId} - All statistics types:`, statsArr.map((s: any) => `${s?.type}: ${s?.value}`));
  }
  
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
  
  // Enhanced logging for Man City
  if (teamId === 50) {
    console.log(`[stats] 🔍 DEBUG Man City fixture ${fixtureId} SUMMARY: ${fixture?.teams?.home?.name} vs ${fixture?.teams?.away?.name} | Team side: ${teamSide} | Corners: ${corners}`);
  }
  
  return { goals, corners, offsides, fouls, cards };
}

export async function computeLastFiveAverages(teamId: number): Promise<Last5Result> {
  console.log(`[stats] Computing last 5 averages for team ${teamId}`);
  
  const fixtures = await fetchTeamLast5FixtureIds(teamId);
  const stats: Array<{ goals: number; corners: number; offsides: number; fouls: number; cards: number }> = [];
  const validFixtures: number[] = [];
  
  // Fetch stats for each fixture, only include those with valid data
  for (const fxId of fixtures) {
    try {
      const s = await fetchFixtureTeamStats(fxId, teamId);
      
      // Only include matches where we got actual stats (not all zeros due to missing data)
      // At minimum we should have goals data for a finished match
      const hasValidData = s.goals !== undefined || s.corners > 0 || s.cards > 0;
      
      if (hasValidData || stats.length < 5) {
        // Always add to maintain up to 5 matches even if some have zero stats
        stats.push(s);
        validFixtures.push(fxId);
      } else {
        console.warn(`[stats] Fixture ${fxId} has no valid stats, skipping`);
      }
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
    last_five_fixture_ids: validFixtures,
    last_final_fixture: validFixtures[0] ?? null,
    computed_at: new Date().toISOString(),
    source: "api-football",
  };
  
  console.log(`[stats] Team ${teamId} averages (${n} matches): goals=${result.goals.toFixed(2)}, corners=${result.corners.toFixed(2)}, cards=${result.cards.toFixed(2)}`);
  
  // Enhanced logging for Man City (team_id 50) or any team with suspicious low corners
  if (teamId === 50 || result.corners < 3) {
    console.log(`[stats] 🔍 DEBUG Team ${teamId} FINAL SUMMARY:`);
    console.log(`[stats] 🔍 Fixtures analyzed: [${validFixtures.join(', ')}]`);
    console.log(`[stats] 🔍 Per-match breakdown:`);
    stats.forEach((s, i) => {
      console.log(`[stats] 🔍   Match ${i + 1} (fixture ${validFixtures[i]}): goals=${s.goals}, corners=${s.corners}, cards=${s.cards}`);
    });
    console.log(`[stats] 🔍 Total corners sum: ${sum("corners")}`);
    console.log(`[stats] 🔍 Average corners: ${result.corners.toFixed(2)}`);
    console.log(`[stats] 🔍 Sample size: ${n} matches`);
    
    if (result.corners < 3 && n === 5) {
      console.warn(`[stats] ⚠️ SUSPICIOUS: Team ${teamId} has unusually low corners average (${result.corners.toFixed(2)}). This may indicate a data extraction bug.`);
    }
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
