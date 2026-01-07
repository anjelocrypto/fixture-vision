/**
 * Basketball Backfill Edge Function (Self-Managing)
 * 
 * Key features:
 * 1. Dynamic date range: computes current NBA season (Oct 1 → today)
 * 2. Budget-aware: daily limit ~2500 API calls, derives per-run limit from cron frequency
 * 3. Coverage-based early exit: stops when all NBA teams have sample_size >= 5
 * 4. Uses x-cron-key auth pattern (no hardcoded tokens)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
};

const NBA_BASE = "https://v2.nba.api-sports.io";
const BASKETBALL_BASE = "https://v1.basketball.api-sports.io";

// ============================================================================
// CONFIGURATION
// ============================================================================

// Daily API budget for basketball backfill (safe under 7500/day global limit)
const DAILY_BACKFILL_BUDGET = 2500;

// Cron runs every 6 hours = 4 runs/day
const RUNS_PER_DAY = 4;

// Derived per-run limit
const DEFAULT_MAX_API_CALLS = Math.floor(DAILY_BACKFILL_BUDGET / RUNS_PER_DAY); // 625

// GUARDRAIL: Hard upper bound to prevent accidental quota burn
const MAX_ALLOWED_CALLS = 2500;

// Minimum sample_size required for "coverage complete"
const REQUIRED_SAMPLE_SIZE = 5;

// ============================================================================

const LEAGUE_CONFIG: Record<string, { api: string; leagueId?: number; season: string; seasonStartMonth: number }> = {
  nba: { api: "nba", season: "2024", seasonStartMonth: 9 }, // October = month 9 (0-indexed)
  nba_gleague: { api: "nba", leagueId: 20, season: "2024", seasonStartMonth: 10 },
  euroleague: { api: "basketball", leagueId: 120, season: "2024-2025", seasonStartMonth: 9 },
  eurocup: { api: "basketball", leagueId: 121, season: "2024-2025", seasonStartMonth: 9 },
  spain_acb: { api: "basketball", leagueId: 117, season: "2024-2025", seasonStartMonth: 9 },
  germany_bbl: { api: "basketball", leagueId: 43, season: "2024-2025", seasonStartMonth: 9 },
  italy_lba: { api: "basketball", leagueId: 82, season: "2024-2025", seasonStartMonth: 9 },
  france_prob: { api: "basketball", leagueId: 40, season: "2024-2025", seasonStartMonth: 9 },
};

/**
 * Compute dynamic season date range.
 * NBA season typically starts in October (month 9).
 * If current month < season start month, we're in the second half of the previous year's season.
 */
function getSeasonDateRange(seasonStartMonth: number): { from: string; to: string } {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  
  // If we're before the season start month (e.g., Jan-Sep), use previous year as season start
  const seasonYear = currentMonth >= seasonStartMonth ? currentYear : currentYear - 1;
  
  const from = new Date(Date.UTC(seasonYear, seasonStartMonth, 1));
  const to = new Date(now.getTime()); // today
  
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  };
}

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

    // Auth check using shared helper
    const authResult = await checkCronOrAdminAuth(req, supabase, serviceRoleKey, "[basketball-backfill]");
    if (!authResult.authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized - Admin/cron only" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Parse request - all params are now OPTIONAL (dynamic defaults)
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is fine - use defaults
    }

    const league_key = body.league_key || "nba";
    let max_api_calls = body.max_api_calls || DEFAULT_MAX_API_CALLS;

    // GUARDRAIL: Enforce hard upper bound
    if (max_api_calls > MAX_ALLOWED_CALLS) {
      console.warn(`[basketball-backfill] max_api_calls ${max_api_calls} exceeds limit, capping to ${MAX_ALLOWED_CALLS}`);
      max_api_calls = MAX_ALLOWED_CALLS;
    }

    const config = LEAGUE_CONFIG[league_key];
    if (!config) {
      return new Response(
        JSON.stringify({ error: `Unknown league: ${league_key}. Supported: ${Object.keys(LEAGUE_CONFIG).join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Dynamic date range computation
    const dynamicRange = getSeasonDateRange(config.seasonStartMonth);
    const from = body.from || dynamicRange.from;
    const to = body.to || dynamicRange.to;

    console.log(`[basketball-backfill] League: ${league_key}, Dynamic range: ${from} to ${to}, Max API: ${max_api_calls}, Hard cap: ${MAX_ALLOWED_CALLS}`);

    // =========================================================================
    // EARLY EXIT CHECK: Coverage complete?
    // =========================================================================
    const { data: coverageCheck, error: coverageError } = await supabase
      .from("basketball_stats_cache")
      .select("team_id, sample_size")
      .eq("league_key", league_key);

    if (coverageError) {
      console.warn("[basketball-backfill] Could not check coverage:", coverageError.message);
    } else {
      const teams = coverageCheck || [];
      const teamsWithFullCoverage = teams.filter((t: any) => t.sample_size >= REQUIRED_SAMPLE_SIZE).length;
      const totalTeams = teams.length;
      
      console.log(`[basketball-backfill] Coverage check: ${teamsWithFullCoverage}/${totalTeams} teams have sample_size >= ${REQUIRED_SAMPLE_SIZE}`);
      
      // If all teams have sufficient coverage, skip backfill
      if (totalTeams > 0 && teamsWithFullCoverage === totalTeams) {
        console.log("[basketball-backfill] All teams have sufficient coverage - skipping backfill");
        
        await supabase.from("pipeline_run_logs").insert({
          job_name: "basketball-backfill",
          run_started: new Date(startTime).toISOString(),
          run_finished: new Date().toISOString(),
          success: true,
          mode: authResult.method,
          processed: 0,
          failed: 0,
          details: {
            league_key,
            from,
            to,
            skipped_reason: "coverage_complete",
            teams_with_coverage: teamsWithFullCoverage,
            total_teams: totalTeams,
            required_sample_size: REQUIRED_SAMPLE_SIZE,
            elapsed_ms: Date.now() - startTime,
          }
        });

        return new Response(
          JSON.stringify({
            success: true,
            skipped: true,
            reason: "coverage_complete",
            teams_with_coverage: teamsWithFullCoverage,
            total_teams: totalTeams,
            required_sample_size: REQUIRED_SAMPLE_SIZE,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // =========================================================================
    // BACKFILL PROCESSING
    // =========================================================================

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
            
            // Status parsing
            let rawStatus = game.status?.short;
            let status: string;
            
            if (isNBA) {
              const statusNum = Number(rawStatus);
              if (statusNum === 3 || rawStatus === "FT") {
                status = "FT";
              } else if (statusNum === 2 || rawStatus === "LIVE") {
                status = "LIVE";
              } else {
                status = "NS";
              }
            } else {
              status = rawStatus || "NS";
            }

            // Only process finished games
            if (!["FT", "AOT", "AP"].includes(status)) continue;

            // Filter NBA games to correct league
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
    const elapsedSec = Math.round(elapsed / 1000);
    
    // Structured summary log for auditability
    console.log(`[basketball-backfill] calls=${apiCalls} games=${gamesUpserted} stats=${statsUpserted} teams=${teamsUpserted} duration=${elapsedSec}s errors=${errors.length}`);

    // Log to pipeline
    await supabase.from("pipeline_run_logs").insert({
      job_name: "basketball-backfill",
      run_started: new Date(startTime).toISOString(),
      run_finished: new Date().toISOString(),
      success: true,
      mode: authResult.method,
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
        daily_budget: DAILY_BACKFILL_BUDGET,
        runs_per_day: RUNS_PER_DAY,
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
        config: {
          daily_budget: DAILY_BACKFILL_BUDGET,
          runs_per_day: RUNS_PER_DAY,
          per_run_limit: DEFAULT_MAX_API_CALLS,
        },
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
