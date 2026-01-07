import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

/**
 * BTTS Index Edge Function
 * 
 * Returns teams ranked by Both Teams To Score percentage
 * over their last N finished games (5, 10, or 15 matches).
 * 
 * Supports two modes:
 * 1. league_rankings - Get all teams in a league ranked by BTTS rate
 * 2. fixture - Get BTTS stats for both teams in a specific fixture
 * 
 * 100% Postgres-based - NO external API calls.
 */

type Mode = 'league_rankings' | 'fixture';

// Supported 1st and 2nd division leagues (EN/ES/FR/IT/DE)
const SUPPORTED_LEAGUES: Record<number, { name: string; country: string }> = {
  // England
  39: { name: "Premier League", country: "England" },
  40: { name: "Championship", country: "England" },
  // Spain
  140: { name: "La Liga", country: "Spain" },
  141: { name: "La Liga 2", country: "Spain" },
  // Germany
  78: { name: "Bundesliga", country: "Germany" },
  79: { name: "2. Bundesliga", country: "Germany" },
  // Italy
  135: { name: "Serie A", country: "Italy" },
  136: { name: "Serie B", country: "Italy" },
  // France
  61: { name: "Ligue 1", country: "France" },
  62: { name: "Ligue 2", country: "France" },
};

const SUPPORTED_LEAGUE_IDS = Object.keys(SUPPORTED_LEAGUES).map(Number);

// Time window for data
const LOOKBACK_MONTHS = 18;

// Sample size thresholds for warnings
const SAMPLE_THRESHOLDS = {
  5: 5,   // Need 5 matches for window=5
  10: 7,  // Need 7 matches for window=10
  15: 10, // Need 10 matches for window=15
};

serve(async (req) => {
  const origin = req.headers.get("origin") || "*";

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handlePreflight(origin);
  }

  const startTime = Date.now();

  try {
    // Parse request body
    let body: { 
      mode?: Mode; 
      league_id?: number; 
      fixture_id?: number;
      window?: number;
    } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const mode: Mode = body.mode || 'league_rankings';
    const window = [5, 10, 15].includes(body.window || 10) ? (body.window || 10) : 10;

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (mode === 'fixture') {
      return await handleFixtureMode(supabase, body.fixture_id, window, origin, startTime);
    } else {
      return await handleLeagueRankingsMode(supabase, body.league_id, window, origin, startTime);
    }

  } catch (error) {
    console.error("[btts-index] Unexpected error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Unknown error",
      origin,
      500,
      req
    );
  }
});

async function handleLeagueRankingsMode(
  supabase: any,
  leagueId: number | undefined,
  window: number,
  origin: string,
  startTime: number
): Promise<Response> {
  // Validate league_id
  if (!leagueId || !SUPPORTED_LEAGUE_IDS.includes(leagueId)) {
    return errorResponse(
      `Invalid or unsupported league_id. Supported leagues: ${SUPPORTED_LEAGUE_IDS.join(", ")}`,
      origin,
      400
    );
  }

  const leagueInfo = SUPPORTED_LEAGUES[leagueId];
  console.log(`[btts-index] Generating BTTS ranking for league_id=${leagueId} (${leagueInfo.name}), window=${window}`);

  // First try to get from cached metrics table
  const { data: cachedMetrics, error: cacheError } = await supabase
    .from("team_btts_metrics")
    .select("*")
    .eq("league_id", leagueId);

  if (!cacheError && cachedMetrics && cachedMetrics.length > 0) {
    // Use cached data
    const teams = formatCachedMetrics(cachedMetrics, window);
    
    const duration = Date.now() - startTime;
    console.log(`[btts-index] Returned ${teams.length} teams from cache in ${duration}ms`);

    return jsonResponse({
      league_id: leagueId,
      league: leagueInfo,
      window,
      teams,
      source: "cache",
      generated_at: cachedMetrics[0]?.computed_at || new Date().toISOString(),
      duration_ms: duration,
    }, origin);
  }

  // Fallback: compute on-the-fly from fixture_results
  console.log(`[btts-index] No cached data, computing on-the-fly for league ${leagueId}`);
  const teams = await computeBTTSForLeague(supabase, leagueId, window);

  const duration = Date.now() - startTime;
  console.log(`[btts-index] Computed ${teams.length} teams on-the-fly in ${duration}ms`);

  return jsonResponse({
    league_id: leagueId,
    league: leagueInfo,
    window,
    teams,
    source: "computed",
    generated_at: new Date().toISOString(),
    duration_ms: duration,
  }, origin);
}

async function handleFixtureMode(
  supabase: any,
  fixtureId: number | undefined,
  window: number,
  origin: string,
  startTime: number
): Promise<Response> {
  if (!fixtureId) {
    return errorResponse("fixture_id is required for fixture mode", origin, 400);
  }

  console.log(`[btts-index] Getting BTTS for fixture_id=${fixtureId}, window=${window}`);

  // Fetch fixture details
  const { data: fixture, error: fixtureError } = await supabase
    .from("fixtures")
    .select("id, league_id, teams_home, teams_away")
    .eq("id", fixtureId)
    .single();

  if (fixtureError || !fixture) {
    return errorResponse(`Fixture not found: ${fixtureId}`, origin, 404);
  }

  const homeTeamId = parseInt(String(fixture.teams_home?.id));
  const awayTeamId = parseInt(String(fixture.teams_away?.id));
  const homeTeamName = fixture.teams_home?.name || `Team ${homeTeamId}`;
  const awayTeamName = fixture.teams_away?.name || `Team ${awayTeamId}`;
  const leagueId = fixture.league_id;

  // Check if league is supported
  const leagueInfo = SUPPORTED_LEAGUES[leagueId] || { name: "Unknown League", country: "Unknown" };

  // Get BTTS metrics for both teams (filter by league_id to avoid wrong data for promoted/relegated teams)
  const { data: homeMetrics } = await supabase
    .from("team_btts_metrics")
    .select("*")
    .eq("team_id", homeTeamId)
    .eq("league_id", leagueId)
    .single();

  const { data: awayMetrics } = await supabase
    .from("team_btts_metrics")
    .select("*")
    .eq("team_id", awayTeamId)
    .eq("league_id", leagueId)
    .single();

  // Format team data
  const homeTeam = formatTeamMetrics(homeTeamId, homeTeamName, homeMetrics, window);
  const awayTeam = formatTeamMetrics(awayTeamId, awayTeamName, awayMetrics, window);

  // Calculate combined BTTS index (average of both teams' rates)
  let combinedBttsIndex: number | null = null;
  if (homeTeam.btts_rate !== null && awayTeam.btts_rate !== null) {
    combinedBttsIndex = Math.round((homeTeam.btts_rate + awayTeam.btts_rate) / 2 * 100) / 100;
  } else if (homeTeam.btts_rate !== null) {
    combinedBttsIndex = homeTeam.btts_rate;
  } else if (awayTeam.btts_rate !== null) {
    combinedBttsIndex = awayTeam.btts_rate;
  }

  // Get league average BTTS rate
  const leagueBttsAvg = await getLeagueBttsAverage(supabase, leagueId);

  const duration = Date.now() - startTime;
  console.log(`[btts-index] Fixture ${fixtureId} BTTS index: ${combinedBttsIndex} in ${duration}ms`);

  return jsonResponse({
    fixture_id: fixtureId,
    league_id: leagueId,
    league: leagueInfo,
    home_team: homeTeam,
    away_team: awayTeam,
    combined_btts_index: combinedBttsIndex,
    league_btts_avg: leagueBttsAvg,
    window,
    generated_at: new Date().toISOString(),
    duration_ms: duration,
  }, origin);
}

function formatCachedMetrics(metrics: any[], window: number): any[] {
  const rateField = `btts_${window}_rate`;
  const countField = `btts_${window}`;
  const sampleField = `sample_${window}`;
  const threshold = SAMPLE_THRESHOLDS[window as keyof typeof SAMPLE_THRESHOLDS];

  return metrics
    .map(m => ({
      team_id: m.team_id,
      team_name: m.team_name,
      btts_rate: parseFloat(m[rateField]) || 0,
      btts_count: m[countField] || 0,
      matches: m[sampleField] || 0,
      sample_warning: (m[sampleField] || 0) < threshold ? "low_sample" : null,
    }))
    .sort((a, b) => b.btts_rate - a.btts_rate)
    .map((t, i) => ({ ...t, rank: i + 1 }));
}

function formatTeamMetrics(
  teamId: number,
  teamName: string,
  metrics: any | null,
  window: number
): any {
  if (!metrics) {
    return {
      id: teamId,
      name: teamName,
      btts_rate: null,
      btts_count: 0,
      matches: 0,
      sample_warning: "insufficient_data",
    };
  }

  const rateField = `btts_${window}_rate`;
  const countField = `btts_${window}`;
  const sampleField = `sample_${window}`;
  const threshold = SAMPLE_THRESHOLDS[window as keyof typeof SAMPLE_THRESHOLDS];
  const sample = metrics[sampleField] || 0;

  return {
    id: teamId,
    name: teamName,
    btts_rate: parseFloat(metrics[rateField]) || 0,
    btts_count: metrics[countField] || 0,
    matches: sample,
    sample_warning: sample < threshold ? "low_sample" : null,
  };
}

async function computeBTTSForLeague(
  supabase: any,
  leagueId: number,
  window: number
): Promise<any[]> {
  const lookbackDate = new Date();
  lookbackDate.setMonth(lookbackDate.getMonth() - LOOKBACK_MONTHS);
  const lookbackDateStr = lookbackDate.toISOString().split("T")[0];

  // Get current season start date
  const now = new Date();
  const seasonYear = now.getUTCFullYear();
  const seasonStartDate = new Date(Date.UTC(seasonYear, 7, 1)); // Aug = 7
  const currentSeasonDateStr = seasonStartDate.toISOString().split("T")[0];

  // Get teams in current season
  const { data: currentFixtures } = await supabase
    .from("fixtures")
    .select("teams_home, teams_away")
    .eq("league_id", leagueId)
    .gte("date", currentSeasonDateStr)
    .limit(1000);

  const currentSeasonTeams = new Set<number>();
  for (const f of currentFixtures || []) {
    const homeId = parseInt(String(f.teams_home?.id));
    const awayId = parseInt(String(f.teams_away?.id));
    if (!isNaN(homeId)) currentSeasonTeams.add(homeId);
    if (!isNaN(awayId)) currentSeasonTeams.add(awayId);
  }

  if (currentSeasonTeams.size === 0) {
    return [];
  }

  // Fetch finished matches
  const { data: matches } = await supabase
    .from("fixture_results")
    .select(`
      fixture_id,
      goals_home,
      goals_away,
      kickoff_at,
      fixtures!fixture_results_fixture_id_fkey(
        teams_home,
        teams_away
      )
    `)
    .eq("league_id", leagueId)
    .in("status", ["FT", "AET", "PEN"])
    .gte("kickoff_at", lookbackDateStr)
    .order("kickoff_at", { ascending: false })
    .limit(2000);

  // Build team stats
  const teamStats: Map<number, { 
    name: string; 
    matches: { btts: boolean; kickoff: string }[];
  }> = new Map();

  for (const match of matches || []) {
    const fixture = Array.isArray(match.fixtures) ? match.fixtures[0] : match.fixtures;
    if (!fixture) continue;

    const homeTeamId = parseInt(String(fixture.teams_home?.id));
    const awayTeamId = parseInt(String(fixture.teams_away?.id));
    const homeTeamName = fixture.teams_home?.name || `Team ${homeTeamId}`;
    const awayTeamName = fixture.teams_away?.name || `Team ${awayTeamId}`;

    if (isNaN(homeTeamId) || isNaN(awayTeamId)) continue;

    const btts = match.goals_home > 0 && match.goals_away > 0;

    // Add home team stats
    if (currentSeasonTeams.has(homeTeamId)) {
      if (!teamStats.has(homeTeamId)) {
        teamStats.set(homeTeamId, { name: homeTeamName, matches: [] });
      }
      teamStats.get(homeTeamId)!.matches.push({ btts, kickoff: match.kickoff_at });
    }

    // Add away team stats
    if (currentSeasonTeams.has(awayTeamId)) {
      if (!teamStats.has(awayTeamId)) {
        teamStats.set(awayTeamId, { name: awayTeamName, matches: [] });
      }
      teamStats.get(awayTeamId)!.matches.push({ btts, kickoff: match.kickoff_at });
    }
  }

  // Calculate BTTS rates
  const results: any[] = [];
  const threshold = SAMPLE_THRESHOLDS[window as keyof typeof SAMPLE_THRESHOLDS];

  for (const [teamId, stats] of teamStats) {
    stats.matches.sort((a, b) => 
      new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime()
    );
    const lastNMatches = stats.matches.slice(0, window);
    const sample = lastNMatches.length;
    const bttsCount = lastNMatches.filter(m => m.btts).length;
    const bttsRate = sample > 0 ? Math.round((bttsCount / sample) * 10000) / 100 : 0;

    results.push({
      team_id: teamId,
      team_name: stats.name,
      btts_rate: bttsRate,
      btts_count: bttsCount,
      matches: sample,
      sample_warning: sample < threshold ? "low_sample" : null,
    });
  }

  // Sort by BTTS rate descending
  results.sort((a, b) => b.btts_rate - a.btts_rate);
  results.forEach((t, i) => { t.rank = i + 1; });

  return results;
}

async function getLeagueBttsAverage(supabase: any, leagueId: number): Promise<number | null> {
  const lookbackDate = new Date();
  lookbackDate.setMonth(lookbackDate.getMonth() - 12);
  const lookbackDateStr = lookbackDate.toISOString().split("T")[0];

  const { data: matches, error } = await supabase
    .from("fixture_results")
    .select("goals_home, goals_away")
    .eq("league_id", leagueId)
    .in("status", ["FT", "AET", "PEN"])
    .gte("kickoff_at", lookbackDateStr)
    .limit(500);

  if (error || !matches || matches.length === 0) {
    return null;
  }

  const bttsMatches = matches.filter((m: any) => m.goals_home > 0 && m.goals_away > 0).length;
  return Math.round((bttsMatches / matches.length) * 10000) / 100;
}
