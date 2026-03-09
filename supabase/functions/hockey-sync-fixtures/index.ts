/**
 * hockey-sync-fixtures
 *
 * Ingests upcoming hockey games (72h window) into:
 *   - hockey_leagues  (composite PK: id, season)
 *   - hockey_teams    (PK: provider id)
 *   - hockey_games    (PK: provider id)
 *
 * Provider: api-sports.io  /hockey endpoint  (https://v1.hockey.api-sports.io)
 * Auth key: API_HOCKEY_KEY env secret
 *
 * Season semantics
 * ─────────────────
 * The hockey API returns season as an integer year (e.g. 2024).
 * We store it as-is.  For leagues that span two calendar years (e.g. NHL
 * 2024-25), the provider still tags games with season=2024.
 * We do NOT guess: we use game.league.season directly.
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
 * Idempotency
 * ───────────
 * All three tables use ON CONFLICT DO UPDATE (upsert), so repeated runs are safe.
 * Teams are keyed by provider id only (no league binding on the teams table).
 * Games are keyed by provider id.
 * Leagues are keyed by (id, season).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-key",
};

const HOCKEY_BASE = "https://v1.hockey.api-sports.io";

// Priority-ordered league configurations
// season is resolved from the API response (game.league.season), not hardcoded
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

// Terminal finished statuses from the hockey API
const FINISHED_STATUSES = new Set(["FT", "AOT", "AP", "AET"]);

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
      console.error("[hockey-sync-fixtures] FATAL: API_HOCKEY_KEY not configured");
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
    // Allow caller to override league list; default = all in priority order
    const leagueIds: number[] =
      body.league_ids ?? LEAGUE_PRIORITY.map((l) => l.id);
    // Allow start_date override for backfill / testing: "YYYY-MM-DD"
    const startDate = body.start_date ?? null;
    // Debug mode: return raw API response for inspection
    const debugProbe = body.debug_probe === true;

    console.log(
      `[hockey-sync-fixtures] Window: ${windowHours}h, Leagues: ${leagueIds.join(", ")}${startDate ? `, start_date=${startDate}` : ""}`
    );

    // Build list of dates to query (hockey API uses ?date=YYYY-MM-DD, no range params)
    const baseDate = startDate ? new Date(startDate + "T00:00:00Z") : new Date();
    const dayCount = Math.ceil(windowHours / 24);
    const dates: string[] = [];
    for (let d = 0; d < dayCount; d++) {
      const day = new Date(baseDate.getTime() + d * 24 * 60 * 60 * 1000);
      dates.push(day.toISOString().split("T")[0]);
    }

    console.log(`[hockey-sync-fixtures] Querying ${dates.length} dates: ${dates[0]} → ${dates[dates.length - 1]}`);

    // ── Debug probe mode: just hit one endpoint and return raw response ─────
    if (debugProbe) {
      const probeLeague = leagueIds[0] ?? 57;
      const probeDate = dates[0];
      const probeUrl = `${HOCKEY_BASE}/games?league=${probeLeague}&date=${probeDate}`;
      console.log(`[hockey-sync-fixtures] DEBUG PROBE: ${probeUrl}`);
      
      const probeRes = await fetch(probeUrl, {
        headers: { "x-apisports-key": apiKey },
      });
      const probeJson = await probeRes.json();
      
      return new Response(
        JSON.stringify({
          debug: true,
          probe_url: probeUrl,
          http_status: probeRes.status,
          results_count: Array.isArray(probeJson.response) ? probeJson.response.length : null,
          errors: probeJson.errors,
          paging: probeJson.paging,
          parameters: probeJson.parameters,
          // Include first 2 games for inspection (if any)
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

    // In-memory caches to avoid repeated DB round-trips
    const teamCache:   Map<number, boolean> = new Map();
    const leagueCache: Map<string, boolean> = new Map();

    // ── Helper: upsert a league row ───────────────────────────────────────────
    async function ensureLeague(
      leagueId: number,
      season: number,
      name: string,
      country: string | null,
      logo: string | null
    ): Promise<void> {
      const key = `${leagueId}:${season}`;
      if (leagueCache.has(key)) return;

      const { error } = await supabase.from("hockey_leagues").upsert(
        { id: leagueId, season, name, country, logo },
        { onConflict: "id,season" }
      );

      if (error) {
        errors.push(`League upsert (${leagueId},${season}): ${error.message}`);
        return;
      }
      leaguesUpserted++;
      leagueCache.set(key, true);
    }

    // ── Helper: upsert a team row ─────────────────────────────────────────────
    async function ensureTeam(
      teamId: number,
      name: string,
      shortName: string | null,
      logo: string | null,
      country: string | null
    ): Promise<void> {
      if (teamCache.has(teamId)) return;

      const { error } = await supabase.from("hockey_teams").upsert(
        { id: teamId, name, short_name: shortName, logo, country },
        { onConflict: "id" }
      );

      if (error) {
        errors.push(`Team upsert (${teamId} ${name}): ${error.message}`);
        return;
      }
      teamsUpserted++;
      teamCache.set(teamId, true);
    }

    // ── Main fetch loop (priority order, per-date) ─────────────────────────────
    for (const leagueId of leagueIds) {
      const leagueConfig = LEAGUE_PRIORITY.find((l) => l.id === leagueId);
      const leagueLabel  = leagueConfig?.name ?? String(leagueId);

      console.log(`[hockey-sync-fixtures] → Fetching ${leagueLabel} (id=${leagueId})`);

      let apiData: any[] = [];

      for (const dateStr of dates) {
        const url = `${HOCKEY_BASE}/games?league=${leagueId}&date=${dateStr}`;
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
          
          // Log raw API metadata for debugging
          if (json.errors && Object.keys(json.errors).length > 0) {
            console.warn(`[hockey-sync-fixtures] API errors for league=${leagueId} date=${dateStr}:`, JSON.stringify(json.errors));
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

      console.log(`[hockey-sync-fixtures] ${leagueLabel}: ${apiData.length} games from API`);

      for (const game of apiData) {
        try {
          // ── Season: always from provider, never guessed ──────────────────
          const season: number | null = game.league?.season ?? null;
          if (!season || typeof season !== "number") {
            errors.push(`Game ${game.id}: missing or non-integer season (got ${JSON.stringify(season)})`);
            console.warn(`[hockey-sync-fixtures] Game ${game.id}: missing season, skipping`);
            continue;
          }

          // ── League metadata ───────────────────────────────────────────────
          const leagueName    = game.league?.name ?? leagueLabel;
          const leagueCountry = game.league?.country?.name ?? null;
          const leagueLogo    = game.league?.logo ?? null;
          await ensureLeague(leagueId, season, leagueName, leagueCountry, leagueLogo);

          // ── Teams ─────────────────────────────────────────────────────────
          const homeId   = game.teams?.home?.id ?? null;
          const awayId   = game.teams?.away?.id ?? null;

          if (!homeId || !awayId) {
            errors.push(`Game ${game.id}: missing team IDs (home=${homeId}, away=${awayId})`);
            continue;
          }

          await ensureTeam(
            homeId,
            game.teams.home.name ?? "Unknown",
            null,
            game.teams.home.logo ?? null,
            null
          );
          await ensureTeam(
            awayId,
            game.teams.away.name ?? "Unknown",
            null,
            game.teams.away.logo ?? null,
            null
          );

          // ── Status mapping ────────────────────────────────────────────────
          const statusShort: string = game.status?.short ?? "NS";

          // ── Puck drop ─────────────────────────────────────────────────────
          const puckDrop: string | null = game.date ?? null;
          if (!puckDrop) {
            errors.push(`Game ${game.id}: missing date`);
            continue;
          }

          // ── Scores (only trust for finished games) ────────────────────────
          const isFinished = FINISHED_STATUSES.has(statusShort);
          const homeScore: number | null = isFinished
            ? (game.scores?.home ?? null)
            : null;
          const awayScore: number | null = isFinished
            ? (game.scores?.away ?? null)
            : null;

          // ── went_to_ot: for upcoming games always false ───────────────────
          const wentToOt: boolean = isFinished
            ? (statusShort === "AOT" || statusShort === "AP" || statusShort === "AET")
            : false;

          // ── period_scores ─────────────────────────────────────────────────
          const periodScores: any | null = isFinished
            ? (game.periods ?? null)
            : null;

          // ── Upsert game ───────────────────────────────────────────────────
          const { error: gameError } = await supabase
            .from("hockey_games")
            .upsert(
              {
                id:            game.id,
                league_id:     leagueId,
                season,
                home_team_id:  homeId,
                away_team_id:  awayId,
                puck_drop:     puckDrop,
                status:        statusShort,
                home_score:    homeScore,
                away_score:    awayScore,
                period_scores: periodScores,
                went_to_ot:    wentToOt,
              },
              { onConflict: "id" }
            );

          if (gameError) {
            errors.push(`Game upsert ${game.id}: ${gameError.message}`);
            console.error(`[hockey-sync-fixtures] Game upsert error ${game.id}:`, gameError.message);
          } else {
            gamesUpserted++;
          }
        } catch (gameErr: any) {
          errors.push(`Game processing ${game.id ?? "??"}: ${gameErr.message}`);
          console.error(`[hockey-sync-fixtures] Exception on game:`, gameErr.message);
        }
      }

      console.log(
        `[hockey-sync-fixtures] ${leagueLabel} done: ${apiData.length} API games processed`
      );
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    const elapsed = Date.now() - startTime;
    console.log(
      `[hockey-sync-fixtures] ═══════ COMPLETE ═══════ leagues=${leaguesUpserted} teams=${teamsUpserted} games=${gamesUpserted} api_calls=${apiCalls} errors=${errors.length} elapsed=${elapsed}ms`
    );

    if (errors.length > 0) {
      console.warn("[hockey-sync-fixtures] Errors (first 10):", errors.slice(0, 10));
    }

    // ── Pipeline log ──────────────────────────────────────────────────────────
    await supabase.from("pipeline_run_logs").insert({
      job_name:     "hockey-sync-fixtures",
      run_started:  new Date(startTime).toISOString(),
      run_finished: new Date().toISOString(),
      success:      errors.length === 0,
      mode:         "cron",
      processed:    gamesUpserted,
      failed:       errors.length,
      details: {
        window_hours:     windowHours,
        start_date:       startDate,
        leagues_requested: leagueIds,
        leagues_upserted: leaguesUpserted,
        teams_upserted:   teamsUpserted,
        games_upserted:   gamesUpserted,
        api_calls:        apiCalls,
        errors:           errors.slice(0, 20),
        elapsed_ms:       elapsed,
      },
    });

    return new Response(
      JSON.stringify({
        success:          true,
        leagues_upserted: leaguesUpserted,
        teams_upserted:   teamsUpserted,
        games_upserted:   gamesUpserted,
        api_calls:        apiCalls,
        elapsed_ms:       elapsed,
        errors:           errors.length > 0 ? errors.slice(0, 10) : undefined,
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
