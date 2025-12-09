import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

/**
 * Who Concedes? Edge Function
 * 
 * Returns teams ranked by average goals conceded per match
 * over their last 10 finished games (all competitions).
 * 
 * 100% Postgres-based - NO external API calls.
 */

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
    let body: { league_id?: number; max_matches?: number } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const leagueId = body.league_id;
    const maxMatches = Math.min(Math.max(body.max_matches || 10, 1), 20); // Clamp 1-20

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

    console.log(`[who-concedes] Generating ranking for league_id=${leagueId} (${leagueInfo.name}), max_matches=${maxMatches}`);

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
      matches: { conceded: number; kickoff: string; leagueId: number }[] 
    }> = new Map();

    console.log(`[who-concedes] Processing ${matchData?.length || 0} matches`);

    for (const match of matchData || []) {
      // Handle both array and object formats from Supabase join
      const fixture = Array.isArray(match.fixtures) ? match.fixtures[0] : match.fixtures;
      if (!fixture) continue;
      
      const homeTeamId = parseInt(String(fixture.teams_home?.id));
      const awayTeamId = parseInt(String(fixture.teams_away?.id));
      const homeTeamName = fixture.teams_home?.name || `Team ${homeTeamId}`;
      const awayTeamName = fixture.teams_away?.name || `Team ${awayTeamId}`;

      if (isNaN(homeTeamId) || isNaN(awayTeamId)) continue;

      // Home team conceded goals_away
      if (homeTeamId) {
        if (!teamStats.has(homeTeamId)) {
          teamStats.set(homeTeamId, { name: homeTeamName, matches: [] });
        }
        teamStats.get(homeTeamId)!.matches.push({
          conceded: match.goals_away,
          kickoff: match.kickoff_at,
          leagueId: fixture.league_id,
        });
      }

      // Away team conceded goals_home
      if (awayTeamId) {
        if (!teamStats.has(awayTeamId)) {
          teamStats.set(awayTeamId, { name: awayTeamName, matches: [] });
        }
        teamStats.get(awayTeamId)!.matches.push({
          conceded: match.goals_home,
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
        avg_conceded: number;
        total_conceded: number;
        matches_used: number;
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

        const totalConceded = lastNMatches.reduce((sum, m) => sum + m.conceded, 0);
        const avgConceded = lastNMatches.length > 0 
          ? Math.round((totalConceded / lastNMatches.length) * 100) / 100 
          : 0;

        rankingResults.push({
          rank: 0, // Will be assigned after sorting
          team_id: teamId,
          team_name: stats.name,
          avg_conceded: avgConceded,
          total_conceded: totalConceded,
          matches_used: lastNMatches.length,
        });
      }

      // Sort by avg_conceded DESC (worst defense first)
      rankingResults.sort((a, b) => {
        if (b.avg_conceded !== a.avg_conceded) return b.avg_conceded - a.avg_conceded;
        return b.total_conceded - a.total_conceded;
      });

      // Assign ranks
      rankingResults.forEach((r, i) => {
        r.rank = i + 1;
      });

    const duration = Date.now() - startTime;
    console.log(`[who-concedes] Generated ${rankingResults.length} rankings in ${duration}ms`);

    return jsonResponse({
      league: {
        id: leagueId,
        name: leagueInfo.name,
        country: leagueInfo.country,
      },
      rankings: rankingResults,
      max_matches: maxMatches,
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
