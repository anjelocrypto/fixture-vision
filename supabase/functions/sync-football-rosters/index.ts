import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { apiHeaders, API_BASE } from "../_shared/api.ts";
import { ALLOWED_LEAGUE_IDS } from "../_shared/leagues.ts";
import { readJsonWithLimit, RequestBodyTooLargeError } from "../_shared/request.ts";
import { getFootballSeasonForLeague } from "../_shared/season.ts";

const CORE_LEAGUES = [39, 40, 78, 140] as const;
const MAX_LEAGUES_PER_RUN = 10;
const MIN_AUTHORITATIVE_ROSTER_SIZE = 8;

interface SyncRequest {
  league_ids?: unknown;
  confirm_provider_calls?: unknown;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return handlePreflight(origin, req);
  if (req.method !== "POST") return errorResponse("Method not allowed", origin, 405, req);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse("Missing server configuration", origin, 500, req);
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const auth = await checkCronOrAdminAuth(req, supabase, serviceRoleKey, "[sync-football-rosters]");
    if (!auth.authorized) return errorResponse("Unauthorized", origin, 401, req);

    const body = (await readJsonWithLimit(req, 8_192).catch((error) => {
      if (error instanceof RequestBodyTooLargeError) throw error;
      return {};
    })) as SyncRequest;
    const requested = Array.isArray(body?.league_ids) ? body.league_ids : [...CORE_LEAGUES];
    const leagueIds = [...new Set(
      requested
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && ALLOWED_LEAGUE_IDS.includes(value)),
    )].slice(0, MAX_LEAGUES_PER_RUN);
    if (leagueIds.length === 0) return errorResponse("No supported leagues requested", origin, 400, req);

    const plan = leagueIds.map((leagueId) => ({
      league_id: leagueId,
      season: getFootballSeasonForLeague(leagueId),
    }));
    if (body?.confirm_provider_calls !== true) {
      return jsonResponse({
        success: true,
        dry_run: true,
        provider_calls: 0,
        plan,
        message: "Set confirm_provider_calls=true only after quota approval.",
      }, origin, 200, req);
    }

    const results: Array<Record<string, unknown>> = [];
    let failed = 0;
    let providerCalls = 0;
    for (const { league_id: leagueId, season } of plan) {
      try {
        const headers = apiHeaders();
        providerCalls += 1;
        const response = await fetch(`${API_BASE}/teams?league=${leagueId}&season=${season}`, {
          headers,
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`provider_http_${response.status}`);
        const payload = await response.json();
        const providerTeams = Array.isArray(payload?.response) ? payload.response : [];
        const teams = providerTeams
          .map((entry: any) => ({
            team_id: Number(entry?.team?.id),
            team_name: String(entry?.team?.name ?? "").trim(),
            team_code: entry?.team?.code ?? null,
            team_country: entry?.team?.country ?? null,
            team_logo: entry?.team?.logo ?? null,
            venue: entry?.venue ?? {},
          }))
          .filter((team: any) => Number.isInteger(team.team_id) && team.team_id > 0 && team.team_name);
        const uniqueTeamIds = new Set(teams.map((team: any) => team.team_id));
        if (
          teams.length !== providerTeams.length
          || uniqueTeamIds.size !== teams.length
          || teams.length < MIN_AUTHORITATIVE_ROSTER_SIZE
        ) {
          throw new Error("provider_returned_incomplete_or_invalid_roster");
        }

        const { data: activeCount, error: replaceError } = await supabase.rpc(
          "replace_football_league_roster",
          { p_league_id: leagueId, p_season: season, p_teams: teams },
        );
        if (replaceError) throw replaceError;
        results.push({ league_id: leagueId, season, active_teams: activeCount, success: true });
      } catch (error) {
        failed += 1;
        results.push({
          league_id: leagueId,
          season,
          success: false,
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }

    await supabase.from("pipeline_run_logs").insert({
      job_name: "sync-football-rosters",
      run_started: new Date().toISOString(),
      run_finished: new Date().toISOString(),
      success: failed === 0,
      mode: auth.method,
      processed: results.length - failed,
      failed,
      leagues_covered: leagueIds,
      details: { provider_calls: providerCalls, results },
      error_message: failed ? `${failed} roster sync(s) failed` : null,
    });

    return jsonResponse(
      { success: failed === 0, dry_run: false, provider_calls: providerCalls, results },
      origin,
      failed === 0 ? 200 : 502,
      req,
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return errorResponse(error.message, origin, 413, req);
    }
    console.error("[sync-football-rosters]", error);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
