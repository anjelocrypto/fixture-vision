/**
 * AUTO-BACKFILL-RESULTS (Gate D RC3 — consolidated strict path)
 *
 * Modes:
 *  - targeted : exactly one explicit fixture_id. Goals-only = max 1 provider call,
 *               with statistics = max 2.
 *  - bulk     : bounded queue drain. Every fixture goes through the SAME strict
 *               parser and the SAME atomic service-role writer as targeted mode.
 *
 * Invariants:
 *  - Every provider request requires confirm_provider_calls=true.
 *  - maxRetries = 0, explicit per-request timeout, immediate circuit on
 *    timeout / network / 401 / 403 / 429 / 5xx / malformed JSON / bad schema.
 *  - The fixture must exist locally before a provider call is spent.
 *  - Provider fixture id must equal the requested id; invalid/incomplete/empty
 *    payloads write nothing at all.
 *  - Identity, status and results are persisted in one database transaction.
 *  - No score-ticket-legs chaining (scoring is separately authorized).
 *  - No secrets or secret prefixes are ever logged.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { API_BASE, apiHeaders } from "../_shared/api.ts";
import { ProviderCallBudget } from "../_shared/provider_budget.ts";
import {
  authorizeIngestionRequest,
  buildTargetedBudget,
  ProviderSession,
  requireConfirmation,
  runTargetedFixtureIngestion,
  validateBoundedInt,
  validateFixtureId,
  ValidationError,
  type TargetedOutcome,
  type TargetedWriter,
} from "../_shared/result_ingestion.ts";

const SUPPORTED_LEAGUES = [39, 40, 78, 140, 135, 61, 2, 3, 848, 45, 48, 66, 81, 137, 143];
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 50;
const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_LOOKBACK_DAYS = 365;
const MAX_BULK_PROVIDER_CALLS = 100;
const WATCHDOG_CONSECUTIVE_ZERO_THRESHOLD = 3;

// deno-lint-ignore no-explicit-any
function makeWriter(supabase: any): TargetedWriter {
  return {
    loadLocalFixture: async (fixtureId: number) => {
      const { data, error } = await supabase
        .from("fixtures").select("id, status").eq("id", fixtureId).maybeSingle();
      if (error) throw new Error(`local_fixture_lookup_failed: ${error.message}`);
      return data ? { id: data.id as number, status: (data.status as string | null) ?? null } : null;
    },
    ingestAtomically: async (payload) => {
      const { error } = await supabase.rpc("ingest_fixture_result_tx", {
        p_fixture_id: payload.fixture_id,
        p_league_id: payload.league_id,
        p_status: payload.status,
        p_kickoff_at: payload.kickoff_at,
        p_home_team_id: payload.home_team_id,
        p_away_team_id: payload.away_team_id,
        p_goals_home: payload.goals_home,
        p_goals_away: payload.goals_away,
        p_stats: payload.stats,
      });
      if (error) throw new Error(`ingest_transaction_failed: ${error.message}`);
    },
  };
}

async function finalizePipelineLog(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  id: number | null,
  success: boolean,
  processed: number,
  failed: number,
  leagues: number[],
  // deno-lint-ignore no-explicit-any
  details: any,
  errorMessage?: string,
): Promise<void> {
  if (!id) return;
  const { error } = await supabase.from("pipeline_run_logs").update({
    run_finished: new Date().toISOString(),
    success,
    processed,
    failed,
    leagues_covered: leagues,
    details,
    error_message: errorMessage || null,
  }).eq("id", id);
  if (error) console.error("[auto-backfill] Failed to update pipeline log:", error.message);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return handlePreflight(origin, req);

  const startTime = Date.now();
  console.log("[auto-backfill] ===== FUNCTION START =====");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse("Missing configuration", origin, 500, req);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ---- Authorization: default deny, never log key material -----------------
  const auth = await authorizeIngestionRequest({
    serviceRoleKey,
    cronKeyHeader: req.headers.get("x-cron-key") ?? req.headers.get("X-CRON-KEY"),
    authHeader: req.headers.get("authorization") ?? req.headers.get("Authorization"),
    lookupCronKey: async () => {
      const { data } = await supabase.rpc("get_cron_internal_key");
      return typeof data === "string" ? data : null;
    },
    verifyAdmin: async (authHeader: string) => {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (!anonKey) return false;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await userClient.rpc("is_user_whitelisted");
      return data === true;
    },
  });

  if (!auth.authorized) {
    console.error("[auto-backfill] Authorization failed");
    return errorResponse("Unauthorized", origin, 401, req);
  }
  console.log(`[auto-backfill] Authorized via ${auth.method}`);

  let body: Record<string, unknown> = {};
  try {
    if (req.method === "POST") body = (await req.json()) ?? {};
  } catch {
    body = {};
  }

  const writer = makeWriter(supabase);

  try {
    // Every mode of this function touches the provider — fail closed first.
    requireConfirmation(body);

    // ======================= TARGETED MODE =================================
    if (body.mode === "targeted" || body.fixture_id !== undefined) {
      if (body.mode !== undefined && body.mode !== "targeted") {
        throw new ValidationError("invalid_parameter", "mode must be 'targeted' when fixture_id is provided");
      }
      const fixtureId = validateFixtureId(body.fixture_id);
      const includeStatistics = body.include_statistics === true;
      const budget = buildTargetedBudget(includeStatistics, body.max_provider_calls);

      const session = new ProviderSession({
        budget,
        fetchImpl: (url, init) => fetch(url, init as RequestInit),
        headers: apiHeaders(),
      });

      const outcome = await runTargetedFixtureIngestion({
        fixtureId,
        apiBase: API_BASE,
        session,
        includeStatistics,
        writer,
      });

      const { error: logError } = await supabase.from("pipeline_run_logs").insert({
        job_name: "auto-backfill-results",
        run_started: new Date(startTime).toISOString(),
        run_finished: new Date().toISOString(),
        success: outcome.success,
        mode: "targeted",
        processed: 1,
        failed: outcome.success ? 0 : 1,
        leagues_covered: [],
        details: { ...outcome, ...session.snapshot(), include_statistics: includeStatistics },
        error_message: outcome.success ? null : (outcome.reason ?? outcome.state),
      });
      if (logError) console.error("[auto-backfill] pipeline log insert failed:", logError.message);

      const httpStatus = outcome.success
        ? 200
        : outcome.state === "provider_error"
        ? 502
        : outcome.state === "non_terminal_no_change"
        ? 200
        : 422;

      return jsonResponse({
        ...outcome,
        success: outcome.success,
        mode: "targeted",
        scorer_chained: false,
        duration_ms: Date.now() - startTime,
        provider: session.snapshot(),
      }, origin, httpStatus, req);
    }

    // ========================= BULK MODE ===================================
    const batchSize = validateBoundedInt(body.batch_size, {
      name: "batch_size", min: 1, max: MAX_BATCH_SIZE, fallback: DEFAULT_BATCH_SIZE,
    });
    const lookbackDays = validateBoundedInt(body.lookback_days, {
      name: "lookback_days", min: 1, max: MAX_LOOKBACK_DAYS, fallback: DEFAULT_LOOKBACK_DAYS,
    });
    const includeStatistics = body.include_statistics !== false;
    const hardBulkLimit = Math.min(MAX_BULK_PROVIDER_CALLS, batchSize * (includeStatistics ? 2 : 1));
    const providerCallLimit = validateBoundedInt(body.max_provider_calls, {
      name: "max_provider_calls", min: 1, max: hardBulkLimit, fallback: hardBulkLimit,
    });

    const session = new ProviderSession({
      budget: new ProviderCallBudget(providerCallLimit),
      fetchImpl: (url, init) => fetch(url, init as RequestInit),
      headers: apiHeaders(),
    });

    const { data: logData, error: logStartError } = await supabase.from("pipeline_run_logs").insert({
      job_name: "auto-backfill-results",
      run_started: new Date().toISOString(),
      success: false,
      mode: "bulk",
      processed: 0,
      failed: 0,
      leagues_covered: [],
      details: { status: "started", batch_size: batchSize, lookback_days: lookbackDays },
    }).select("id").single();
    if (logStartError) {
      return errorResponse(`Pipeline log insert failed: ${logStartError.message}`, origin, 500, req);
    }
    const pipelineLogId: number | null = logData?.id ?? null;

    const { data: missingFixtures, error: rpcError } = await supabase.rpc("get_fixtures_missing_results", {
      lookback_days: lookbackDays,
      supported_leagues: SUPPORTED_LEAGUES,
      batch_limit: batchSize,
    });
    if (rpcError) {
      await finalizePipelineLog(supabase, pipelineLogId, false, 0, 0, [], { error: rpcError.message }, rpcError.message);
      return errorResponse(`RPC error: ${rpcError.message}`, origin, 500, req);
    }

    const remainingSlots = Math.max(0, batchSize - (missingFixtures?.length || 0));
    let ticketMissingFixtures: Array<{ fixture_id: number; kickoff_at: string; league_id: number }> = [];
    if (remainingSlots > 0) {
      const { data: ticketFixtures, error: ticketRpcError } = await supabase.rpc("get_pending_ticket_fixture_ids", {
        batch_limit: remainingSlots,
      });
      if (ticketRpcError) {
        console.warn("[auto-backfill] get_pending_ticket_fixture_ids error (non-fatal)");
      } else if (ticketFixtures?.length) {
        // deno-lint-ignore no-explicit-any
        const pass1Ids = new Set((missingFixtures || []).map((f: any) => f.fixture_id));
        // deno-lint-ignore no-explicit-any
        ticketMissingFixtures = ticketFixtures.filter((f: any) => !pass1Ids.has(f.fixture_id));
      }
    }

    const allMissing = [
      // deno-lint-ignore no-explicit-any
      ...(missingFixtures || []).map((f: any) => ({
        fixture_id: f.fixture_id as number,
        fixture_league_id: f.fixture_league_id as number | null,
        source: "pass1_supported_leagues",
      })),
      // deno-lint-ignore no-explicit-any
      ...ticketMissingFixtures.map((f: any) => ({
        fixture_id: f.fixture_id as number,
        fixture_league_id: (f.league_id as number | null) ?? null,
        source: "pass2_ticket_legs",
      })),
    ];

    let processed = 0;
    let failed = 0;
    let inserted = 0;
    let stopReason: string | null = null;
    const errors: { fixture_id: number; error: string }[] = [];
    const leagueSet = new Set<number>();

    for (const fixture of allMissing) {
      if (session.stopped || session.budget.remaining < (includeStatistics ? 2 : 1)) {
        stopReason = session.stopped ?? "provider_call_budget_exhausted";
        break;
      }
      processed++;
      if (fixture.fixture_league_id) leagueSet.add(fixture.fixture_league_id);

      // Identical strict path as targeted mode: same parser, same atomic writer.
      const outcome: TargetedOutcome = await runTargetedFixtureIngestion({
        fixtureId: fixture.fixture_id,
        apiBase: API_BASE,
        session,
        includeStatistics,
        writer,
      });

      if (outcome.success) {
        inserted++;
        continue;
      }
      if (outcome.state === "provider_error") {
        stopReason = outcome.stop_reason ?? "provider_error";
        console.warn(`[auto-backfill] Provider circuit breaker: ${stopReason}`);
        break;
      }
      if (outcome.state === "non_terminal_no_change") {
        errors.push({ fixture_id: fixture.fixture_id, error: `non_terminal_${outcome.provider_status}` });
        continue;
      }
      failed++;
      errors.push({ fixture_id: fixture.fixture_id, error: outcome.reason ?? outcome.state });
    }

    const finalDuration = Date.now() - startTime;
    await finalizePipelineLog(supabase, pipelineLogId, stopReason === null, processed, failed, [...leagueSet], {
      missing_found: allMissing.length,
      inserted,
      duration_ms: finalDuration,
      errors: errors.slice(0, 10),
      provider: session.snapshot(),
      stop_reason: stopReason,
      scorer_chained: false,
    }, stopReason ?? undefined);

    // Watchdog (unchanged semantics, no scorer chaining)
    const backfillAlertFingerprint = "pipeline:auto-backfill-results:stalled";
    let backfillStalled = false;
    if (inserted === 0 && allMissing.length > 0) {
      const { data: recentRuns } = await supabase
        .from("pipeline_run_logs")
        .select("id, details")
        .eq("job_name", "auto-backfill-results")
        .eq("success", true)
        .order("run_started", { ascending: false })
        .limit(WATCHDOG_CONSECUTIVE_ZERO_THRESHOLD);
      const consecutiveZeros = (recentRuns || []).filter(
        // deno-lint-ignore no-explicit-any
        (r: any) => r.details && (r.details.inserted === 0 || r.details.inserted === null),
      ).length;
      if (consecutiveZeros >= WATCHDOG_CONSECUTIVE_ZERO_THRESHOLD - 1) {
        backfillStalled = true;
        const { error } = await supabase.rpc("record_pipeline_alert", {
          p_fingerprint: backfillAlertFingerprint,
          p_alert_type: "backfill_stalled",
          p_severity: "warning",
          p_message: `Auto-backfill inserted no results for ${WATCHDOG_CONSECUTIVE_ZERO_THRESHOLD} consecutive runs`,
          p_details: {
            consecutive_zeros: WATCHDOG_CONSECUTIVE_ZERO_THRESHOLD,
            missing_fixtures: allMissing.length,
            last_errors: errors.slice(0, 5),
          },
        });
        if (error) console.error("[auto-backfill] record_pipeline_alert failed:", error.message);
      }
    }
    if (!backfillStalled) {
      const { error } = await supabase.rpc("resolve_pipeline_alert", { p_fingerprint: backfillAlertFingerprint });
      if (error) console.error("[auto-backfill] resolve_pipeline_alert failed:", error.message);
    }

    console.log("[auto-backfill] ===== FUNCTION END =====");
    return jsonResponse({
      success: stopReason === null,
      mode: "bulk",
      missing_found: allMissing.length,
      processed,
      inserted,
      failed,
      leagues_covered: [...leagueSet],
      stop_reason: stopReason,
      scorer_chained: false,
      provider: session.snapshot(),
      duration_ms: finalDuration,
    }, origin, stopReason ? 502 : 200, req);
  } catch (error) {
    if (error instanceof ValidationError) {
      return jsonResponse({ success: false, code: error.code, error: error.message }, origin, 400, req);
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[auto-backfill] Handler error:", errMsg);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
