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

    // Fetch finished matches - filter by league_id to stay within Supabase's row limits
    // We get all matches from the requested league (sufficient for ranking that league's teams)
    const { data: matchData, error: matchError } = await supabase
      .from("fixture_results")
      .select(`
        fixture_id,
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
      .eq("fixtures.league_id", leagueId)
      .order("kickoff_at", { ascending: false });

    if (matchError) {
      console.error("[who-concedes] Query error:", matchError);
      return errorResponse("Failed to fetch match data", origin, 500, req);
    }

    // Process in JavaScript
    const teamStats: Map<number, { 
      name: string; 
      matches: { metricValue: number; kickoff: string; leagueId: number }[] 
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
          teamStats.set(homeTeamId, { name: homeTeamName, matches: [] });
        }
        teamStats.get(homeTeamId)!.matches.push({
          metricValue: homeMetricValue,
          kickoff: match.kickoff_at,
          leagueId: fixture.league_id,
        });
      }

      // Away team
      if (awayTeamId) {
        if (!teamStats.has(awayTeamId)) {
          teamStats.set(awayTeamId, { name: awayTeamName, matches: [] });
        }
        teamStats.get(awayTeamId)!.matches.push({
          metricValue: awayMetricValue,
          kickoff: match.kickoff_at,
          leagueId: fixture.league_id,
        });
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

    for (const [teamId, stats] of teamStats) {
      // Sort matches by date DESC and take last N
      stats.matches.sort((a, b) => 
        new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime()
      );
      const lastNMatches = stats.matches.slice(0, maxMatches);

      // Determine primary league (from most recent match)
      const primaryLeagueId = lastNMatches[0]?.leagueId;

      // Only include teams whose primary league matches requested league
      if (primaryLeagueId !== leagueId) continue;

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
