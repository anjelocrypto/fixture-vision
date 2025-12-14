import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

/**
 * Who Concedes / Scores? Edge Function
 * 
 * Returns teams ranked by average goals conceded OR scored per match
 * over their last 10 finished games (all competitions).
 * 
 * Supports two modes:
 * - 'concedes' (default): Teams ranked by goals conceded (worst defense first)
 * - 'scores': Teams ranked by goals scored (best attack first)
 * 
 * 100% Postgres-based - NO external API calls.
 */

type Mode = 'concedes' | 'scores';

// Supported leagues for v1 (England, Spain, Germany, Italy, Netherlands)
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

    // Fetch finished matches from fixture_results table
    // Use fixture_results.league_id (authoritative) instead of relying on fixtures.league_id
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
          league_id,
          teams_home,
          teams_away
        )
      `)
      .eq("status", "FT")
      .eq("league_id", leagueId) // Use fixture_results.league_id, not fixtures.league_id
      .order("kickoff_at", { ascending: false });

    if (matchError) {
      console.error("[who-concedes] Query error:", matchError);
      return errorResponse("Failed to fetch match data", origin, 500, req);
    }

    // Process in JavaScript - collect team stats from verified league matches
    const teamStats: Map<number, { 
      name: string; 
      matches: { metricValue: number; kickoff: string }[];
      leagueMatchCount: number; // Count of matches in the requested league
    }> = new Map();

    console.log(`[who-concedes] Processing ${matchData?.length || 0} matches in ${mode} mode`);

    for (const match of matchData || []) {
      // Handle both array and object formats from Supabase join
      const fixture = Array.isArray(match.fixtures) ? match.fixtures[0] : match.fixtures;
      if (!fixture) continue;
      
      const homeTeamId = parseInt(String(fixture.teams_home?.id));
      const awayTeamId = parseInt(String(fixture.teams_away?.id));
      const homeTeamName = fixture.teams_home?.name || `Team ${homeTeamId}`;
      const awayTeamName = fixture.teams_away?.name || `Team ${awayTeamId}`;

      if (isNaN(homeTeamId) || isNaN(awayTeamId)) continue;

      // Determine metric value based on mode
      // For 'concedes': home team uses goals_away, away team uses goals_home
      // For 'scores': home team uses goals_home, away team uses goals_away
      const homeMetricValue = mode === 'scores' ? match.goals_home : match.goals_away;
      const awayMetricValue = mode === 'scores' ? match.goals_away : match.goals_home;

      // Home team
      if (homeTeamId) {
        if (!teamStats.has(homeTeamId)) {
          teamStats.set(homeTeamId, { name: homeTeamName, matches: [], leagueMatchCount: 0 });
        }
        const stats = teamStats.get(homeTeamId)!;
        stats.matches.push({
          metricValue: homeMetricValue,
          kickoff: match.kickoff_at,
        });
        stats.leagueMatchCount++;
      }

      // Away team
      if (awayTeamId) {
        if (!teamStats.has(awayTeamId)) {
          teamStats.set(awayTeamId, { name: awayTeamName, matches: [], leagueMatchCount: 0 });
        }
        const stats = teamStats.get(awayTeamId)!;
        stats.matches.push({
          metricValue: awayMetricValue,
          kickoff: match.kickoff_at,
        });
        stats.leagueMatchCount++;
      }
    }

    console.log(`[who-concedes] Built stats for ${teamStats.size} unique teams`);

    // Calculate rankings
    const rankingResults: Array<{
      rank: number;
      team_id: number;
      team_name: string;
      avg_value: number;
      total_value: number;
      matches_used: number;
      // Backward compatibility fields
      avg_conceded?: number;
      total_conceded?: number;
      avg_scored?: number;
      total_scored?: number;
    }> = [];

    // Minimum matches required in the league to be included in rankings
    // Real top-division teams have ~20+ league matches per season
    // This filters out teams with fake/speculative placeholder data from future seasons
    // (e.g., Sunderland appearing in EPL with 7 fake 2025-26 matches)
    const MIN_LEAGUE_MATCHES = 15;

    for (const [teamId, stats] of teamStats) {
      // Filter out teams that don't have enough matches in this league
      // This prevents Championship teams appearing in EPL rankings due to bad data
      if (stats.leagueMatchCount < MIN_LEAGUE_MATCHES) {
        console.log(`[who-concedes] Skipping ${stats.name} (team_id=${teamId}): only ${stats.leagueMatchCount} matches in league ${leagueId}`);
        continue;
      }

      // Sort matches by date DESC and take last N
      stats.matches.sort((a, b) => 
        new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime()
      );
      const lastNMatches = stats.matches.slice(0, maxMatches);

      const totalValue = lastNMatches.reduce((sum, m) => sum + m.metricValue, 0);
      const avgValue = lastNMatches.length > 0 
        ? Math.round((totalValue / lastNMatches.length) * 100) / 100 
        : 0;

      const result: typeof rankingResults[0] = {
        rank: 0, // Will be assigned after sorting
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

    // Sort by avg_value DESC (highest value first - worst defense or best attack)
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
