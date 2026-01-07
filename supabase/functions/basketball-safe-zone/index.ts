import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Basketball Safe Zone Edge Function v2.0
 * 
 * Returns upcoming basketball games ranked by probability of high total points
 * Uses LOCAL DATABASE (basketball_games + basketball_stats_cache) for reliability
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Supported leagues with their average totals
const SUPPORTED_LEAGUES: Record<string, { name: string; avg_total: number }> = {
  nba: { name: "NBA", avg_total: 225 },
  nba_gleague: { name: "G-League", avg_total: 220 },
  euroleague: { name: "EuroLeague", avg_total: 160 },
  eurocup: { name: "EuroCup", avg_total: 158 },
  spain_acb: { name: "Spain ACB", avg_total: 165 },
  germany_bbl: { name: "Germany BBL", avg_total: 165 },
  italy_lba: { name: "Italy Lega A", avg_total: 162 },
  france_prob: { name: "France Pro B", avg_total: 160 },
};

interface BasketballSafeZoneRequest {
  league_key: string;
  days_ahead?: number;
  limit?: number;
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
    const leagueConfig = SUPPORTED_LEAGUES[league_key];
    if (!leagueConfig) {
      return new Response(
        JSON.stringify({ 
          error: `Unsupported league: ${league_key}. Supported: ${Object.keys(SUPPORTED_LEAGUES).join(", ")}` 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[basketball-safe-zone] Fetching games for ${league_key}, days_ahead=${days_ahead}`);

    // Calculate date range
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + days_ahead);

    // Fetch upcoming games from local database
    const { data: games, error: gamesError } = await supabase
      .from("basketball_games")
      .select(`
        id,
        date,
        league_key,
        home_team_id,
        away_team_id,
        home_team:basketball_teams!basketball_games_home_team_id_fkey(id, name),
        away_team:basketball_teams!basketball_games_away_team_id_fkey(id, name)
      `)
      .eq("league_key", league_key)
      .eq("status_short", "NS")
      .gte("date", now.toISOString())
      .lte("date", endDate.toISOString())
      .order("date", { ascending: true });

    if (gamesError) {
      console.error(`[basketball-safe-zone] Error fetching games:`, gamesError);
      throw gamesError;
    }

    console.log(`[basketball-safe-zone] Found ${games?.length || 0} upcoming games in database`);

    if (!games || games.length === 0) {
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

    // Collect unique team IDs
    const teamIds = new Set<number>();
    for (const game of games) {
      teamIds.add(game.home_team_id);
      teamIds.add(game.away_team_id);
    }

    // Fetch team stats from local cache (latest season only)
    const { data: teamStats, error: statsError } = await supabase
      .from("basketball_stats_cache")
      .select("*")
      .in("team_id", Array.from(teamIds))
      .order("season", { ascending: false });

    if (statsError) {
      console.error(`[basketball-safe-zone] Error fetching stats:`, statsError);
    }

    // Build stats map (use latest season per team)
    const teamStatsMap = new Map<number, any>();
    if (teamStats) {
      for (const stat of teamStats) {
        if (!teamStatsMap.has(stat.team_id)) {
          teamStatsMap.set(stat.team_id, stat);
        }
      }
    }

    console.log(`[basketball-safe-zone] Fetched stats for ${teamStatsMap.size} teams`);

    // Calculate probabilities for each game
    const results: GameResult[] = [];
    
    for (const game of games) {
      const homeTeam = game.home_team as any;
      const awayTeam = game.away_team as any;
      
      const homeStats = teamStatsMap.get(game.home_team_id);
      const awayStats = teamStatsMap.get(game.away_team_id);
      
      // Default to league average if no stats
      const defaultPPG = leagueConfig.avg_total / 2;
      
      // Use last5 stats if available, otherwise season averages
      const homePPG = homeStats?.last5_ppg_for || homeStats?.ppg_for || defaultPPG;
      const homePAPG = homeStats?.last5_ppg_against || homeStats?.ppg_against || defaultPPG;
      const awayPPG = awayStats?.last5_ppg_for || awayStats?.ppg_for || defaultPPG;
      const awayPAPG = awayStats?.last5_ppg_against || awayStats?.ppg_against || defaultPPG;
      
      // Calculate expected total points using offensive/defensive matchup
      // Home team expected score = (home offense + away defense) / 2
      // Away team expected score = (away offense + home defense) / 2
      const homeExpected = (homePPG + awayPAPG) / 2;
      const awayExpected = (awayPPG + homePAPG) / 2;
      let muPoints = homeExpected + awayExpected;
      
      // Home court advantage (small boost)
      muPoints = muPoints + 3;
      
      // Book line (use league default)
      const bookLine = leagueConfig.avg_total;
      
      // Calculate safe zone probability
      // Higher mu_points vs book_line = higher probability of high scoring game
      const rawScore = (muPoints - bookLine) / 20; // Normalize difference
      const safeZoneProb = clamp(0.5 + rawScore, 0.20, 0.90);
      
      // Data quality based on sample size
      const minSample = Math.min(
        homeStats?.sample_size || 0,
        awayStats?.sample_size || 0
      );
      let dataQuality: "high" | "medium" | "low";
      if (minSample >= 10) dataQuality = "high";
      else if (minSample >= 5) dataQuality = "medium";
      else dataQuality = "low";
      
      // Parse date/time
      const dateObj = new Date(game.date);
      
      results.push({
        game_id: game.id,
        league_key,
        league_name: leagueConfig.name,
        date: dateObj.toISOString().split('T')[0],
        time: dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        home_team: homeTeam?.name || "Home",
        home_team_id: game.home_team_id,
        away_team: awayTeam?.name || "Away",
        away_team_id: game.away_team_id,
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
          model_version: "basketball-safe-zone-v2-db",
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