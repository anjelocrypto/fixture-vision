// Shared stats computation utilities
// Deployment trigger: 2025-11-23 01:00:00 UTC - Verified all metrics correct (goals, corners, fouls, offsides, cards)
//
// API-FOOTBALL ENDPOINT REFERENCE (v3):
// =====================================
// 1. Last 5 finished fixtures:
//    GET /fixtures?team={TEAM_ID}&season=2025&status=FT&last=5
//    - season=2025 for 2025-2026 season (use year of season start)
//    - status=FT ensures only finished matches (not NS/upcoming)
//    - last=5 returns most recent 5 matches (API sorts internally)
//
// 2. Fixture details (for goals):
//    GET /fixtures?id={FIXTURE_ID}
//    - Returns: fixture.goals.home, fixture.goals.away (or fixture.score.fulltime)
//
// 3. Per-fixture statistics:
//    GET /fixtures/statistics?fixture={FIXTURE_ID}
//    - Returns array with one entry per team
//    - Each entry has statistics array with type/value pairs
//    - Stat type strings (case-insensitive matching):
//      * Corners: "Corner Kicks" OR "Corners"
//      * Fouls: "Fouls"
//      * Offsides: "Offsides"
//      * Yellow Cards: "Yellow Cards"
//      * Red Cards: "Red Cards"
//    - NOTE: API sometimes returns NO statistics for certain fixtures/teams
//      We handle this by excluding fixtures where all non-goal metrics are 0

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
  console.log(`[stats] 🔍 Fetching last 5 fixture IDs for team ${teamId}`);
  
  // Use current year as season (Nov 2025 = season 2025-2026)
  const season = new Date().getFullYear();
  
  // CRITICAL: Use API-Football's "last" parameter for efficiency
  // API docs: fixtures?team={id}&season={season}&last=5&status=FT
  // This returns the last 5 finished fixtures directly, no need to fetch all and sort
  const url = `${API_BASE}/fixtures?team=${teamId}&season=${season}&last=5&status=FT`;
  console.log(`[stats] 📡 API-Football Request: ${url}`);
  console.log(`[stats] 📅 Season: ${season}, Last: 5, Status Filter: FT`);
  
  const res = await fetch(url, { headers: apiHeaders() });
  
  if (!res.ok) {
    console.error(`[stats] ❌ Failed to fetch fixtures for team ${teamId}: HTTP ${res.status}`);
    return [];
  }
  
  const json = await res.json();
  const fixtures = json?.response ?? [];
  
  console.log(`[stats] 📥 API-Football returned ${fixtures.length} fixtures for team ${teamId}`);
  
  // CRITICAL: Double-verify all fixtures are actually FT status (API should already filter)
  const validFixtures = fixtures.filter((f: any) => {
    const status = f?.fixture?.status?.short || f?.fixture?.status;
    const isFT = status === 'FT';
    if (!isFT) {
      console.warn(`[stats] ⚠️ Fixture ${f?.fixture?.id} has status ${status}, not FT - excluding`);
    }
    return isFT && f?.fixture?.id && f?.fixture?.timestamp;
  });
  
  console.log(`[stats] ✅ After filtering, ${validFixtures.length} fixtures have FT status`);
  
  // Sort by date descending (most recent first) - should already be sorted by API
  const sorted = validFixtures
    .sort((a: any, b: any) => b.fixture.timestamp - a.fixture.timestamp);
  
  const ids = sorted.map((f: any) => Number(f.fixture.id)).filter(Number.isFinite);
  
  console.log(`[stats] ✅ Final last-5 FT fixture IDs for team ${teamId}: [${ids.join(', ')}]`);
  
  // Log match details for debugging
  sorted.forEach((f: any, idx: number) => {
    const date = new Date(f.fixture.timestamp * 1000).toISOString().split('T')[0];
    const home = f.teams?.home?.name || '?';
    const away = f.teams?.away?.name || '?';
    const status = f.fixture?.status?.short || '?';
    console.log(`[stats]   ${idx+1}. Fixture ${f.fixture.id} - ${date} [${status}]: ${home} vs ${away}`);
  });
  
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
  // Handles number, string ("10", "10%"), and missing values
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
  
  // Extract all metrics using official API-Football stat type names
  // Note: API-Football uses different type strings in different leagues/competitions
  const corners = val("Corner Kicks", "Corners");        // Both variants seen in API
  const offsides = val("Offsides");                      // Standard
  const fouls = val("Fouls");                            // Standard
  const yellow = val("Yellow Cards");                    // Standard
  const red = val("Red Cards");                          // Standard
  const cards = yellow + red;                            // Total cards
  
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
      
      // CRITICAL VALIDATION: Only include matches with MEANINGFUL NON-GOAL statistics
      // API-Football sometimes returns NO statistics from /fixtures/statistics endpoint
      // Goals come from /fixtures endpoint and are always present, but corners/cards/fouls/offsides
      // come from /fixtures/statistics and may be missing for certain leagues/fixtures
      // 
      // A fixture is valid ONLY if it has at least ONE non-goal statistic
      // This ensures we only average fixtures where the statistics endpoint returned real data
      //
      // Example: Lech Poznan fixture 1380510 has goals=1 but corners=0, cards=0, fouls=0, offsides=0
      // This means API has NO statistics data for this match, only the goals from fixture endpoint
      // We must EXCLUDE such fixtures from corners/cards/fouls/offsides averaging
      const hasRealStats = (
        s.corners > 0 ||
        s.cards > 0 ||
        s.fouls > 0 ||
        s.offsides > 0
      );
      
      if (hasRealStats) {
        stats.push(s);
        validFixtures.push(fxId);
      } else {
        // This is expected for some fixtures where API-Football doesn't have statistics
        console.warn(`[stats] ⚠️ Fixture ${fxId} has no meaningful stats (API-Football data unavailable), excluding from average`);
        console.warn(`[stats] ⚠️   Raw stats: G=${s.goals} C=${s.corners} Cards=${s.cards} F=${s.fouls} O=${s.offsides}`);
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
  
  // Log detailed match-by-match breakdown
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
