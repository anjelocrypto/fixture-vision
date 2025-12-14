import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

/**
 * WARS Edge Function (Cards/Fouls Ranking)
 * 
 * Returns teams ranked by average cards received OR fouls committed per match
 * over their last N finished games (all competitions).
 * 
 * 100% Postgres-based - NO external API calls.
 */

type Mode = 'cards' | 'fouls';

// Supported domestic leagues (same as Who Concedes / Scores)
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
// Get teams from last 8 MONTHS to capture both current season start (Aug 2025)
// and late 2024-25 season results for teams that may lack 2025-26 fixtures
const LOOKBACK_MONTHS = 18;
const CURRENT_SEASON_MONTHS = 8;

serve(async (req) => {
  const origin = req.headers.get("origin") || "*";

  if (req.method === "OPTIONS") {
    return handlePreflight(origin);
  }

  const startTime = Date.now();

  try {
    let body: { league_id?: number; max_matches?: number; mode?: Mode } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const leagueId = body.league_id;
    const maxMatches = Math.min(Math.max(body.max_matches || 10, 5), 20);
    const mode: Mode = body.mode === 'fouls' ? 'fouls' : 'cards';

    if (!leagueId || !SUPPORTED_LEAGUE_IDS.includes(leagueId)) {
      return errorResponse(
        `Invalid or unsupported league_id. Supported leagues: ${SUPPORTED_LEAGUE_IDS.join(", ")}`,
        origin,
        400,
        req
      );
    }

    const leagueInfo = SUPPORTED_LEAGUES[leagueId];

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[card-war] Generating ranking for league_id=${leagueId} (${leagueInfo.name}), max_matches=${maxMatches}, mode=${mode}`);

    // Calculate date boundaries
    const fullLookbackDate = new Date();
    fullLookbackDate.setMonth(fullLookbackDate.getMonth() - LOOKBACK_MONTHS);
    const fullLookbackDateStr = fullLookbackDate.toISOString().split("T")[0];

    // Define CURRENT SEASON as this season (2025-26) starting from Aug 1 of current year
    const now = new Date();
    const seasonYear = now.getUTCFullYear();
    const seasonStartDate = new Date(Date.UTC(seasonYear, 7, 1)); // Aug = 7 (0-based)
    const currentSeasonDateStr = seasonStartDate.toISOString().split("T")[0];

    // STEP 1: Get teams currently in the league based on THIS SEASON fixtures (2025-26)
    const { data: currentTeamsData, error: currentTeamsError } = await supabase
      .from("fixtures")
      .select("teams_home, teams_away")
      .eq("league_id", leagueId)
      .gte("date", currentSeasonDateStr)
      .limit(1000);

    if (currentTeamsError) {
      console.error("[card-war] Error fetching current teams:", currentTeamsError);
      return errorResponse("Failed to fetch current team data", origin, 500, req);
    }

    const currentSeasonTeams = new Set<number>();
    for (const fixture of currentTeamsData || []) {
      const homeTeamId = parseInt(String(fixture.teams_home?.id));
      const awayTeamId = parseInt(String(fixture.teams_away?.id));
      if (!isNaN(homeTeamId)) currentSeasonTeams.add(homeTeamId);
      if (!isNaN(awayTeamId)) currentSeasonTeams.add(awayTeamId);
    }

    console.log(`[card-war] Found ${currentSeasonTeams.size} teams in current season for league ${leagueId}`);

    if (currentSeasonTeams.size === 0) {
      return jsonResponse({
        league: { id: leagueId, name: leagueInfo.name, country: leagueInfo.country },
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
        fixture_id, league_id, cards_home, cards_away, fouls_home, fouls_away, kickoff_at, status,
        fixtures!inner(id, teams_home, teams_away)
      `)
      .eq("status", "FT")
      .eq("league_id", leagueId)
      .gte("kickoff_at", fullLookbackDateStr)
      .order("kickoff_at", { ascending: false })
      .limit(2000);

    if (matchError) {
      console.error("[card-war] Error fetching matches:", matchError);
      return errorResponse("Failed to fetch match data", origin, 500, req);
    }

    console.log(`[card-war] Fetched ${matchData?.length || 0} matches`);

    const teamStats: Map<number, { name: string; matches: { metricValue: number; kickoff: string }[] }> = new Map();

    for (const match of matchData || []) {
      const fixture = Array.isArray(match.fixtures) ? match.fixtures[0] : match.fixtures;
      if (!fixture) continue;
      
      const homeTeamId = parseInt(String(fixture.teams_home?.id));
      const awayTeamId = parseInt(String(fixture.teams_away?.id));
      const homeTeamName = fixture.teams_home?.name || `Team ${homeTeamId}`;
      const awayTeamName = fixture.teams_away?.name || `Team ${awayTeamId}`;

      if (isNaN(homeTeamId) || isNaN(awayTeamId)) continue;

      const homeMetricValue = mode === 'cards' ? match.cards_home : match.fouls_home;
      const awayMetricValue = mode === 'cards' ? match.cards_away : match.fouls_away;

      if (homeMetricValue == null || awayMetricValue == null) continue;

      if (currentSeasonTeams.has(homeTeamId)) {
        if (!teamStats.has(homeTeamId)) teamStats.set(homeTeamId, { name: homeTeamName, matches: [] });
        teamStats.get(homeTeamId)!.matches.push({ metricValue: homeMetricValue, kickoff: match.kickoff_at });
      }

      if (currentSeasonTeams.has(awayTeamId)) {
        if (!teamStats.has(awayTeamId)) teamStats.set(awayTeamId, { name: awayTeamName, matches: [] });
        teamStats.get(awayTeamId)!.matches.push({ metricValue: awayMetricValue, kickoff: match.kickoff_at });
      }
    }

    console.log(`[card-war] Found ${teamStats.size} unique teams`);

    const rankingResults: Array<{ rank: number; team_id: number; team_name: string; avg_value: number; total_value: number; matches_used: number }> = [];
    const MIN_MATCHES = 5;

    for (const [teamId, stats] of teamStats) {
      stats.matches.sort((a, b) => new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime());
      const lastNMatches = stats.matches.slice(0, maxMatches);

      if (lastNMatches.length < MIN_MATCHES) continue;

      const totalValue = lastNMatches.reduce((sum, m) => sum + m.metricValue, 0);
      const avgValue = Math.round((totalValue / lastNMatches.length) * 100) / 100;

      rankingResults.push({ rank: 0, team_id: teamId, team_name: stats.name, avg_value: avgValue, total_value: totalValue, matches_used: lastNMatches.length });
    }

    rankingResults.sort((a, b) => b.avg_value !== a.avg_value ? b.avg_value - a.avg_value : b.total_value - a.total_value);
    rankingResults.forEach((r, i) => { r.rank = i + 1; });

    const duration = Date.now() - startTime;
    console.log(`[card-war] Generated ${rankingResults.length} rankings in ${duration}ms (mode=${mode})`);

    return jsonResponse({
      league: { id: leagueId, name: leagueInfo.name, country: leagueInfo.country },
      rankings: rankingResults,
      max_matches: maxMatches,
      mode,
      generated_at: new Date().toISOString(),
      duration_ms: duration,
    }, origin);

  } catch (error) {
    console.error("[card-war] Unexpected error:", error);
    return errorResponse(error instanceof Error ? error.message : "Unknown error", origin, 500, req);
  }
});
