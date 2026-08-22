/**
 * AUTO-BACKFILL-RESULTS (Gate D remediation — hardened)
 *
 * Modes:
 *  - targeted : exactly one explicit fixture_id. Goals-only = max 1 provider call,
 *               with statistics = max 2. Mutates only that fixture's fixture_results
 *               row, its fixtures.status (when the provider justifies it) and this
 *               function's own audit logs.
 *  - bulk     : legacy queue drain, now bounded by an explicit ProviderCallBudget.
 *
 * Invariants:
 *  - Every provider request requires confirm_provider_calls=true.
 *  - maxRetries = 0. Immediate stop on 429 / 5xx / timeout / network / budget exhaustion.
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
  ProviderStopError,
  requireConfirmation,
  runTargetedFixtureIngestion,
  validateBoundedInt,
  validateFixtureId,
  ValidationError,
  buildFixtureResultRow,
  isTerminalStatus,
  type FixtureResultRow,
} from "../_shared/result_ingestion.ts";

const SUPPORTED_LEAGUES = [39, 40, 78, 140, 135, 61, 2, 3, 848, 45, 48, 66, 81, 137, 143];
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 50;
const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_LOOKBACK_DAYS = 365;
const MAX_BULK_PROVIDER_CALLS = 100;
const WATCHDOG_CONSECUTIVE_ZERO_THRESHOLD = 3;

async function finalizePipelineLog(
  supabase: any,
  id: number | null,
  success: boolean,
  processed: number,
  failed: number,
  leagues: number[],
  details: any,
  errorMessage?: string,
): Promise<void> {
  if (!id) return;
  try {
    await supabase.from("pipeline_run_logs").update({
      run_finished: new Date().toISOString(),
      success,
      processed,
      failed,
      leagues_covered: leagues,
      details,
      error_message: errorMessage || null,
    }).eq("id", id);
  } catch (e) {
    console.error("[auto-backfill] Failed to update pipeline log:", e);
  }
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

      const { data: localFixture } = await supabase
        .from("fixtures").select("id, status").eq("id", fixtureId).maybeSingle();

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
        localStatus: localFixture?.status ?? null,
        writer: {
          upsertFixtureResult: async (row) => {
            const { error } = await supabase.from("fixture_results")
              .upsert([row], { onConflict: "fixture_id" });
            if (error) throw new Error(`upsert_failed: ${error.message}`);
          },
          updateFixtureStatus: async (id, status) => {
            await supabase.from("fixtures").update({ status }).eq("id", id);
          },
        },
      });

      await supabase.from("pipeline_run_logs").insert({
        job_name: "auto-backfill-results",
        run_started: new Date(startTime).toISOString(),
        run_finished: new Date().toISOString(),
        success: outcome.stop_reason === null,
        mode: "targeted",
        processed: 1,
        failed: outcome.result_written ? 0 : 1,
        leagues_covered: [],
        details: { ...outcome, ...session.snapshot(), include_statistics: includeStatistics },
        error_message: outcome.stop_reason ?? null,
      });

      return jsonResponse({
        success: outcome.stop_reason === null,
        mode: "targeted",
        scorer_chained: false,
        duration_ms: Date.now() - startTime,
        ...outcome,
        provider: session.snapshot(),
      }, origin, outcome.stop_reason ? 502 : 200, req);
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

    const { data: logData } = await supabase.from("pipeline_run_logs").insert({
      job_name: "auto-backfill-results",
      run_started: new Date().toISOString(),
      success: false,
      mode: "bulk",
      processed: 0,
      failed: 0,
      leagues_covered: [],
      details: { status: "started", batch_size: batchSize, lookback_days: lookbackDays },
    }).select("id").single();
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
        const pass1Ids = new Set((missingFixtures || []).map((f: any) => f.fixture_id));
        ticketMissingFixtures = ticketFixtures.filter((f: any) => !pass1Ids.has(f.fixture_id));
      }
    }

    const allMissing = [
      ...(missingFixtures || []).map((f: any) => ({
        fixture_id: f.fixture_id,
        fixture_league_id: f.fixture_league_id,
        fixture_status: f.fixture_status as string | null,
        source: "pass1_supported_leagues",
      })),
      ...ticketMissingFixtures.map((f: any) => ({
        fixture_id: f.fixture_id,
        fixture_league_id: f.league_id,
        fixture_status: null as string | null,
        source: "pass2_ticket_legs",
      })),
    ];

    let processed = 0;
    let failed = 0;
    let stopReason: string | null = null;
    const results: FixtureResultRow[] = [];
    const statusUpdates: { id: number; status: string }[] = [];
    const errors: { fixture_id: number; error: string }[] = [];
    const leagueSet = new Set<number>();

    for (const fixture of allMissing) {
      if (session.stopped || session.budget.remaining < (includeStatistics ? 2 : 1)) {
        stopReason = session.stopped ?? "provider_call_budget_exhausted";
        break;
      }
      processed++;
      if (fixture.fixture_league_id) leagueSet.add(fixture.fixture_league_id);
      try {
        const data = await session.get(`${API_BASE}/fixtures?id=${fixture.fixture_id}`);
        const apiFixture = Array.isArray(data) && data.length ? data[0] : null;
        if (!apiFixture?.fixture) {
          errors.push({ fixture_id: fixture.fixture_id, error: "no_provider_data" });
          failed++;
          continue;
        }
        const apiStatus: string = apiFixture.fixture?.status?.short ?? "NS";
        if (fixture.fixture_status !== apiStatus) {
          statusUpdates.push({ id: fixture.fixture_id, status: apiStatus });
        }
        if (!isTerminalStatus(apiStatus)) {
          errors.push({ fixture_id: fixture.fixture_id, error: `non_terminal_${apiStatus}` });
          continue;
        }
        let statsData: any = null;
        if (includeStatistics) {
          statsData = await session.get(`${API_BASE}/fixtures/statistics?fixture=${fixture.fixture_id}`);
        }
        results.push(buildFixtureResultRow(apiFixture, statsData));
      } catch (err) {
        if (err instanceof ProviderStopError) {
          stopReason = err.kind;
          console.warn(`[auto-backfill] Provider circuit breaker: ${err.kind}`);
          break;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push({ fixture_id: fixture.fixture_id, error: errMsg });
        failed++;
      }
    }

    let inserted = 0;
    if (results.length > 0) {
      const deduped = Array.from(new Map(results.map((r) => [r.fixture_id, r])).values());
      const { error: upsertError } = await supabase.from("fixture_results")
        .upsert(deduped, { onConflict: "fixture_id" });
      if (upsertError) {
        await finalizePipelineLog(supabase, pipelineLogId, false, processed, failed, [...leagueSet], { upsert_error: upsertError.message }, upsertError.message);
        return errorResponse(`Upsert failed: ${upsertError.message}`, origin, 500, req);
      }
      inserted = deduped.length;
    }

    let statusUpdateCount = 0;
    for (const update of statusUpdates) {
      const { error } = await supabase.from("fixtures").update({ status: update.status }).eq("id", update.id);
      if (!error) statusUpdateCount++;
    }

    const finalDuration = Date.now() - startTime;
    await finalizePipelineLog(supabase, pipelineLogId, stopReason === null, processed, failed, [...leagueSet], {
      missing_found: allMissing.length,
      inserted,
      status_updates: statusUpdateCount,
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
        (r: any) => r.details && (r.details.inserted === 0 || r.details.inserted === null),
      ).length;
      if (consecutiveZeros >= WATCHDOG_CONSECUTIVE_ZERO_THRESHOLD - 1) {
        backfillStalled = true;
        await supabase.rpc("record_pipeline_alert", {
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
      }
    }
    if (!backfillStalled) {
      await supabase.rpc("resolve_pipeline_alert", { p_fingerprint: backfillAlertFingerprint });
    }

    console.log("[auto-backfill] ===== FUNCTION END =====");
    return jsonResponse({
      success: stopReason === null,
      mode: "bulk",
      missing_found: allMissing.length,
      processed,
      inserted,
      failed,
      status_updates: statusUpdateCount,
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
