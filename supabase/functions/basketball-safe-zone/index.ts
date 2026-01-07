import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Basketball Safe Zone Edge Function v1.0
 * 
 * Returns upcoming basketball games ranked by probability of high total points
 * Uses NBA API and Basketball API endpoints
 * 
 * Endpoints used:
 * - NBA: https://v2.nba.api-sports.io
 * - Basketball: https://v1.basketball.api-sports.io
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Supported leagues
const SUPPORTED_LEAGUES = {
  // NBA API
  nba: { id: 12, name: "NBA", api: "nba", avg_total: 225 },
  nba_gleague: { id: 20, name: "G-League", api: "nba", avg_total: 220 },
  // Basketball API (international)
  euroleague: { id: 120, name: "EuroLeague", api: "basketball", avg_total: 160 },
  eurocup: { id: 121, name: "EuroCup", api: "basketball", avg_total: 158 },
  spain_acb: { id: 117, name: "Spain ACB", api: "basketball", avg_total: 165 },
  germany_bbl: { id: 43, name: "Germany BBL", api: "basketball", avg_total: 165 },
  italy_lba: { id: 82, name: "Italy Lega A", api: "basketball", avg_total: 162 },
  france_prob: { id: 40, name: "France Pro B", api: "basketball", avg_total: 160 },
};

const NBA_BASE = "https://v2.nba.api-sports.io";
const BASKETBALL_BASE = "https://v1.basketball.api-sports.io";

interface BasketballSafeZoneRequest {
  league_key: string;  // e.g. "nba", "euroleague"
  days_ahead?: number; // 1-7, default 3
  limit?: number;      // max games to return
}

interface TeamSeasonStats {
  team_id: number;
  points_for: number;
  points_against: number;
  games_played: number;
}

interface GameResult {
  game_id: number;
  league_key: string;
  league_name: string;
  date: string;
  time: string;
  home_team: string;
  home_team_id: number;
  away_team: string;
  away_team_id: number;
  home_ppg: number;
  away_ppg: number;
  home_papg: number;
  away_papg: number;
  mu_points: number;
  book_line: number | null;
  safe_zone_prob: number;
  data_quality: "high" | "medium" | "low";
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// Fetch games from NBA API
async function fetchNBAGames(apiKey: string, daysAhead: number): Promise<any[]> {
  const games: any[] = [];
  const now = new Date();
  
  for (let d = 0; d <= daysAhead; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().split('T')[0];
    
    try {
      const response = await fetch(`${NBA_BASE}/games?date=${dateStr}`, {
        headers: { "x-apisports-key": apiKey }
      });
      
      if (!response.ok) {
        console.warn(`[basketball-safe-zone] NBA API error for ${dateStr}: ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      if (data.response && Array.isArray(data.response)) {
        // Filter for scheduled games only (not finished)
        const upcoming = data.response.filter((g: any) => 
          g.status?.short !== "FT" && g.status?.short !== "AOT"
        );
        games.push(...upcoming.map((g: any) => ({
          ...g,
          api: "nba",
          league_key: g.league?.id === 20 ? "nba_gleague" : "nba"
        })));
      }
    } catch (err) {
      console.error(`[basketball-safe-zone] Error fetching NBA games for ${dateStr}:`, err);
    }
  }
  
  return games;
}

// Fetch games from Basketball API (international)
async function fetchBasketballGames(apiKey: string, leagueId: number, leagueKey: string, daysAhead: number): Promise<any[]> {
  const games: any[] = [];
  const now = new Date();
  
  for (let d = 0; d <= daysAhead; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().split('T')[0];
    
    try {
      const response = await fetch(`${BASKETBALL_BASE}/games?league=${leagueId}&date=${dateStr}`, {
        headers: { "x-apisports-key": apiKey }
      });
      
      if (!response.ok) {
        console.warn(`[basketball-safe-zone] Basketball API error: ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      if (data.response && Array.isArray(data.response)) {
        // Filter for scheduled games
        const upcoming = data.response.filter((g: any) => 
          g.status?.short !== "FT" && g.status?.short !== "AOT"
        );
        games.push(...upcoming.map((g: any) => ({
          ...g,
          api: "basketball",
          league_key: leagueKey
        })));
      }
    } catch (err) {
      console.error(`[basketball-safe-zone] Error fetching basketball games:`, err);
    }
  }
  
  return games;
}

// Get team season stats from NBA API
async function getNBATeamStats(apiKey: string, teamId: number, season: number): Promise<TeamSeasonStats | null> {
  try {
    const response = await fetch(`${NBA_BASE}/teams/statistics?id=${teamId}&season=${season}`, {
      headers: { "x-apisports-key": apiKey }
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    if (!data.response || data.response.length === 0) return null;
    
    const stats = data.response[0];
    return {
      team_id: teamId,
      points_for: stats.points?.for?.average?.all || 110,
      points_against: stats.points?.against?.average?.all || 110,
      games_played: stats.games?.played?.all || 0,
    };
  } catch (err) {
    console.error(`[basketball-safe-zone] Error fetching NBA team stats:`, err);
    return null;
  }
}

// Get team season stats from Basketball API
async function getBasketballTeamStats(apiKey: string, teamId: number, leagueId: number, season: string): Promise<TeamSeasonStats | null> {
  try {
    const response = await fetch(`${BASKETBALL_BASE}/statistics?team=${teamId}&league=${leagueId}&season=${season}`, {
      headers: { "x-apisports-key": apiKey }
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    if (!data.response || data.response.length === 0) return null;
    
    const stats = data.response[0];
    return {
      team_id: teamId,
      points_for: stats.points?.for?.average?.all || 80,
      points_against: stats.points?.against?.average?.all || 80,
      games_played: stats.games?.played?.all || 0,
    };
  } catch (err) {
    console.error(`[basketball-safe-zone] Error fetching basketball team stats:`, err);
    return null;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body: BasketballSafeZoneRequest = await req.json();
    const { league_key, days_ahead = 3, limit = 20 } = body;

    // Validate league
    const leagueConfig = SUPPORTED_LEAGUES[league_key as keyof typeof SUPPORTED_LEAGUES];
    if (!leagueConfig) {
      return new Response(
        JSON.stringify({ 
          error: `Unsupported league: ${league_key}. Supported: ${Object.keys(SUPPORTED_LEAGUES).join(", ")}` 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("API_FOOTBALL_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "API_FOOTBALL_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[basketball-safe-zone] Fetching games for ${league_key}, days_ahead=${days_ahead}`);

    // Fetch games based on API type
    let games: any[] = [];
    const currentSeason = new Date().getFullYear();
    const basketballSeason = `${currentSeason - 1}-${currentSeason}`;

    if (leagueConfig.api === "nba") {
      games = await fetchNBAGames(apiKey, days_ahead);
      // Filter to requested league
      games = games.filter(g => g.league_key === league_key);
    } else {
      games = await fetchBasketballGames(apiKey, leagueConfig.id, league_key, days_ahead);
    }

    console.log(`[basketball-safe-zone] Found ${games.length} upcoming games`);

    if (games.length === 0) {
      return new Response(
        JSON.stringify({
          league_key,
          league_name: leagueConfig.name,
          games: [],
          meta: {
            generated_at: new Date().toISOString(),
            days_ahead,
            note: "No upcoming games found"
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Collect unique team IDs and fetch stats
    const teamIds = new Set<number>();
    for (const game of games) {
      if (leagueConfig.api === "nba") {
        teamIds.add(game.teams?.home?.id);
        teamIds.add(game.teams?.visitors?.id);
      } else {
        teamIds.add(game.teams?.home?.id);
        teamIds.add(game.teams?.away?.id);
      }
    }

    // Fetch team stats (batch)
    const teamStatsMap = new Map<number, TeamSeasonStats>();
    
    for (const teamId of teamIds) {
      if (!teamId) continue;
      
      let stats: TeamSeasonStats | null = null;
      if (leagueConfig.api === "nba") {
        stats = await getNBATeamStats(apiKey, teamId, currentSeason);
      } else {
        stats = await getBasketballTeamStats(apiKey, teamId, leagueConfig.id, basketballSeason);
      }
      
      if (stats) {
        teamStatsMap.set(teamId, stats);
      }
    }

    console.log(`[basketball-safe-zone] Fetched stats for ${teamStatsMap.size} teams`);

    // Calculate probabilities for each game
    const results: GameResult[] = [];
    
    for (const game of games) {
      const isNBA = leagueConfig.api === "nba";
      const homeTeamId = isNBA ? game.teams?.home?.id : game.teams?.home?.id;
      const awayTeamId = isNBA ? game.teams?.visitors?.id : game.teams?.away?.id;
      const homeTeamName = isNBA ? game.teams?.home?.name : game.teams?.home?.name;
      const awayTeamName = isNBA ? game.teams?.visitors?.name : game.teams?.away?.name;
      
      const homeStats = teamStatsMap.get(homeTeamId);
      const awayStats = teamStatsMap.get(awayTeamId);
      
      // Default to league average if no stats
      const defaultPPG = leagueConfig.avg_total / 2;
      
      const homePPG = homeStats?.points_for || defaultPPG;
      const homePAPG = homeStats?.points_against || defaultPPG;
      const awayPPG = awayStats?.points_for || defaultPPG;
      const awayPAPG = awayStats?.points_against || defaultPPG;
      
      // Calculate expected total points
      const avgAttack = (homePPG + awayPPG) / 2;
      const avgDefense = (homePAPG + awayPAPG) / 2;
      let muPoints = (avgAttack + avgDefense) / 2;
      
      // Home edge adjustment (small boost for home scoring)
      muPoints = muPoints + 2;
      
      // Book line (use league default if no odds available)
      const bookLine = leagueConfig.avg_total;
      
      // Calculate safe zone probability
      // Simple scaled score: higher mu_points vs book_line = higher probability
      const rawScore = (muPoints - bookLine) / 15; // Normalize difference
      const safeZoneProb = clamp(0.5 + rawScore, 0.25, 0.85);
      
      // Data quality based on games played
      const minGames = Math.min(
        homeStats?.games_played || 0,
        awayStats?.games_played || 0
      );
      let dataQuality: "high" | "medium" | "low";
      if (minGames >= 20) dataQuality = "high";
      else if (minGames >= 10) dataQuality = "medium";
      else dataQuality = "low";
      
      // Parse date/time
      const gameDate = isNBA 
        ? game.date?.start 
        : game.date;
      
      const dateObj = new Date(gameDate);
      
      results.push({
        game_id: game.id,
        league_key,
        league_name: leagueConfig.name,
        date: dateObj.toISOString().split('T')[0],
        time: dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        home_team: homeTeamName || "Home",
        home_team_id: homeTeamId || 0,
        away_team: awayTeamName || "Away",
        away_team_id: awayTeamId || 0,
        home_ppg: Math.round(homePPG * 10) / 10,
        away_ppg: Math.round(awayPPG * 10) / 10,
        home_papg: Math.round(homePAPG * 10) / 10,
        away_papg: Math.round(awayPAPG * 10) / 10,
        mu_points: Math.round(muPoints * 10) / 10,
        book_line: bookLine,
        safe_zone_prob: Math.round(safeZoneProb * 1000) / 1000,
        data_quality: dataQuality,
      });
    }
    
    // Sort by probability (descending) and limit
    results.sort((a, b) => b.safe_zone_prob - a.safe_zone_prob);
    const topResults = results.slice(0, limit);
    
    const elapsed = Date.now() - startTime;
    console.log(`[basketball-safe-zone] Completed in ${elapsed}ms, returning ${topResults.length} games`);

    return new Response(
      JSON.stringify({
        league_key,
        league_name: leagueConfig.name,
        games: topResults,
        meta: {
          generated_at: new Date().toISOString(),
          days_ahead,
          total_games_found: games.length,
          teams_with_stats: teamStatsMap.size,
          processing_ms: elapsed,
          model_version: "basketball-safe-zone-v1",
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    
  } catch (error: any) {
    console.error("[basketball-safe-zone] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
