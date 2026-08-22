/**
 * PIPELINE-HEALTH-SNAPSHOT: Health monitoring + watchdog alerts
 * 
 * RUNS: Every 10 minutes via cron
 * PURPOSE:
 *   1. Log health snapshot to pipeline_run_logs
 *   2. Scorer watchdog: alert if pending_with_ft > 0 for 2+ consecutive checks
 *   3. Backfill watchdog: alert if pending_missing stays flat for 3+ checks
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";
import {
  derivePipelineHealth,
  shouldResolveBackfillAlert,
  shouldResolveScorerAlert,
} from "../_shared/gate_d_health.ts";

const LOG = "[health-snapshot]";

interface HealthMetrics {
  pending_missing_fixture_results: number;
  pending_with_ft_results: number;
  pending_older_than_6h: number;
  total_win: number;
  total_loss: number;
  total_void: number;
  total_pending: number;
  cards_leakage_24h: number;
  blacklist_leakage_24h: number;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return handlePreflight(origin, req);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse("Missing configuration", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Auth check
    const auth = await checkCronOrAdminAuth(req, supabase, serviceRoleKey, LOG);
    if (!auth.authorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }

    console.log(`${LOG} Running health snapshot (auth: ${auth.method})`);

    // ===== Collect all metrics in parallel =====
    // Use { count: "exact", head: true } properly — the count comes from the response metadata
    const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const [
      older6hResult,
      winsResult,
      lossesResult,
      voidResult,
      pendingResult,
      cardsResult,
      blacklistResult,
      pipelineMetricsResult,
    ] = await Promise.all([
      // pending_older_than_6h — head count
      supabase.from("ticket_leg_outcomes")
        .select("id", { count: "exact", head: true })
        .eq("result_status", "PENDING")
        .lt("kickoff_at", sixHoursAgo),

      // Status counts use aggregate metadata so the 1,000-row REST response
      // limit can never truncate the health snapshot.
      supabase.from("ticket_leg_outcomes")
        .select("id", { count: "exact", head: true })
        .eq("result_status", "WIN"),
      supabase.from("ticket_leg_outcomes")
        .select("id", { count: "exact", head: true })
        .eq("result_status", "LOSS"),
      supabase.from("ticket_leg_outcomes")
        .select("id", { count: "exact", head: true })
        .eq("result_status", "VOID"),
      supabase.from("ticket_leg_outcomes")
        .select("id", { count: "exact", head: true })
        .eq("result_status", "PENDING"),

      // cards leakage 24h — head count
      supabase.from("ticket_leg_outcomes")
        .select("id", { count: "exact", head: true })
        .eq("market", "cards")
        .gt("created_at", twentyFourHoursAgo),

      // blacklist leakage 24h — head count
      supabase.from("ticket_leg_outcomes")
        .select("id", { count: "exact", head: true })
        .in("league_id", [172, 71, 143, 235, 271, 129, 136, 48])
        .gt("created_at", twentyFourHoursAgo),

      supabase.rpc("get_ticket_pipeline_health_metrics"),
    ]);

    const metricResults = [
      older6hResult,
      winsResult,
      lossesResult,
      voidResult,
      pendingResult,
      cardsResult,
      blacklistResult,
      pipelineMetricsResult,
    ];
    const metricErrors = metricResults
      .map((result) => result.error?.message)
      .filter((message): message is string => Boolean(message));
    if (metricErrors.length > 0) {
      await supabase.from("pipeline_run_logs").insert({
        job_name: "pipeline-health-snapshot",
        run_started: new Date().toISOString(),
        run_finished: new Date().toISOString(),
        success: false,
        mode: "snapshot",
        processed: 0,
        failed: metricErrors.length,
        leagues_covered: [],
        details: { health: "UNKNOWN", metric_errors: metricErrors },
        error_message: metricErrors.join(" | ").slice(0, 1000),
      });
      return errorResponse("Health metrics unavailable", origin, 503, req);
    }

    const metrics: HealthMetrics = {
      pending_missing_fixture_results: Number(
        pipelineMetricsResult.data?.pending_missing_fixture_results ?? 0,
      ),
      pending_with_ft_results: Number(
        pipelineMetricsResult.data?.pending_with_ft_results ?? 0,
      ),
      pending_older_than_6h: older6hResult.count ?? 0,
      total_win: winsResult.count ?? 0,
      total_loss: lossesResult.count ?? 0,
      total_void: voidResult.count ?? 0,
      total_pending: pendingResult.count ?? 0,
      cards_leakage_24h: cardsResult.count ?? 0,
      blacklist_leakage_24h: blacklistResult.count ?? 0,
    };

    console.log(`${LOG} Metrics:`, JSON.stringify(metrics));

    // ===== Log snapshot =====
    await supabase.from("pipeline_run_logs").insert({
      job_name: "pipeline-health-snapshot",
      run_started: new Date().toISOString(),
      run_finished: new Date().toISOString(),
      success: true,
      mode: "snapshot",
      processed: metrics.total_win + metrics.total_loss + metrics.total_void,
      failed: 0,
      leagues_covered: [],
      details: metrics,
    });

    // ===== WATCHDOG 1: Scorer health =====
    const alerts: string[] = [];
    const scorerFingerprint = "pipeline:score-ticket-legs:stalled";
    let scorerStalled = false;
    if (metrics.pending_with_ft_results > 0) {
      const { data: prevSnapshots } = await supabase
        .from("pipeline_run_logs")
        .select("details")
        .eq("job_name", "pipeline-health-snapshot")
        .eq("success", true)
        .order("run_started", { ascending: false })
        .limit(2);

      const prevAlsoPositive = prevSnapshots && prevSnapshots.length >= 2 &&
        (prevSnapshots[1] as any)?.details?.pending_with_ft_results > 0;

      if (prevAlsoPositive) {
        scorerStalled = true;
        const msg = `Scorer stalled: pending_with_ft_results=${metrics.pending_with_ft_results} for 2+ consecutive checks`;
        console.error(`${LOG} ALERT: ${msg}`);
        alerts.push(msg);
        await supabase.rpc("record_pipeline_alert", {
          p_fingerprint: scorerFingerprint,
          p_alert_type: "scorer_stalled",
          p_severity: "critical",
          p_message: "Ticket outcome scoring is stalled",
          p_details: { pending_with_ft: metrics.pending_with_ft_results, metrics },
        });
      } else {
        console.warn(`${LOG} pending_with_ft=${metrics.pending_with_ft_results} (first occurrence, watching)`);
      }
    }
    if (!scorerStalled && shouldResolveScorerAlert(metrics)) {
      await supabase.rpc("resolve_pipeline_alert", { p_fingerprint: scorerFingerprint });
    }

    // ===== WATCHDOG 2: Backfill stall =====
    const backfillFingerprint = "pipeline:auto-backfill-results:stalled";
    let backfillStalled = false;
    if (metrics.pending_missing_fixture_results > 50) {
      const { data: recentBackfills } = await supabase
        .from("pipeline_run_logs")
        .select("details")
        .eq("job_name", "auto-backfill-results")
        .eq("success", true)
        .order("run_started", { ascending: false })
        .limit(3);

      const allZeroInserts = recentBackfills && recentBackfills.length >= 3 &&
        recentBackfills.every((r: any) => !r.details?.inserted || r.details.inserted === 0);

      if (allZeroInserts) {
        backfillStalled = true;
        const msg = `Backfill stalled: ${metrics.pending_missing_fixture_results} missing fixtures but 3 consecutive zero-insert runs`;
        console.error(`${LOG} ALERT: ${msg}`);
        alerts.push(msg);
        await supabase.rpc("record_pipeline_alert", {
          p_fingerprint: backfillFingerprint,
          p_alert_type: "backfill_stalled",
          p_severity: "warning",
          p_message: "Fixture-result backfill is stalled",
          p_details: { pending_missing: metrics.pending_missing_fixture_results, metrics },
        });
      }
    }
    if (!backfillStalled && shouldResolveBackfillAlert(metrics)) {
      await supabase.rpc("resolve_pipeline_alert", { p_fingerprint: backfillFingerprint });
    }

    const health = derivePipelineHealth(metrics, alerts);

    console.log(`${LOG} Health: ${health}`);

    return jsonResponse({
      success: true,
      health,
      metrics,
      alerts,
    }, origin, 200, req);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} Error:`, msg);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
