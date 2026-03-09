/**
 * hockey-sync-fixtures
 *
 * Ingests hockey games into:
 *   - hockey_leagues  (composite PK: id, season)
 *   - hockey_teams    (PK: provider id)
 *   - hockey_games    (PK: provider id)
 *
 * Provider: api-sports.io  /hockey endpoint  (https://v1.hockey.api-sports.io)
 * Auth key: API_HOCKEY_KEY env secret
 *
 * IMPORTANT: The hockey API requires a `season` query parameter.
 * Season derivation: if the target month >= August, season = year; else season = year - 1.
 * (e.g. Jan 2025 → season=2024; Oct 2025 → season=2025)
 *
 * League priority order
 * ─────────────────────
 * 1. NHL (id=57)       ← always first
 * 2. AHL (id=58)
 * 3. KHL (id=82)
 * 4. SHL (id=105)      Sweden
 * 5. Liiga (id=93)     Finland
 * 6. NL (id=207)       Switzerland
 * 7. DEL (id=116)      Germany
 * 8. IIHF WC (id=16)
 *
 * Idempotency: all upserts use ON CONFLICT DO UPDATE.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-key",
};

const HOCKEY_BASE = "https://v1.hockey.api-sports.io";

const LEAGUE_PRIORITY: Array<{ id: number; name: string }> = [
  { id: 57,  name: "NHL" },
  { id: 58,  name: "AHL" },
  { id: 82,  name: "KHL" },
  { id: 105, name: "SHL" },
  { id: 93,  name: "Liiga" },
  { id: 207, name: "NL" },
  { id: 116, name: "DEL" },
  { id: 16,  name: "IIHF World Championship" },
];

const FINISHED_STATUSES = new Set(["FT", "AOT", "AP", "AET"]);

/**
 * Derive hockey season from a date.
 * Hockey seasons span Aug→Jul. If month >= August, season = year; else year - 1.
 */
function deriveSeasonFromDate(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00Z");
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-indexed: 0=Jan, 7=Aug
  return month >= 7 ? year : year - 1; // >= August → current year
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[hockey-sync-fixtures] ===== START =====");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("API_HOCKEY_KEY");

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "API_HOCKEY_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── Auth ─────────────────────────────────────────────────────────────────
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader    = req.headers.get("authorization");
    let isAuthorized    = authHeader === `Bearer ${serviceRoleKey}`;

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

    // ── Request params ────────────────────────────────────────────────────────
    const body        = await req.json().catch(() => ({}));
    const windowHours = body.window_hours ?? 72;
    const leagueIds: number[] =
      body.league_ids ?? LEAGUE_PRIORITY.map((l) => l.id);
    const startDate = body.start_date ?? null;
    const debugProbe = body.debug_probe === true;
    // Allow explicit season override; otherwise auto-derive from date
    const seasonOverride: number | null = body.season ?? null;

    // Build dates
    const baseDate = startDate ? new Date(startDate + "T00:00:00Z") : new Date();
    const dayCount = Math.ceil(windowHours / 24);
    const dates: string[] = [];
    for (let d = 0; d < dayCount; d++) {
      const day = new Date(baseDate.getTime() + d * 24 * 60 * 60 * 1000);
      dates.push(day.toISOString().split("T")[0]);
    }

    // Derive season from the first date in the window
    const season = seasonOverride ?? deriveSeasonFromDate(dates[0]);

    console.log(
      `[hockey-sync-fixtures] Window: ${windowHours}h, Season: ${season}, Leagues: ${leagueIds.join(", ")}${startDate ? `, start_date=${startDate}` : ""}`
    );
    console.log(`[hockey-sync-fixtures] Querying ${dates.length} dates: ${dates[0]} → ${dates[dates.length - 1]}`);

    // ── Debug probe mode ────────────────────────────────────────────────────
    if (debugProbe) {
      const probeLeague = leagueIds[0] ?? 57;
      const probeDate = dates[0];
      const probeUrl = `${HOCKEY_BASE}/games?league=${probeLeague}&season=${season}&date=${probeDate}`;
      console.log(`[hockey-sync-fixtures] DEBUG PROBE: ${probeUrl}`);
      
      const probeRes = await fetch(probeUrl, {
        headers: { "x-apisports-key": apiKey },
      });
      const probeJson = await probeRes.json();
      
      return new Response(
        JSON.stringify({
          debug: true,
          probe_url: probeUrl,
          season_used: season,
          http_status: probeRes.status,
          results_count: Array.isArray(probeJson.response) ? probeJson.response.length : null,
          errors: probeJson.errors,
          paging: probeJson.paging,
          parameters: probeJson.parameters,
          sample_games: Array.isArray(probeJson.response) ? probeJson.response.slice(0, 2) : null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Counters ──────────────────────────────────────────────────────────────
    let leaguesUpserted = 0;
    let teamsUpserted   = 0;
    let gamesUpserted   = 0;
    let apiCalls        = 0;
    const errors: string[] = [];
    const teamCache:   Map<number, boolean> = new Map();
    const leagueCache: Map<string, boolean> = new Map();

    async function ensureLeague(
      leagueId: number,
      gameSeason: number,
      name: string,
      country: string | null,
      logo: string | null
    ): Promise<void> {
      const key = `${leagueId}:${gameSeason}`;
      if (leagueCache.has(key)) return;
      const { error } = await supabase.from("hockey_leagues").upsert(
        { id: leagueId, season: gameSeason, name, country, logo },
        { onConflict: "id,season" }
      );
      if (error) { errors.push(`League upsert (${leagueId},${gameSeason}): ${error.message}`); return; }
      leaguesUpserted++;
      leagueCache.set(key, true);
    }

    async function ensureTeam(
      teamId: number, name: string, logo: string | null
    ): Promise<void> {
      if (teamCache.has(teamId)) return;
      const { error } = await supabase.from("hockey_teams").upsert(
        { id: teamId, name, logo },
        { onConflict: "id" }
      );
      if (error) { errors.push(`Team upsert (${teamId} ${name}): ${error.message}`); return; }
      teamsUpserted++;
      teamCache.set(teamId, true);
    }

    // ── Main fetch loop ─────────────────────────────────────────────────────
    for (const leagueId of leagueIds) {
      const leagueConfig = LEAGUE_PRIORITY.find((l) => l.id === leagueId);
      const leagueLabel  = leagueConfig?.name ?? String(leagueId);

      console.log(`[hockey-sync-fixtures] → Fetching ${leagueLabel} (id=${leagueId})`);

      let apiData: any[] = [];

      for (const dateStr of dates) {
        // CRITICAL: include &season= — API returns 0 games without it
        const url = `${HOCKEY_BASE}/games?league=${leagueId}&season=${season}&date=${dateStr}`;
        try {
          const response = await fetch(url, {
            headers: { "x-apisports-key": apiKey },
          });
          apiCalls++;

          if (!response.ok) {
            errors.push(`API ${response.status} for league ${leagueId} date=${dateStr}`);
            continue;
          }

          const json = await response.json();
          
          if (json.errors && Object.keys(json.errors).length > 0) {
            console.warn(`[hockey-sync-fixtures] API errors league=${leagueId} date=${dateStr}:`, JSON.stringify(json.errors));
            errors.push(`API errors league ${leagueId} date=${dateStr}: ${JSON.stringify(json.errors)}`);
          }
          
          const dayGames = json.response ?? [];
          if (!Array.isArray(dayGames)) {
            errors.push(`Unexpected API shape for league ${leagueId} date=${dateStr}`);
            continue;
          }

          console.log(`[hockey-sync-fixtures] league=${leagueId} date=${dateStr}: ${dayGames.length} games`);
          apiData.push(...dayGames);
        } catch (fetchErr: any) {
          errors.push(`Fetch error league ${leagueId} date=${dateStr}: ${fetchErr.message}`);
        }
      }

      console.log(`[hockey-sync-fixtures] ${leagueLabel}: ${apiData.length} total games`);

      for (const game of apiData) {
        try {
          const gameSeason: number | null = game.league?.season ?? null;
          if (!gameSeason || typeof gameSeason !== "number") {
            errors.push(`Game ${game.id}: missing season`);
            continue;
          }

          await ensureLeague(
            leagueId, gameSeason,
            game.league?.name ?? leagueLabel,
            game.league?.country?.name ?? null,
            game.league?.logo ?? null
          );

          const homeId = game.teams?.home?.id ?? null;
          const awayId = game.teams?.away?.id ?? null;
          if (!homeId || !awayId) {
            errors.push(`Game ${game.id}: missing team IDs`);
            continue;
          }

          await ensureTeam(homeId, game.teams.home.name ?? "Unknown", game.teams.home.logo ?? null);
          await ensureTeam(awayId, game.teams.away.name ?? "Unknown", game.teams.away.logo ?? null);

          const statusShort: string = game.status?.short ?? "NS";
          const puckDrop: string | null = game.date ?? null;
          if (!puckDrop) { errors.push(`Game ${game.id}: missing date`); continue; }

          const isFinished = FINISHED_STATUSES.has(statusShort);
          const homeScore = isFinished ? (game.scores?.home ?? null) : null;
          const awayScore = isFinished ? (game.scores?.away ?? null) : null;
          const wentToOt = isFinished
            ? (statusShort === "AOT" || statusShort === "AP" || statusShort === "AET")
            : false;
          const periodScores = isFinished ? (game.periods ?? null) : null;

          const { error: gameError } = await supabase
            .from("hockey_games")
            .upsert({
              id: game.id, league_id: leagueId, season: gameSeason,
              home_team_id: homeId, away_team_id: awayId,
              puck_drop: puckDrop, status: statusShort,
              home_score: homeScore, away_score: awayScore,
              period_scores: periodScores, went_to_ot: wentToOt,
            }, { onConflict: "id" });

          if (gameError) {
            errors.push(`Game upsert ${game.id}: ${gameError.message}`);
          } else {
            gamesUpserted++;
          }
        } catch (gameErr: any) {
          errors.push(`Game processing ${game.id ?? "??"}: ${gameErr.message}`);
        }
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[hockey-sync-fixtures] ═══════ COMPLETE ═══════ leagues=${leaguesUpserted} teams=${teamsUpserted} games=${gamesUpserted} api_calls=${apiCalls} errors=${errors.length} elapsed=${elapsed}ms`
    );

    await supabase.from("pipeline_run_logs").insert({
      job_name: "hockey-sync-fixtures",
      run_started: new Date(startTime).toISOString(),
      run_finished: new Date().toISOString(),
      success: errors.length === 0,
      mode: "cron",
      processed: gamesUpserted,
      failed: errors.length,
      details: {
        window_hours: windowHours, start_date: startDate, season,
        leagues_requested: leagueIds, leagues_upserted: leaguesUpserted,
        teams_upserted: teamsUpserted, games_upserted: gamesUpserted,
        api_calls: apiCalls, errors: errors.slice(0, 20), elapsed_ms: elapsed,
      },
    });

    return new Response(
      JSON.stringify({
        success: true, season, leagues_upserted: leaguesUpserted,
        teams_upserted: teamsUpserted, games_upserted: gamesUpserted,
        api_calls: apiCalls, elapsed_ms: elapsed,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[hockey-sync-fixtures] FATAL:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
