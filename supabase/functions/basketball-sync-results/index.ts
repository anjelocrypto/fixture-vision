/**
 * Basketball Sync Results Edge Function
 * 
 * Fetches detailed game statistics for finished games and stores in basketball_game_team_stats.
 * Similar to football's results-refresh.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
};

const NBA_BASE = "https://v2.nba.api-sports.io";
const BASKETBALL_BASE = "https://v1.basketball.api-sports.io";

const LEAGUE_API_MAP: Record<string, { api: string; leagueId?: number }> = {
  nba: { api: "nba" },
  nba_gleague: { api: "nba" },
  euroleague: { api: "basketball", leagueId: 120 },
  eurocup: { api: "basketball", leagueId: 121 },
  spain_acb: { api: "basketball", leagueId: 117 },
  germany_bbl: { api: "basketball", leagueId: 43 },
  italy_lba: { api: "basketball", leagueId: 82 },
  france_prob: { api: "basketball", leagueId: 40 },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[basketball-sync-results] ===== START =====");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("API_FOOTBALL_KEY");
    
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "API_FOOTBALL_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Auth check (same as sync-fixtures)
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    let isAuthorized = authHeader === `Bearer ${serviceRoleKey}`;

    if (!isAuthorized && cronKeyHeader) {
      const { data: dbKey } = await supabase.rpc("get_cron_internal_key");
      if (cronKeyHeader === dbKey) isAuthorized = true;
    }

    if (!isAuthorized && authHeader) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (anonKey) {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } }
        });
        const { data: isWhitelisted } = await userClient.rpc("is_user_whitelisted");
        if (isWhitelisted) isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const body = await req.json().catch(() => ({}));
    // PRO PLAN: 7500/day = ~300/hour - process up to 100 games per run
    const batchLimit = body.limit || 100;

    // Find finished games without stats
    const { data: finishedGames, error: queryError } = await supabase
      .from("basketball_games")
      .select(`
        id, api_game_id, league_key, home_team_id, away_team_id, home_score, away_score,
        home_team:basketball_teams!basketball_games_home_team_id_fkey(api_id),
        away_team:basketball_teams!basketball_games_away_team_id_fkey(api_id)
      `)
      .in("status_short", ["FT", "AOT", "AP"])
      .order("date", { ascending: false })
      .limit(100);

    if (queryError) {
      console.error("[basketball-sync-results] Query error:", queryError);
      return new Response(
        JSON.stringify({ error: queryError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get games that already have stats
    const gameIds = (finishedGames || []).map((g: any) => g.id);
    const { data: existingStats } = await supabase
      .from("basketball_game_team_stats")
      .select("game_id")
      .in("game_id", gameIds);

    const existingGameIds = new Set((existingStats || []).map((s: any) => s.game_id));
    const gamesToProcess = (finishedGames || [])
      .filter((g: any) => !existingGameIds.has(g.id))
      .slice(0, batchLimit);

    console.log(`[basketball-sync-results] Found ${finishedGames?.length || 0} finished games, ${existingGameIds.size} already have stats, processing ${gamesToProcess.length}`);

    let processed = 0;
    let failed = 0;
    let apiCalls = 0;
    const errors: string[] = [];

    for (const game of gamesToProcess) {
      try {
        const config = LEAGUE_API_MAP[game.league_key];
        if (!config) {
          errors.push(`Unknown league: ${game.league_key}`);
          failed++;
          continue;
        }

        // Fetch game statistics
        let url: string;
        if (config.api === "nba") {
          url = `${NBA_BASE}/games/statistics?id=${game.api_game_id}`;
        } else {
          url = `${BASKETBALL_BASE}/games/statistics?id=${game.api_game_id}`;
        }

        const response = await fetch(url, {
          headers: { "x-apisports-key": apiKey }
        });
        apiCalls++;

        if (!response.ok) {
          errors.push(`API error for game ${game.api_game_id}: ${response.status}`);
          failed++;
          continue;
        }

        const data = await response.json();
        const statsResponse = data.response || [];

        if (statsResponse.length === 0) {
          errors.push(`No stats for game ${game.api_game_id}`);
          failed++;
          continue;
        }

        // Process each team's stats
        for (const teamStats of statsResponse) {
          const teamApiId = teamStats.team?.id;
          const homeTeamApiId = (game.home_team as any)?.api_id;
          const isHome = teamApiId === homeTeamApiId;
          const internalTeamId = isHome ? game.home_team_id : game.away_team_id;

          if (!internalTeamId) continue;

          const stats = config.api === "nba" 
            ? teamStats.statistics?.[0] 
            : teamStats.statistics;

          if (!stats) continue;

          // Map stats (NBA vs Basketball API have slightly different field names)
          const statRow: any = {
            game_id: game.id,
            team_id: internalTeamId,
            is_home: isHome,
            points: isHome ? (game.home_score || 0) : (game.away_score || 0),
          };

          if (config.api === "nba") {
            // NBA API format
            statRow.fgm = stats.fgm ?? null;
            statRow.fga = stats.fga ?? null;
            statRow.fgp = stats.fgp ? parseFloat(stats.fgp) : null;
            statRow.tpm = stats.tpm ?? null;
            statRow.tpa = stats.tpa ?? null;
            statRow.tpp = stats.tpp ? parseFloat(stats.tpp) : null;
            statRow.ftm = stats.ftm ?? null;
            statRow.fta = stats.fta ?? null;
            statRow.ftp = stats.ftp ? parseFloat(stats.ftp) : null;
            statRow.rebounds_off = stats.offReb ?? null;
            statRow.rebounds_def = stats.defReb ?? null;
            statRow.rebounds_total = stats.totReb ?? null;
            statRow.assists = stats.assists ?? null;
            statRow.steals = stats.steals ?? null;
            statRow.blocks = stats.blocks ?? null;
            statRow.turnovers = stats.turnovers ?? null;
            statRow.fouls = stats.pFouls ?? null;
            statRow.fast_break_points = stats.fastBreakPoints ?? null;
            statRow.points_in_paint = stats.pointsInPaint ?? null;
            statRow.second_chance_points = stats.secondChancePoints ?? null;
            statRow.points_off_turnovers = stats.pointsOffTurnovers ?? null;
            statRow.biggest_lead = stats.biggestLead ?? null;
            statRow.plus_minus = stats.plusMinus ?? null;
          } else {
            // Basketball API format (simpler)
            // Stats come as array of { type, home, away }
            const findStat = (type: string) => {
              const found = Array.isArray(stats) 
                ? stats.find((s: any) => s.type === type)
                : null;
              return found ? (isHome ? found.home : found.away) : null;
            };

            statRow.fgm = findStat("Field Goals Made");
            statRow.fga = findStat("Field Goals Attempted");
            statRow.tpm = findStat("Three Points Made");
            statRow.tpa = findStat("Three Points Attempted");
            statRow.ftm = findStat("Free Throws Made");
            statRow.fta = findStat("Free Throws Attempted");
            statRow.rebounds_total = findStat("Total Rebounds");
            statRow.assists = findStat("Assists");
            statRow.steals = findStat("Steals");
            statRow.blocks = findStat("Blocks");
            statRow.turnovers = findStat("Turnovers");
            statRow.fouls = findStat("Fouls");
          }

          // Upsert stats
          const { error: upsertError } = await supabase
            .from("basketball_game_team_stats")
            .upsert(statRow, { onConflict: "game_id,team_id" });

          if (upsertError) {
            errors.push(`Stats upsert error: ${upsertError.message}`);
          }
        }

        processed++;
        console.log(`[basketball-sync-results] Processed game ${game.api_game_id}`);
      } catch (err: any) {
        errors.push(`Exception for game ${game.api_game_id}: ${err.message}`);
        failed++;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[basketball-sync-results] Completed in ${elapsed}ms: ${processed} processed, ${failed} failed`);

    // Log to pipeline
    await supabase.from("pipeline_run_logs").insert({
      job_name: "basketball-sync-results",
      run_started: new Date(startTime).toISOString(),
      run_finished: new Date().toISOString(),
      success: failed === 0,
      mode: "cron",
      processed,
      failed,
      details: {
        api_calls: apiCalls,
        elapsed_ms: elapsed,
        errors: errors.slice(0, 10),
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        failed,
        api_calls: apiCalls,
        elapsed_ms: elapsed,
        errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[basketball-sync-results] Fatal error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
