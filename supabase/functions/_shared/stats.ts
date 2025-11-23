// Shared stats computation utilities
// Deployment trigger: 2025-11-23 14:00:00 UTC - Added cup coverage filtering
//
// API-FOOTBALL ENDPOINT REFERENCE (v3):
// =====================================
// 1. Last 5 finished fixtures:
//    GET /fixtures?team={TEAM_ID}&season=2025&status=FT&last=20
//    - season=2025 for 2025-2026 season (use year of season start)
//    - status=FT ensures only finished matches (not NS/upcoming)
//    - last=20 returns most recent 20 matches (we'll filter to best 5)
//
// 2. Fixture details (for goals + league_id):
//    GET /fixtures?id={FIXTURE_ID}
//    - Returns: fixture.goals.home, fixture.goals.away, fixture.league.id
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
//    - NOTE: Some competitions (e.g., youth cups, EFL Trophy) have NO statistics
//      We use league_stats_coverage table to skip broken competitions per metric

import { API_BASE, apiHeaders } from "./api.ts";
import { loadLeagueCoverage, shouldSkipFixtureForMetric } from "./league_coverage.ts";

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

// Fetch last 20 FT fixtures for a team (we'll filter to best 5 later based on coverage)
export async function fetchTeamLast20FixtureIds(teamId: number): Promise<Array<{id: number, league_id: number}>> {
  console.log(`[stats] 🔍 Fetching last 20 fixture IDs for team ${teamId}`);
  
  // Football seasons start in August (month 7)
  // Nov 2024 (month 10) = 2024-2025 season (API calls this "2024")
  // July 2024 (month 6) = 2023-2024 season (API calls this "2023")
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const year = now.getFullYear();
  const season = (month >= 7) ? year : year - 1;
  
  // Fetch last 20 to have a pool to select from (excluding broken cups)
  const url = `${API_BASE}/fixtures?team=${teamId}&season=${season}&last=20&status=FT`;
  console.log(`[stats] 📡 API-Football Request: ${url}`);
  console.log(`[stats] 📅 Season: ${season}, Last: 20, Status Filter: FT`);
  
  const res = await fetch(url, { headers: apiHeaders() });
  
  if (!res.ok) {
    console.error(`[stats] ❌ Failed to fetch fixtures for team ${teamId}: HTTP ${res.status}`);
    return [];
  }
  
  const json = await res.json();
  const fixtures = json?.response ?? [];
  
  console.log(`[stats] 📥 API-Football returned ${fixtures.length} fixtures for team ${teamId}`);
  
  // Extract fixture IDs and league IDs
  const validFixtures = fixtures
    .filter((f: any) => {
      const status = f?.fixture?.status?.short || f?.fixture?.status;
      const isFT = status === 'FT';
      if (!isFT) {
        console.warn(`[stats] ⚠️ Fixture ${f?.fixture?.id} has status ${status}, not FT - excluding`);
      }
      return isFT && f?.fixture?.id && f?.fixture?.timestamp && f?.league?.id;
    })
    .sort((a: any, b: any) => b.fixture.timestamp - a.fixture.timestamp)
    .map((f: any) => ({
      id: Number(f.fixture.id),
      league_id: Number(f.league.id),
    }));
  
  console.log(`[stats] ✅ Found ${validFixtures.length} valid FT fixtures for team ${teamId}`);
  
  return validFixtures;
}

// Extract one team's statistics from a finished fixture
// Returns: goals (always number), other metrics (number | null)
// null = stat missing from API, 0 = API explicitly returned 0
async function fetchFixtureTeamStats(
  fixtureId: number, 
  teamId: number
): Promise<{ 
  goals: number; 
  corners: number | null; 
  cards: number | null; 
  fouls: number | null; 
  offsides: number | null;
}> {
  console.log(`[stats] Fetching stats for team ${teamId} in fixture ${fixtureId}`);
  
  // First, get the fixture details to determine goals and team side
  const fixtureUrl = `${API_BASE}/fixtures?id=${fixtureId}`;
  const fixtureRes = await fetch(fixtureUrl, { headers: apiHeaders() });
  
  if (!fixtureRes.ok) {
    console.error(`[stats] ❌ Failed to fetch fixture ${fixtureId}: ${fixtureRes.status}`);
    return { goals: 0, corners: null, offsides: null, fouls: null, cards: null };
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
    console.warn(`[stats] ⚠️ Failed to fetch statistics for fixture ${fixtureId}: ${statsRes.status}`);
    return { goals, corners: null, offsides: null, fouls: null, cards: null };
  }
  
  const statsJson = await statsRes.json();
  
  // Find the statistics for this specific team
  const teamStats = (statsJson?.response ?? []).find((r: any) => {
    const responseTeamId = Number(r?.team?.id);
    const targetTeamId = Number(teamId);
    return responseTeamId === targetTeamId;
  });
  
  if (!teamStats) {
    console.warn(`[stats] ⚠️ No statistics found for team ${teamId} in fixture ${fixtureId}`);
    return { goals, corners: null, offsides: null, fouls: null, cards: null };
  }
  
  const statsArr = teamStats?.statistics ?? [];
  
  // Helper: find numeric value by type
  // Returns null for missing stats to distinguish from real zeros
  const val = (...types: string[]): number | null => {
    for (const type of types) {
      const row = statsArr.find((s: any) => 
        (s?.type || "").toLowerCase() === type.toLowerCase()
      );
      if (!row) continue;
      
      const v = row.value;
      if (v === null || v === undefined) return null;
      
      if (typeof v === "number") return v; // includes 0
      if (typeof v === "string") {
        const num = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
        if (!isNaN(num)) return num;
      }
      return null;
    }
    return null;
  };
  
  // Extract all metrics
  const corners = val("Corner Kicks", "Corners");
  const offsides = val("Offsides");
  const fouls = val("Fouls");
  const yellow = val("Yellow Cards");
  const red = val("Red Cards");
  
  // Cards: sum yellow+red, but only if at least one is present
  const cards = (yellow !== null || red !== null) 
    ? (yellow ?? 0) + (red ?? 0) 
    : null;
  
  // Log missing stats
  const missing: string[] = [];
  if (corners === null) missing.push('corners');
  if (cards === null) missing.push('cards');
  if (fouls === null) missing.push('fouls');
  if (offsides === null) missing.push('offsides');
  
  if (missing.length > 0) {
    console.log(`[stats] ⚠️ Team ${teamId} fixture ${fixtureId}: Missing stats: ${missing.join(', ')}`);
  }
  
  console.log(`[stats] Team ${teamId} fixture ${fixtureId}: goals=${goals}, corners=${corners}, cards=${cards}, fouls=${fouls}, offsides=${offsides}`);
  
  return { goals, corners, offsides, fouls, cards };
}

export async function computeLastFiveAverages(teamId: number, supabase?: any): Promise<Last5Result> {
  console.log(`[stats] 🔍 Computing last 5 averages for team ${teamId} using matrix-v3 logic`);
  
  // Load league coverage data (cached)
  const coverageMap = supabase ? await loadLeagueCoverage(supabase) : new Map();
  console.log(`[stats] 📊 Loaded coverage data for ${coverageMap.size} leagues`);
  
  // Fetch last 20 fixtures (with league IDs) to have a pool to select from
  const allFixtures = await fetchTeamLast20FixtureIds(teamId);
  console.log(`[stats] 📥 Got ${allFixtures.length} FT fixtures from API to analyze`);
  
  // Build a map of league_id -> league name for cup detection
  const leagueNames = new Map<number, string>();
  if (supabase && allFixtures.length > 0) {
    const uniqueLeagueIds = [...new Set(allFixtures.map(f => f.league_id))];
    const { data: leagues } = await supabase
      .from('leagues')
      .select('id, name')
      .in('id', uniqueLeagueIds);
    
    if (leagues) {
      for (const league of leagues) {
        leagueNames.set(league.id, league.name);
      }
      console.log(`[stats] 📋 Loaded ${leagueNames.size} league names for cup detection`);
    }
  }
  
  // Per-metric arrays - each metric independently selects up to 5 valid fixtures
  type MetricFixture = { fxId: number; leagueId: number; value: number };
  const usedGoals: MetricFixture[] = [];
  const usedCorners: MetricFixture[] = [];
  const usedCards: MetricFixture[] = [];
  const usedFouls: MetricFixture[] = [];
  const usedOffsides: MetricFixture[] = [];
  
  // Loop through fixtures (newest → oldest) to build per-metric arrays
  for (const fx of allFixtures) {
    // Stop early if we have 5 for all metrics
    if (usedGoals.length >= 5 && usedCorners.length >= 5 && 
        usedCards.length >= 5 && usedFouls.length >= 5 && 
        usedOffsides.length >= 5) {
      console.log(`[stats] ✅ Found 5 valid fixtures for all metrics, stopping early`);
      break;
    }
    
    try {
      const s = await fetchFixtureTeamStats(fx.id, teamId);
      
      // Get raw values
      let corners = s.corners;
      let cards = s.cards;
      let fouls = s.fouls;
      let offsides = s.offsides;

      // =====================================================================
      // FAKE-ZERO DETECTION LOGIC
      // =====================================================================
      // Definition: A fixture has "fake zeros" if ALL non-goal metrics are 0 or null
      // AND it's from a cup/low-coverage competition
      // =====================================================================
      
      const allNonGoalZeroOrNull =
        (corners === null || corners === 0) &&
        (cards === null || cards === 0) &&
        (fouls === null || fouls === 0) &&
        (offsides === null || offsides === 0);

      // Check league coverage skip flags (if available)
      const skipCorners = shouldSkipFixtureForMetric(fx.league_id, 'corners', coverageMap);
      const skipCards = shouldSkipFixtureForMetric(fx.league_id, 'cards', coverageMap);
      const skipFouls = shouldSkipFixtureForMetric(fx.league_id, 'fouls', coverageMap);
      const skipOffsides = shouldSkipFixtureForMetric(fx.league_id, 'offsides', coverageMap);
      
      // Determine if this is likely a cup/problematic league
      // Check 1: League coverage says to skip (from database)
      const hasSkipFlags = skipCorners || skipCards || skipFouls || skipOffsides;
      
      // Check 2: League name contains cup keywords (heuristic fallback)
      const leagueName = leagueNames.get(fx.league_id) || '';
      const cupKeywords = ['cup', 'trophy', 'copa', 'coupe', 'pokal', 'taca', 'shield', 'super'];
      const isCupByName = cupKeywords.some(kw => leagueName.toLowerCase().includes(kw));
      
      const isSuspectedCup = hasSkipFlags || isCupByName;
      
      if (isCupByName && !hasSkipFlags) {
        console.log(`[stats] 🏆 Detected cup by name: fixture ${fx.id} in league ${fx.league_id} (${leagueName})`);
      }
      
      // Apply fake-zero logic: if all non-goal stats are 0/null AND it's a suspected cup
      let fakeZeroDetected = false;
      if (allNonGoalZeroOrNull && isSuspectedCup) {
        console.log(
          `[stats] ⚠️ Fake-zero pattern detected for fixture ${fx.id} (league ${fx.league_id}) – ` +
          `keeping goals=${s.goals}, nulling corners/cards/fouls/offsides`
        );
        
        // Null out the fake metrics
        corners = null;
        cards = null;
        fouls = null;
        offsides = null;
        fakeZeroDetected = true;
      }
      
      // Also check based on actual zero values (secondary check)
      const cornersFakeZero = !fakeZeroDetected && corners === 0 && allNonGoalZeroOrNull && isSuspectedCup;
      const cardsFakeZero = !fakeZeroDetected && cards === 0 && allNonGoalZeroOrNull && isSuspectedCup;
      const foulsFakeZero = !fakeZeroDetected && fouls === 0 && allNonGoalZeroOrNull && isSuspectedCup;
      const offsidesFakeZero = !fakeZeroDetected && offsides === 0 && allNonGoalZeroOrNull && isSuspectedCup;
      
      // Goals: always take the first 5 FT fixtures (no coverage skip, no fake-zero check)
      if (usedGoals.length < 5) {
        usedGoals.push({ fxId: fx.id, leagueId: fx.league_id, value: s.goals });
      }
      
      // Corners: skip if coverage says so, value is null, OR fake-zero pattern
      if (!skipCorners && corners !== null && !cornersFakeZero && usedCorners.length < 5) {
        usedCorners.push({ fxId: fx.id, leagueId: fx.league_id, value: corners });
      } else if (usedCorners.length < 5) {
        if (skipCorners) {
          console.log(`[stats] 🚫 Skipping fixture ${fx.id} for corners (league ${fx.league_id}) – coverage skip`);
        } else if (corners === null) {
          console.log(`[stats] 🚫 Skipping fixture ${fx.id} for corners (league ${fx.league_id}) – null value`);
        } else if (cornersFakeZero) {
          console.log(`[stats] 🚫 Skipping fixture ${fx.id} for corners (league ${fx.league_id}) – fake-zero pattern`);
        }
      }
      
      // Cards: skip if coverage says so, value is null, OR fake-zero pattern
      if (!skipCards && cards !== null && !cardsFakeZero && usedCards.length < 5) {
        usedCards.push({ fxId: fx.id, leagueId: fx.league_id, value: cards });
      } else if (usedCards.length < 5) {
        if (skipCards) {
          console.log(`[stats] 🚫 Skipping fixture ${fx.id} for cards (league ${fx.league_id}) – coverage skip`);
        } else if (cards === null) {
          console.log(`[stats] 🚫 Skipping fixture ${fx.id} for cards (league ${fx.league_id}) – null value`);
        } else if (cardsFakeZero) {
          console.log(`[stats] 🚫 Skipping fixture ${fx.id} for cards (league ${fx.league_id}) – fake-zero pattern`);
        }
      }
      
      // Fouls: skip if coverage says so, value is null, OR fake-zero pattern
      if (!skipFouls && fouls !== null && !foulsFakeZero && usedFouls.length < 5) {
        usedFouls.push({ fxId: fx.id, leagueId: fx.league_id, value: fouls });
      } else if (usedFouls.length < 5) {
        if (skipFouls) {
          console.log(`[stats] 🚫 Skipping fixture ${fx.id} for fouls (league ${fx.league_id}) – coverage skip`);
        } else if (fouls === null) {
          console.log(`[stats] 🚫 Skipping fixture ${fx.id} for fouls (league ${fx.league_id}) – null value`);
        } else if (foulsFakeZero) {
          console.log(`[stats] 🚫 Skipping fixture ${fx.id} for fouls (league ${fx.league_id}) – fake-zero pattern`);
        }
      }
      
      // Offsides: skip if coverage says so, value is null, OR fake-zero pattern
      if (!skipOffsides && offsides !== null && !offsidesFakeZero && usedOffsides.length < 5) {
        usedOffsides.push({ fxId: fx.id, leagueId: fx.league_id, value: offsides });
      } else if (usedOffsides.length < 5) {
        if (skipOffsides) {
          console.log(`[stats] 🚫 Skipping fixture ${fx.id} for offsides (league ${fx.league_id}) – coverage skip`);
        } else if (offsides === null) {
          console.log(`[stats] 🚫 Skipping fixture ${fx.id} for offsides (league ${fx.league_id}) – null value`);
        } else if (offsidesFakeZero) {
          console.log(`[stats] 🚫 Skipping fixture ${fx.id} for offsides (league ${fx.league_id}) – fake-zero pattern`);
        }
      }
      
    } catch (error) {
      console.error(`[stats] ❌ Error fetching stats for fixture ${fx.id}:`, error);
    }
  }
  
  // Compute averages per metric
  const avg = (arr: MetricFixture[]) =>
    arr.length ? arr.reduce((sum, f) => sum + f.value, 0) / arr.length : 0;
  
  const goalsAvg = avg(usedGoals);
  const cornersAvg = avg(usedCorners);
  const cardsAvg = avg(usedCards);
  const foulsAvg = avg(usedFouls);
  const offsidesAvg = avg(usedOffsides);
  
  const result: Last5Result = {
    team_id: teamId,
    goals: goalsAvg,
    corners: cornersAvg,
    cards: cardsAvg,
    fouls: foulsAvg,
    offsides: offsidesAvg,
    sample_size: usedGoals.length, // based on goals (always most reliable)
    last_five_fixture_ids: usedGoals.map(f => f.fxId), // based on goals fixtures
    last_final_fixture: usedGoals[0]?.fxId ?? null,
    computed_at: new Date().toISOString(),
    source: "api-football",
  };
  
  // DETAILED DEBUG LOGS
  console.log(`[stats] 📋 Final metric fixtures for team ${teamId}:`);
  console.log(`[stats]   Goals from fixtures: ${usedGoals.map(f => f.fxId).join(', ')}`);
  console.log(`[stats]   Corners from fixtures: ${usedCorners.map(f => f.fxId).join(', ')}`);
  console.log(`[stats]   Cards from fixtures: ${usedCards.map(f => f.fxId).join(', ')}`);
  console.log(`[stats]   Fouls from fixtures: ${usedFouls.map(f => f.fxId).join(', ')}`);
  console.log(`[stats]   Offsides from fixtures: ${usedOffsides.map(f => f.fxId).join(', ')}`);
  
  console.log(`[stats] ✅ Team ${teamId} FINAL AVERAGES:`);
  console.log(`[stats]   Goals: ${result.goals.toFixed(2)} (${usedGoals.length} fixtures)`);
  console.log(`[stats]   Corners: ${result.corners.toFixed(2)} (${usedCorners.length} fixtures)`);
  console.log(`[stats]   Cards: ${result.cards.toFixed(2)} (${usedCards.length} fixtures)`);
  console.log(`[stats]   Fouls: ${result.fouls.toFixed(2)} (${usedFouls.length} fixtures)`);
  console.log(`[stats]   Offsides: ${result.offsides.toFixed(2)} (${usedOffsides.length} fixtures)`);
  
  // Validation warnings
  if (usedGoals.length < 3) {
    console.warn(`[stats] ⚠️ Team ${teamId} has only ${usedGoals.length} goal samples (min 3 recommended)`);
  }
  
  if (usedCorners.length < 3) {
    console.warn(`[stats] ⚠️ Team ${teamId} has limited corners data: ${usedCorners.length} fixtures`);
  }
  
  if (result.goals < 0.5 && usedGoals.length >= 3) {
    console.warn(`[stats] ⚠️ Team ${teamId} has unusually low goals average: ${result.goals.toFixed(2)}`);
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
