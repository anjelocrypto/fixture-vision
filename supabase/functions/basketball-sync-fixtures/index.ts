/**
 * Basketball Sync Fixtures Edge Function
 * 
 * Syncs upcoming basketball games (48h window) into basketball_games table.
 * Also upserts teams into basketball_teams.
 * Uses NBA API and Basketball API.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
};

const NBA_BASE = "https://v2.nba.api-sports.io";
const BASKETBALL_BASE = "https://v1.basketball.api-sports.io";

// Supported leagues configuration
const SUPPORTED_LEAGUES = {
  nba: { id: 12, api: "nba", season: "2024" },
  nba_gleague: { id: 20, api: "nba", season: "2024" },
  euroleague: { id: 120, api: "basketball", season: "2024-2025" },
  eurocup: { id: 121, api: "basketball", season: "2024-2025" },
  spain_acb: { id: 117, api: "basketball", season: "2024-2025" },
  germany_bbl: { id: 43, api: "basketball", season: "2024-2025" },
  italy_lba: { id: 82, api: "basketball", season: "2024-2025" },
  france_prob: { id: 40, api: "basketball", season: "2024-2025" },
};

interface UpsertedTeam {
  id: number;
  api_id: number;
  league_key: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[basketball-sync-fixtures] ===== START =====");

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

    // Auth check
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    let isAuthorized = false;

    if (authHeader === `Bearer ${serviceRoleKey}`) {
      isAuthorized = true;
    } else if (cronKeyHeader) {
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

    // Parse request body - PRO PLAN: Can process all leagues frequently
    const body = await req.json().catch(() => ({}));
    const windowHours = body.window_hours || 72; // Extend to 72h for better coverage
    const targetLeagues = body.leagues || Object.keys(SUPPORTED_LEAGUES);

    console.log(`[basketball-sync-fixtures] Window: ${windowHours}h, Leagues: ${targetLeagues.join(", ")}`);

    // Team cache to avoid re-querying
    const teamCache = new Map<string, number>(); // "api_id:league_key" -> internal id
    
    let gamesUpserted = 0;
    let teamsUpserted = 0;
    let apiCalls = 0;
    const errors: string[] = [];

    // Helper: upsert a team and return internal ID
    async function upsertTeam(apiId: number, name: string, logo: string | null, leagueKey: string, apiSource: string): Promise<number | null> {
      const cacheKey = `${apiId}:${leagueKey}`;
      if (teamCache.has(cacheKey)) {
        return teamCache.get(cacheKey)!;
      }

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
        .insert({
          api_id: apiId,
          league_key: leagueKey,
          name: name,
          logo: logo,
          api_source: apiSource,
        })
        .select("id")
        .single();

      if (error) {
        console.error(`[basketball-sync-fixtures] Error upserting team ${name}:`, error.message);
        return null;
      }

      teamsUpserted++;
      teamCache.set(cacheKey, inserted.id);
      return inserted.id;
    }

    // Process each league
    for (const leagueKey of targetLeagues) {
      const config = SUPPORTED_LEAGUES[leagueKey as keyof typeof SUPPORTED_LEAGUES];
      if (!config) continue;

      console.log(`[basketball-sync-fixtures] Processing ${leagueKey}...`);

      // Fetch games for today and tomorrow
      const dates: string[] = [];
      const now = new Date();
      for (let d = 0; d < Math.ceil(windowHours / 24); d++) {
        const date = new Date(now);
        date.setDate(date.getDate() + d);
        dates.push(date.toISOString().split('T')[0]);
      }

      for (const dateStr of dates) {
        try {
          let url: string;
          if (config.api === "nba") {
            url = `${NBA_BASE}/games?date=${dateStr}`;
          } else {
            url = `${BASKETBALL_BASE}/games?league=${config.id}&date=${dateStr}`;
          }

          const response = await fetch(url, {
            headers: { "x-apisports-key": apiKey }
          });
          apiCalls++;

          if (!response.ok) {
            errors.push(`API error for ${leagueKey} ${dateStr}: ${response.status}`);
            continue;
          }

          const data = await response.json();
          const games = data.response || [];
          
          console.log(`[basketball-sync-fixtures] ${leagueKey} ${dateStr}: ${games.length} games`);

          for (const game of games) {
            try {
              const isNBA = config.api === "nba";
              const gameId = game.id;
              const gameDate = isNBA ? game.date?.start : game.date;
              const status = game.status?.short || "NS";
              
              // Skip NBA games not in our target leagues
              // NBA API: league.id = 12 for NBA, 20 for G-League
              // If league.id is missing, assume it's NBA standard
              if (isNBA) {
                const nbaLeagueId = game.league?.id;
                if (leagueKey === "nba" && nbaLeagueId && nbaLeagueId !== 12) continue;
                if (leagueKey === "nba_gleague" && nbaLeagueId !== 20) continue;
              }

              // Get teams
              const homeTeam = isNBA ? game.teams?.home : game.teams?.home;
              const awayTeam = isNBA ? game.teams?.visitors : game.teams?.away;
              
              if (!homeTeam?.id || !awayTeam?.id) continue;

              // Upsert teams
              const homeTeamId = await upsertTeam(
                homeTeam.id, 
                homeTeam.name || "Unknown",
                homeTeam.logo || null,
                leagueKey,
                config.api
              );
              
              const awayTeamId = await upsertTeam(
                awayTeam.id,
                awayTeam.name || "Unknown", 
                awayTeam.logo || null,
                leagueKey,
                config.api
              );

              if (!homeTeamId || !awayTeamId) continue;

              // Get scores if available
              const homeScore = isNBA 
                ? (game.scores?.home?.points ?? null)
                : (game.scores?.home?.total ?? null);
              const awayScore = isNBA
                ? (game.scores?.visitors?.points ?? null)
                : (game.scores?.away?.total ?? null);

              // Upsert game
              const { error: gameError } = await supabase
                .from("basketball_games")
                .upsert({
                  api_game_id: gameId,
                  league_key: leagueKey,
                  season: config.season,
                  date: gameDate ? new Date(gameDate).toISOString() : new Date().toISOString(),
                  status_short: status,
                  home_team_id: homeTeamId,
                  away_team_id: awayTeamId,
                  home_score: homeScore,
                  away_score: awayScore,
                }, { onConflict: "api_game_id,league_key" });

              if (gameError) {
                errors.push(`Game upsert error ${gameId}: ${gameError.message}`);
              } else {
                gamesUpserted++;
              }
            } catch (gameErr) {
              errors.push(`Game processing error: ${gameErr}`);
            }
          }
        } catch (fetchErr) {
          errors.push(`Fetch error ${leagueKey} ${dateStr}: ${fetchErr}`);
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[basketball-sync-fixtures] Completed in ${elapsed}ms`);
    console.log(`[basketball-sync-fixtures] Games: ${gamesUpserted}, Teams: ${teamsUpserted}, API calls: ${apiCalls}`);

    // Log to pipeline_run_logs
    await supabase.from("pipeline_run_logs").insert({
      job_name: "basketball-sync-fixtures",
      run_started: new Date(startTime).toISOString(),
      run_finished: new Date().toISOString(),
      success: errors.length === 0,
      mode: "cron",
      processed: gamesUpserted,
      failed: errors.length,
      details: {
        window_hours: windowHours,
        leagues: targetLeagues,
        games_upserted: gamesUpserted,
        teams_upserted: teamsUpserted,
        api_calls: apiCalls,
        errors: errors.slice(0, 10),
        elapsed_ms: elapsed,
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        games_upserted: gamesUpserted,
        teams_upserted: teamsUpserted,
        api_calls: apiCalls,
        elapsed_ms: elapsed,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[basketball-sync-fixtures] Fatal error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
