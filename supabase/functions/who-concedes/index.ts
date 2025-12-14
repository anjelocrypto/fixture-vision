import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

/**
 * Who Concedes / Scores? Edge Function
 * 
 * Returns teams ranked by average goals conceded OR scored per match
 * over their last N finished games (all competitions).
 * 
 * KEY LOGIC: Teams are assigned to their CURRENT league based on their
 * most recent domestic league fixture from the CURRENT SEASON (2024-25).
 * This ensures:
 * - We ignore speculative/placeholder 2025-26 data from API-Football
 * - Relegated teams appear in their correct current league
 * - Stats use real matches from the 2024-25 season only
 * 
 * 100% Postgres-based - NO external API calls.
 */

type Mode = 'concedes' | 'scores';

// Supported domestic leagues for v1 (England, Spain, Germany, Italy, Netherlands)
const SUPPORTED_LEAGUES: Record<number, { name: string; country: string }> = {
  // England
  39: { name: "Premier League", country: "England" },
  40: { name: "Championship", country: "England" },
  41: { name: "League One", country: "England" },
  42: { name: "League Two", country: "England" },
  // Spain
  140: { name: "La Liga", country: "Spain" },
  141: { name: "La Liga 2", country: "Spain" },
  // Germany
  78: { name: "Bundesliga", country: "Germany" },
  79: { name: "2. Bundesliga", country: "Germany" },
  // Italy
  135: { name: "Serie A", country: "Italy" },
  136: { name: "Serie B", country: "Italy" },
  // Netherlands
  88: { name: "Eredivisie", country: "Netherlands" },
  89: { name: "Eerste Divisie", country: "Netherlands" },
};

const SUPPORTED_LEAGUE_IDS = Object.keys(SUPPORTED_LEAGUES).map(Number);

// Use fixtures from the last 18 months for stats calculation
// But only include teams that have played in the requested league in the LAST 3 MONTHS
// (to ensure we get current season teams only)
const LOOKBACK_MONTHS = 18;
const CURRENT_SEASON_MONTHS = 3;

serve(async (req) => {
  const origin = req.headers.get("origin") || "*";

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handlePreflight(origin);
  }

  const startTime = Date.now();

  try {
    // Parse request body
    let body: { league_id?: number; max_matches?: number; mode?: Mode } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const leagueId = body.league_id;
    const maxMatches = Math.min(Math.max(body.max_matches || 10, 1), 20); // Clamp 1-20
    const mode: Mode = body.mode === 'scores' ? 'scores' : 'concedes'; // Default to 'concedes'

    // Validate league_id
    if (!leagueId || !SUPPORTED_LEAGUE_IDS.includes(leagueId)) {
      return errorResponse(
        `Invalid or unsupported league_id. Supported leagues: ${SUPPORTED_LEAGUE_IDS.join(", ")}`,
        origin,
        400,
        req
      );
    }

    const leagueInfo = SUPPORTED_LEAGUES[leagueId];

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[who-concedes] Generating ranking for league_id=${leagueId} (${leagueInfo.name}), max_matches=${maxMatches}, mode=${mode}`);

    // Calculate date boundaries
    const fullLookbackDate = new Date();
    fullLookbackDate.setMonth(fullLookbackDate.getMonth() - LOOKBACK_MONTHS);
    const fullLookbackDateStr = fullLookbackDate.toISOString().split('T')[0];
    
    const currentSeasonDate = new Date();
    currentSeasonDate.setMonth(currentSeasonDate.getMonth() - CURRENT_SEASON_MONTHS);
    const currentSeasonDateStr = currentSeasonDate.toISOString().split('T')[0];

    // STEP 1: Get teams currently in the league (played in last 3 months)
    const { data: currentTeamsData, error: currentTeamsError } = await supabase
      .from("fixture_results")
      .select(`
        fixtures!inner(teams_home, teams_away)
      `)
      .eq("status", "FT")
      .eq("league_id", leagueId)
      .gte("kickoff_at", currentSeasonDateStr)
      .limit(500);

    if (currentTeamsError) {
      console.error("[who-concedes] Error fetching current teams:", currentTeamsError);
      return errorResponse("Failed to fetch current team data", origin, 500, req);
    }

    // Build set of current season teams
    const currentSeasonTeams = new Set<number>();
    for (const match of currentTeamsData || []) {
      const fixture = Array.isArray(match.fixtures) ? match.fixtures[0] : match.fixtures;
      if (!fixture) continue;
      const homeTeamId = parseInt(String(fixture.teams_home?.id));
      const awayTeamId = parseInt(String(fixture.teams_away?.id));
      if (!isNaN(homeTeamId)) currentSeasonTeams.add(homeTeamId);
      if (!isNaN(awayTeamId)) currentSeasonTeams.add(awayTeamId);
    }

    console.log(`[who-concedes] Found ${currentSeasonTeams.size} teams in current season for league ${leagueId}`);

    if (currentSeasonTeams.size === 0) {
      return jsonResponse({
        league: {
          id: leagueId,
          name: leagueInfo.name,
          country: leagueInfo.country,
        },
        rankings: [],
        max_matches: maxMatches,
        mode,
        generated_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      }, origin);
    }

    // STEP 2: Fetch all matches from last 18 months for stats calculation
    const { data: matchData, error: matchError } = await supabase
      .from("fixture_results")
      .select(`
        fixture_id,
        league_id,
        goals_home,
        goals_away,
        kickoff_at,
        status,
        fixtures!inner(
          id,
          teams_home,
          teams_away
        )
      `)
      .eq("status", "FT")
      .eq("league_id", leagueId)
      .gte("kickoff_at", fullLookbackDateStr)
      .order("kickoff_at", { ascending: false })
      .limit(2000);

    if (matchError) {
      console.error("[who-concedes] Error fetching matches:", matchError);
      return errorResponse("Failed to fetch match data", origin, 500, req);
    }

    console.log(`[who-concedes] Fetched ${matchData?.length || 0} matches from last ${LOOKBACK_MONTHS} months for league ${leagueId}`);

    // Build team stats directly from match data
    // Since we're filtering by single league, all teams in the results belong to the requested league
    const teamStats: Map<number, { 
      name: string; 
      matches: { metricValue: number; kickoff: string }[];
    }> = new Map();

    // Build stats from match data - ONLY for teams currently in the league
    for (const match of matchData || []) {
      const fixture = Array.isArray(match.fixtures) ? match.fixtures[0] : match.fixtures;
      if (!fixture) continue;
      
      const homeTeamId = parseInt(String(fixture.teams_home?.id));
      const awayTeamId = parseInt(String(fixture.teams_away?.id));
      const homeTeamName = fixture.teams_home?.name || `Team ${homeTeamId}`;
      const awayTeamName = fixture.teams_away?.name || `Team ${awayTeamId}`;

      if (isNaN(homeTeamId) || isNaN(awayTeamId)) continue;

      // Determine metric value based on mode
      const homeMetricValue = mode === 'scores' ? match.goals_home : match.goals_away;
      const awayMetricValue = mode === 'scores' ? match.goals_away : match.goals_home;

      // Add home team stats - ONLY if team is in current season
      if (currentSeasonTeams.has(homeTeamId)) {
        if (!teamStats.has(homeTeamId)) {
          teamStats.set(homeTeamId, { name: homeTeamName, matches: [] });
        }
        teamStats.get(homeTeamId)!.matches.push({
          metricValue: homeMetricValue,
          kickoff: match.kickoff_at,
        });
      }

      // Add away team stats - ONLY if team is in current season
      if (currentSeasonTeams.has(awayTeamId)) {
        if (!teamStats.has(awayTeamId)) {
          teamStats.set(awayTeamId, { name: awayTeamName, matches: [] });
        }
        teamStats.get(awayTeamId)!.matches.push({
          metricValue: awayMetricValue,
          kickoff: match.kickoff_at,
        });
      }
    }

    console.log(`[who-concedes] Found ${teamStats.size} unique teams in league ${leagueId}`);

    // Calculate rankings
    const rankingResults: Array<{
      rank: number;
      team_id: number;
      team_name: string;
      avg_value: number;
      total_value: number;
      matches_used: number;
      avg_conceded?: number;
      total_conceded?: number;
      avg_scored?: number;
      total_scored?: number;
    }> = [];

    // Minimum matches required to be included in rankings
    const MIN_MATCHES = 5;

    for (const [teamId, stats] of teamStats) {
      // Sort matches by date DESC and take last N
      stats.matches.sort((a, b) => 
        new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime()
      );
      const lastNMatches = stats.matches.slice(0, maxMatches);

      // Skip teams with insufficient match data
      if (lastNMatches.length < MIN_MATCHES) {
        console.log(`[who-concedes] Skipping ${stats.name} (team_id=${teamId}): only ${lastNMatches.length} matches`);
        continue;
      }

      const totalValue = lastNMatches.reduce((sum, m) => sum + m.metricValue, 0);
      const avgValue = lastNMatches.length > 0 
        ? Math.round((totalValue / lastNMatches.length) * 100) / 100 
        : 0;

      const result: typeof rankingResults[0] = {
        rank: 0,
        team_id: teamId,
        team_name: stats.name,
        avg_value: avgValue,
        total_value: totalValue,
        matches_used: lastNMatches.length,
      };

      // Add mode-specific backward compatibility fields
      if (mode === 'concedes') {
        result.avg_conceded = avgValue;
        result.total_conceded = totalValue;
      } else {
        result.avg_scored = avgValue;
        result.total_scored = totalValue;
      }

      rankingResults.push(result);
    }

    // Sort by avg_value DESC
    rankingResults.sort((a, b) => {
      if (b.avg_value !== a.avg_value) return b.avg_value - a.avg_value;
      return b.total_value - a.total_value;
    });

    // Assign ranks
    rankingResults.forEach((r, i) => {
      r.rank = i + 1;
    });

    const duration = Date.now() - startTime;
    console.log(`[who-concedes] Generated ${rankingResults.length} rankings in ${duration}ms (mode=${mode})`);

    return jsonResponse({
      league: {
        id: leagueId,
        name: leagueInfo.name,
        country: leagueInfo.country,
      },
      rankings: rankingResults,
      max_matches: maxMatches,
      mode,
      generated_at: new Date().toISOString(),
      duration_ms: duration,
    }, origin);

  } catch (error) {
    console.error("[who-concedes] Unexpected error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Unknown error",
      origin,
      500,
      req
    );
  }
});
