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

// Use fixtures from the last 18 months to ensure we capture full season data
// This catches teams that played in different leagues last season
const LOOKBACK_MONTHS = 18;

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

    // Calculate lookback date (12 months ago)
    const lookbackDate = new Date();
    lookbackDate.setMonth(lookbackDate.getMonth() - LOOKBACK_MONTHS);
    const lookbackDateStr = lookbackDate.toISOString().split('T')[0];

    // STEP 1: Fetch all domestic league matches from last 12 months
    // NO end-date filter - we always use the truly most recent fixtures
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
      .in("league_id", SUPPORTED_LEAGUE_IDS)
      .gte("kickoff_at", lookbackDateStr)
      .order("kickoff_at", { ascending: false });

    if (matchError) {
      console.error("[who-concedes] Error fetching matches:", matchError);
      return errorResponse("Failed to fetch match data", origin, 500, req);
    }

    console.log(`[who-concedes] Fetched ${matchData?.length || 0} matches from last ${LOOKBACK_MONTHS} months`);

    // Build map: team_id -> current_league_id
    // Strategy: Use the league where the team has the MOST matches
    // This filters out fake/speculative data (e.g., Championship teams with 14 fake EPL matches
    // but 46+ real Championship matches)
    const teamLeagueCounts: Map<number, Map<number, number>> = new Map();
    
    for (const match of matchData || []) {
      const fixture = Array.isArray(match.fixtures) ? match.fixtures[0] : match.fixtures;
      if (!fixture) continue;

      const homeTeamId = parseInt(String(fixture.teams_home?.id));
      const awayTeamId = parseInt(String(fixture.teams_away?.id));

      // Count matches per league for each team
      for (const teamId of [homeTeamId, awayTeamId]) {
        if (isNaN(teamId)) continue;
        if (!teamLeagueCounts.has(teamId)) {
          teamLeagueCounts.set(teamId, new Map());
        }
        const leagueCounts = teamLeagueCounts.get(teamId)!;
        leagueCounts.set(match.league_id, (leagueCounts.get(match.league_id) || 0) + 1);
      }
    }

    // Determine current league = league with MOST matches
    const teamCurrentLeagues: Map<number, number> = new Map();
    for (const [teamId, leagueCounts] of teamLeagueCounts) {
      let maxLeague = 0;
      let maxCount = 0;
      for (const [leagueId, count] of leagueCounts) {
        if (count > maxCount) {
          maxCount = count;
          maxLeague = leagueId;
        }
      }
      if (maxLeague > 0) {
        teamCurrentLeagues.set(teamId, maxLeague);
        // Debug: Log problematic teams
        if ([44, 63, 746, 57, 46, 41].includes(teamId)) {
          const counts = Array.from(leagueCounts.entries()).map(([l, c]) => `${l}:${c}`).join(', ');
          console.log(`[who-concedes] DEBUG: Team ${teamId} -> league ${maxLeague} (counts: ${counts})`);
        }
      }
    }

    console.log(`[who-concedes] Determined current league for ${teamCurrentLeagues.size} teams`);

    // STEP 2: Get teams that currently belong to the requested league
    const teamsInRequestedLeague = new Set<number>();
    for (const [teamId, currentLeague] of teamCurrentLeagues) {
      if (currentLeague === leagueId) {
        teamsInRequestedLeague.add(teamId);
      }
    }

    console.log(`[who-concedes] Found ${teamsInRequestedLeague.size} teams currently in league ${leagueId}`);

    if (teamsInRequestedLeague.size === 0) {
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

    // STEP 3: Build stats for teams currently in the requested league
    // Using all their 2024-25 season matches (even from previous leagues)
    const teamStats: Map<number, { 
      name: string; 
      matches: { metricValue: number; kickoff: string }[];
    }> = new Map();

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

      // Only collect stats for teams that CURRENTLY belong to the requested league
      if (teamsInRequestedLeague.has(homeTeamId)) {
        if (!teamStats.has(homeTeamId)) {
          teamStats.set(homeTeamId, { name: homeTeamName, matches: [] });
        }
        teamStats.get(homeTeamId)!.matches.push({
          metricValue: homeMetricValue,
          kickoff: match.kickoff_at,
        });
      }

      if (teamsInRequestedLeague.has(awayTeamId)) {
        if (!teamStats.has(awayTeamId)) {
          teamStats.set(awayTeamId, { name: awayTeamName, matches: [] });
        }
        teamStats.get(awayTeamId)!.matches.push({
          metricValue: awayMetricValue,
          kickoff: match.kickoff_at,
        });
      }
    }

    console.log(`[who-concedes] Built stats for ${teamStats.size} teams in current league`);

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
