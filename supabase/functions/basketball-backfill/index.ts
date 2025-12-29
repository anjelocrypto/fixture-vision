/**
 * Basketball Backfill Edge Function
 * 
 * Allows manual backfill of historical basketball data by date range.
 * Use this to gradually build 1 year of data while respecting free API limits.
 * 
 * Usage: POST with { league_key: "nba", from: "2024-01-01", to: "2024-03-01" }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
};

const NBA_BASE = "https://v2.nba.api-sports.io";
const BASKETBALL_BASE = "https://v1.basketball.api-sports.io";

const LEAGUE_CONFIG: Record<string, { api: string; leagueId?: number; season: string }> = {
  nba: { api: "nba", season: "2024" },
  nba_gleague: { api: "nba", leagueId: 20, season: "2024" },
  euroleague: { api: "basketball", leagueId: 120, season: "2024-2025" },
  eurocup: { api: "basketball", leagueId: 121, season: "2024-2025" },
  spain_acb: { api: "basketball", leagueId: 117, season: "2024-2025" },
  germany_bbl: { api: "basketball", leagueId: 43, season: "2024-2025" },
  italy_lba: { api: "basketball", leagueId: 82, season: "2024-2025" },
  france_prob: { api: "basketball", leagueId: 40, season: "2024-2025" },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[basketball-backfill] ===== START =====");

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

    // Auth check (cron, service role, or admin)
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    let isAuthorized = authHeader === `Bearer ${serviceRoleKey}`;

    // Check x-cron-key for cron job authentication
    if (!isAuthorized && cronKeyHeader) {
      const { data: dbKey } = await supabase.rpc("get_cron_internal_key");
      if (cronKeyHeader === dbKey) {
        isAuthorized = true;
        console.log("[basketball-backfill] Authorized via x-cron-key");
      }
    }

    // Check for admin user JWT
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
      return new Response(JSON.stringify({ error: "Unauthorized - Admin only" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Parse request - PRO PLAN: 7500/day allows aggressive backfill
    const body = await req.json();
    const { league_key, from, to, max_api_calls = 500 } = body;

    if (!league_key || !from || !to) {
      return new Response(
        JSON.stringify({ error: "Required: league_key, from (YYYY-MM-DD), to (YYYY-MM-DD)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = LEAGUE_CONFIG[league_key];
    if (!config) {
      return new Response(
        JSON.stringify({ error: `Unknown league: ${league_key}. Supported: ${Object.keys(LEAGUE_CONFIG).join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[basketball-backfill] League: ${league_key}, Range: ${from} to ${to}, Max API: ${max_api_calls}`);

    // Team cache
    const teamCache = new Map<string, number>();
    
    let gamesUpserted = 0;
    let statsUpserted = 0;
    let teamsUpserted = 0;
    let apiCalls = 0;
    const errors: string[] = [];

    // Helper: upsert team
    async function upsertTeam(apiId: number, name: string, logo: string | null, leagueKey: string, apiSource: string): Promise<number | null> {
      const cacheKey = `${apiId}:${leagueKey}`;
      if (teamCache.has(cacheKey)) return teamCache.get(cacheKey)!;

      const { data: existing } = await supabase
        .from("basketball_teams")
        .select("id")
        .eq("api_id", apiId)
        .eq("league_key", leagueKey)
        .single();

      if (existing) {
        teamCache.set(cacheKey, existing.id);
        return existing.id;
      }

      const { data: inserted, error } = await supabase
        .from("basketball_teams")
        .insert({ api_id: apiId, league_key: leagueKey, name, logo, api_source: apiSource })
        .select("id")
        .single();

      if (error) return null;

      teamsUpserted++;
      teamCache.set(cacheKey, inserted.id);
      return inserted.id;
    }

    // Generate date range
    const dates: string[] = [];
    const startDate = new Date(from);
    const endDate = new Date(to);
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      if (apiCalls >= max_api_calls) break;
      dates.push(d.toISOString().split('T')[0]);
    }

    console.log(`[basketball-backfill] Processing ${dates.length} dates`);

    // Process each date
    for (const dateStr of dates) {
      if (apiCalls >= max_api_calls) {
        console.log(`[basketball-backfill] API limit reached (${apiCalls}/${max_api_calls})`);
        break;
      }

      try {
        // Fetch games
        let url: string;
        if (config.api === "nba") {
          url = `${NBA_BASE}/games?date=${dateStr}`;
        } else {
          url = `${BASKETBALL_BASE}/games?league=${config.leagueId}&date=${dateStr}`;
        }

        const gamesResponse = await fetch(url, {
          headers: { "x-apisports-key": apiKey }
        });
        apiCalls++;

        if (!gamesResponse.ok) {
          errors.push(`Games API error for ${dateStr}: ${gamesResponse.status}`);
          continue;
        }

        const gamesData = await gamesResponse.json();
        const games = gamesData.response || [];

        for (const game of games) {
          if (apiCalls >= max_api_calls) break;

          try {
            const isNBA = config.api === "nba";
            const gameId = game.id;
            
            // NBA API returns numeric status: 1=scheduled, 2=in progress, 3=finished
            // Basketball API returns string status: NS, FT, etc.
            let status = game.status?.short || "NS";
            if (isNBA && typeof status === "number") {
              status = status === 3 ? "FT" : status === 2 ? "LIVE" : "NS";
            }

            // Only process finished games
            if (!["FT", "AOT", "AP"].includes(String(status))) continue;

            // Filter NBA games to correct league
            // NBA API: league.id = 12 for NBA, 20 for G-League
            // If league.id is missing, assume it's NBA standard
            const nbaLeagueId = game.league?.id;
            if (isNBA && league_key === "nba_gleague" && nbaLeagueId !== 20) continue;
            if (isNBA && league_key === "nba" && nbaLeagueId && nbaLeagueId !== 12) continue;

            const homeTeam = isNBA ? game.teams?.home : game.teams?.home;
            const awayTeam = isNBA ? game.teams?.visitors : game.teams?.away;
            
            if (!homeTeam?.id || !awayTeam?.id) continue;

            // Upsert teams
            const homeTeamId = await upsertTeam(homeTeam.id, homeTeam.name, homeTeam.logo, league_key, config.api);
            const awayTeamId = await upsertTeam(awayTeam.id, awayTeam.name, awayTeam.logo, league_key, config.api);

            if (!homeTeamId || !awayTeamId) continue;

            // Get scores
            const homeScore = isNBA 
              ? (game.scores?.home?.points ?? null)
              : (game.scores?.home?.total ?? null);
            const awayScore = isNBA
              ? (game.scores?.visitors?.points ?? null)
              : (game.scores?.away?.total ?? null);

            const gameDate = isNBA ? game.date?.start : game.date;

            // Upsert game
            const { data: upsertedGame, error: gameError } = await supabase
              .from("basketball_games")
              .upsert({
                api_game_id: gameId,
                league_key: league_key,
                season: config.season,
                date: gameDate ? new Date(gameDate).toISOString() : new Date().toISOString(),
                status_short: status,
                home_team_id: homeTeamId,
                away_team_id: awayTeamId,
                home_score: homeScore,
                away_score: awayScore,
              }, { onConflict: "api_game_id,league_key" })
              .select("id")
              .single();

            if (gameError) {
              errors.push(`Game upsert: ${gameError.message}`);
              continue;
            }

            gamesUpserted++;
            const internalGameId = upsertedGame.id;

            // Fetch and store stats
            let statsUrl: string;
            if (config.api === "nba") {
              statsUrl = `${NBA_BASE}/games/statistics?id=${gameId}`;
            } else {
              statsUrl = `${BASKETBALL_BASE}/games/statistics?id=${gameId}`;
            }

            const statsResponse = await fetch(statsUrl, {
              headers: { "x-apisports-key": apiKey }
            });
            apiCalls++;

            if (!statsResponse.ok) continue;

            const statsData = await statsResponse.json();
            const statsArr = statsData.response || [];

            for (const teamStats of statsArr) {
              const teamApiId = teamStats.team?.id;
              const isHome = teamApiId === homeTeam.id;
              const internalTeamId = isHome ? homeTeamId : awayTeamId;

              const stats = config.api === "nba" 
                ? teamStats.statistics?.[0] 
                : teamStats.statistics;

              if (!stats) continue;

              const statRow: any = {
                game_id: internalGameId,
                team_id: internalTeamId,
                is_home: isHome,
                points: isHome ? (homeScore || 0) : (awayScore || 0),
              };

              if (config.api === "nba") {
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
              }

              const { error: statError } = await supabase
                .from("basketball_game_team_stats")
                .upsert(statRow, { onConflict: "game_id,team_id" });

              if (!statError) statsUpserted++;
            }
          } catch (gameErr: any) {
            errors.push(`Game error: ${gameErr.message}`);
          }
        }
      } catch (dateErr: any) {
        errors.push(`Date ${dateStr}: ${dateErr.message}`);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[basketball-backfill] Completed in ${elapsed}ms`);

    // Log to pipeline
    await supabase.from("pipeline_run_logs").insert({
      job_name: "basketball-backfill",
      run_started: new Date(startTime).toISOString(),
      run_finished: new Date().toISOString(),
      success: true,
      mode: "manual",
      processed: gamesUpserted,
      failed: errors.length,
      details: {
        league_key,
        from,
        to,
        dates_processed: dates.length,
        games_upserted: gamesUpserted,
        stats_upserted: statsUpserted,
        teams_upserted: teamsUpserted,
        api_calls: apiCalls,
        max_api_calls,
        elapsed_ms: elapsed,
        errors: errors.slice(0, 10),
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        league_key,
        from,
        to,
        dates_processed: dates.length,
        games_upserted: gamesUpserted,
        stats_upserted: statsUpserted,
        teams_upserted: teamsUpserted,
        api_calls: apiCalls,
        api_limit_remaining: max_api_calls - apiCalls,
        elapsed_ms: elapsed,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
        next_step: apiCalls >= max_api_calls 
          ? `Continue from next date after ${dates[dates.length - 1]}` 
          : "Backfill complete for range"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[basketball-backfill] Fatal error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
