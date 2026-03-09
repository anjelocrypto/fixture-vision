/**
 * hockey-stats-refresh
 *
 * Computes aggregated team stats and H2H from finished hockey_games.
 * Populates:
 *   - hockey_team_stats_cache (PK: team_id, league_id, season)
 *   - hockey_h2h_cache        (PK: team_lo, team_hi — canonical ordering)
 *
 * Canonical H2H ordering: team_lo = LEAST(a,b), team_hi = GREATEST(a,b)
 *
 * Schema-available columns for hockey_team_stats_cache:
 *   gp, gpg, ga_pg, pp_pct, pk_pct, sog_pg, sa_pg,
 *   p1_gpg, p1_gapg, ot_pct, last5_gpg, last5_gapg, last5_game_ids
 *
 * KNOWN GAPS (not in current schema — would need migration):
 *   - wins, losses, otw, otl
 *   - home_gpg_for, home_gpg_against, away_gpg_for, away_gpg_against
 *   - last5_record
 *   These are noted but NOT faked. If needed, add columns via migration first.
 *
 * Provider: computed from local hockey_games data (no external API calls)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-key",
};

const FINISHED_STATUSES = ["FT", "AOT", "AP", "AET"];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[hockey-stats-refresh] ===== START =====");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── Auth ─────────────────────────────────────────────────────────────────
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
          global: { headers: { Authorization: authHeader } },
        });
        const { data: isWhitelisted } = await userClient.rpc("is_user_whitelisted");
        if (isWhitelisted) isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Fetch all finished games ──────────────────────────────────────────────
    const { data: games, error: gamesErr } = await supabase
      .from("hockey_games")
      .select("id, league_id, season, home_team_id, away_team_id, home_score, away_score, status, went_to_ot, period_scores, puck_drop")
      .in("status", FINISHED_STATUSES)
      .not("home_score", "is", null)
      .not("away_score", "is", null)
      .order("puck_drop", { ascending: true })
      .limit(1000);

    if (gamesErr) {
      console.error("[hockey-stats-refresh] DB query error:", gamesErr.message);
      return new Response(
        JSON.stringify({ error: gamesErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[hockey-stats-refresh] Found ${games?.length ?? 0} finished games`);

    if (!games || games.length === 0) {
      return new Response(
        JSON.stringify({ success: true, team_stats: 0, h2h_pairs: 0, message: "No finished games" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Build team stats aggregation ──────────────────────────────────────────
    // Key: "teamId:leagueId:season"
    interface TeamAgg {
      teamId: number;
      leagueId: number;
      season: number;
      gp: number;
      goalsFor: number;
      goalsAgainst: number;
      otGames: number;
      p1GoalsFor: number;
      p1GoalsAgainst: number;
      p1Games: number; // games where we could parse P1
      gameIds: number[]; // ordered by puck_drop ascending
    }

    const teamMap = new Map<string, TeamAgg>();

    function getTeamAgg(teamId: number, leagueId: number, season: number): TeamAgg {
      const key = `${teamId}:${leagueId}:${season}`;
      if (!teamMap.has(key)) {
        teamMap.set(key, {
          teamId, leagueId, season,
          gp: 0, goalsFor: 0, goalsAgainst: 0, otGames: 0,
          p1GoalsFor: 0, p1GoalsAgainst: 0, p1Games: 0,
          gameIds: [],
        });
      }
      return teamMap.get(key)!;
    }

    /**
     * Parse period 1 score from period_scores.
     * Format: period_scores.first = "H-A" (e.g. "2-1")
     * Returns [homeP1, awayP1] or null if unparseable.
     */
    function parseP1(periodScores: any): [number, number] | null {
      if (!periodScores || typeof periodScores !== "object") return null;
      const first = periodScores.first;
      if (!first || typeof first !== "string") return null;
      const parts = first.split("-");
      if (parts.length !== 2) return null;
      const h = parseInt(parts[0], 10);
      const a = parseInt(parts[1], 10);
      if (isNaN(h) || isNaN(a)) return null;
      return [h, a];
    }

    // ── H2H aggregation ──────────────────────────────────────────────────────
    // Key: "lo:hi" (canonical)
    interface H2HAgg {
      teamLo: number;
      teamHi: number;
      gp: number;
      totalGoals: number;
      otGames: number;
      gameIds: number[];
    }

    const h2hMap = new Map<string, H2HAgg>();

    // ── Process all games ─────────────────────────────────────────────────────
    for (const g of games) {
      const homeId = g.home_team_id;
      const awayId = g.away_team_id;
      const homeScore = g.home_score as number;
      const awayScore = g.away_score as number;
      const isOT = g.went_to_ot === true;

      // ── Team stats ──────────────────────────────────────────────────────
      const homeAgg = getTeamAgg(homeId, g.league_id, g.season);
      homeAgg.gp++;
      homeAgg.goalsFor += homeScore;
      homeAgg.goalsAgainst += awayScore;
      if (isOT) homeAgg.otGames++;
      homeAgg.gameIds.push(g.id);

      const awayAgg = getTeamAgg(awayId, g.league_id, g.season);
      awayAgg.gp++;
      awayAgg.goalsFor += awayScore;
      awayAgg.goalsAgainst += homeScore;
      if (isOT) awayAgg.otGames++;
      awayAgg.gameIds.push(g.id);

      // P1 parsing
      const p1 = parseP1(g.period_scores);
      if (p1) {
        homeAgg.p1GoalsFor += p1[0];
        homeAgg.p1GoalsAgainst += p1[1];
        homeAgg.p1Games++;
        awayAgg.p1GoalsFor += p1[1];
        awayAgg.p1GoalsAgainst += p1[0];
        awayAgg.p1Games++;
      }

      // ── H2H ────────────────────────────────────────────────────────────
      const lo = Math.min(homeId, awayId);
      const hi = Math.max(homeId, awayId);
      const h2hKey = `${lo}:${hi}`;
      if (!h2hMap.has(h2hKey)) {
        h2hMap.set(h2hKey, { teamLo: lo, teamHi: hi, gp: 0, totalGoals: 0, otGames: 0, gameIds: [] });
      }
      const h2h = h2hMap.get(h2hKey)!;
      h2h.gp++;
      h2h.totalGoals += homeScore + awayScore;
      if (isOT) h2h.otGames++;
      h2h.gameIds.push(g.id);
    }

    // ── Compute last5 per team (using game order from gameIds) ────────────────
    // We need per-team last5 stats. To do that we need to re-scan games for each team's
    // last 5 game IDs. Build a lookup first.
    const gameById = new Map<number, any>();
    for (const g of games) {
      gameById.set(g.id, g);
    }

    // ── Upsert team stats ────────────────────────────────────────────────────
    let teamStatsUpserted = 0;
    const teamErrors: string[] = [];

    for (const agg of teamMap.values()) {
      const last5Ids = agg.gameIds.slice(-5);
      let last5GF = 0;
      let last5GA = 0;

      for (const gid of last5Ids) {
        const g = gameById.get(gid);
        if (!g) continue;
        if (g.home_team_id === agg.teamId) {
          last5GF += g.home_score;
          last5GA += g.away_score;
        } else {
          last5GF += g.away_score;
          last5GA += g.home_score;
        }
      }

      const last5Count = last5Ids.length || 1;

      const row = {
        team_id: agg.teamId,
        league_id: agg.leagueId,
        season: agg.season,
        gp: agg.gp,
        gpg: Number((agg.goalsFor / agg.gp).toFixed(2)),
        ga_pg: Number((agg.goalsAgainst / agg.gp).toFixed(2)),
        p1_gpg: agg.p1Games > 0 ? Number((agg.p1GoalsFor / agg.p1Games).toFixed(2)) : 0,
        p1_gapg: agg.p1Games > 0 ? Number((agg.p1GoalsAgainst / agg.p1Games).toFixed(2)) : 0,
        ot_pct: Number(((agg.otGames / agg.gp) * 100).toFixed(1)),
        last5_gpg: Number((last5GF / last5Count).toFixed(2)),
        last5_gapg: Number((last5GA / last5Count).toFixed(2)),
        last5_game_ids: last5Ids,
        // pp_pct, pk_pct, sog_pg, sa_pg: not available from box scores alone
        // Set to 0 — would need detailed game stats API for these
        pp_pct: 0,
        pk_pct: 0,
        sog_pg: 0,
        sa_pg: 0,
      };

      const { error } = await supabase
        .from("hockey_team_stats_cache")
        .upsert(row, { onConflict: "team_id,league_id,season" });

      if (error) {
        teamErrors.push(`Team ${agg.teamId}: ${error.message}`);
      } else {
        teamStatsUpserted++;
      }
    }

    console.log(`[hockey-stats-refresh] Team stats upserted: ${teamStatsUpserted}, errors: ${teamErrors.length}`);

    // ── Upsert H2H cache ─────────────────────────────────────────────────────
    let h2hUpserted = 0;
    const h2hErrors: string[] = [];

    for (const h2h of h2hMap.values()) {
      const row = {
        team_lo: h2h.teamLo,
        team_hi: h2h.teamHi,
        gp: h2h.gp,
        avg_total_goals: Number((h2h.totalGoals / h2h.gp).toFixed(2)),
        ot_pct: Number(((h2h.otGames / h2h.gp) * 100).toFixed(1)),
        last_game_ids: h2h.gameIds.slice(-10),
      };

      const { error } = await supabase
        .from("hockey_h2h_cache")
        .upsert(row, { onConflict: "team_lo,team_hi" });

      if (error) {
        h2hErrors.push(`H2H ${h2h.teamLo}-${h2h.teamHi}: ${error.message}`);
      } else {
        h2hUpserted++;
      }
    }

    console.log(`[hockey-stats-refresh] H2H upserted: ${h2hUpserted}, errors: ${h2hErrors.length}`);

    // ── Summary ──────────────────────────────────────────────────────────────
    const elapsed = Date.now() - startTime;
    const allErrors = [...teamErrors, ...h2hErrors];

    await supabase.from("pipeline_run_logs").insert({
      job_name: "hockey-stats-refresh",
      run_started: new Date(startTime).toISOString(),
      run_finished: new Date().toISOString(),
      success: allErrors.length === 0,
      mode: "cron",
      processed: teamStatsUpserted + h2hUpserted,
      failed: allErrors.length,
      details: {
        finished_games: games.length,
        team_stats_upserted: teamStatsUpserted,
        h2h_upserted: h2hUpserted,
        errors: allErrors.slice(0, 20),
        elapsed_ms: elapsed,
        note: "pp_pct, pk_pct, sog_pg, sa_pg require detailed game stats API — set to 0. wins/losses/otw/otl not in schema — would need migration.",
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        finished_games: games.length,
        team_stats_upserted: teamStatsUpserted,
        h2h_upserted: h2hUpserted,
        elapsed_ms: elapsed,
        errors: allErrors.length > 0 ? allErrors.slice(0, 10) : undefined,
        schema_gaps: [
          "wins/losses/otw/otl: not in hockey_team_stats_cache schema",
          "home_gpg_for/against, away_gpg_for/against: not in schema",
          "last5_record: not in schema",
          "pp_pct, pk_pct, sog_pg, sa_pg: need detailed game stats API (set to 0)",
        ],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[hockey-stats-refresh] FATAL:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
