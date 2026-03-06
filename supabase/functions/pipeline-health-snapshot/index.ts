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
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const [
      older6hResult,
      statusData,
      cardsResult,
      blacklistResult,
      pendingMissingResult,
      pendingWithFtResult,
    ] = await Promise.all([
      // pending_older_than_6h — head count
      supabase.from("ticket_leg_outcomes")
        .select("id", { count: "exact", head: true })
        .eq("result_status", "PENDING")
        .lt("kickoff_at", sixHoursAgo)
        .gt("kickoff_at", thirtyDaysAgo),

      // status breakdown (full rows needed for counting)
      supabase.from("ticket_leg_outcomes")
        .select("result_status")
        .gt("kickoff_at", thirtyDaysAgo),

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

      // pending_missing_fixture_results — lightweight count via head
      // Count PENDING legs whose fixture has no fixture_results row
      // We use get_pending_ticket_fixture_ids with a small limit just for count approximation
      // Actually, use a direct count: pending legs with kickoff > 2h ago, no matching fixture_results
      supabase.from("ticket_leg_outcomes")
        .select("fixture_id", { count: "exact", head: true })
        .eq("result_status", "PENDING")
        .lt("kickoff_at", twoHoursAgo)
        .gt("kickoff_at", thirtyDaysAgo),

      // pending_with_ft_results — join with fixture_results via inner join
      supabase.from("ticket_leg_outcomes")
        .select("id, fixture_results!inner(fixture_id)", { count: "exact", head: true })
        .eq("result_status", "PENDING")
        .eq("fixture_results.status", "FT")
        .lt("kickoff_at", twoHoursAgo)
        .gt("kickoff_at", thirtyDaysAgo),
    ]);

    // Count statuses
    const statusCounts = { WIN: 0, LOSS: 0, VOID: 0, PENDING: 0, PUSH: 0 };
    if (statusData.data) {
      for (const row of statusData.data) {
        const s = (row as any).result_status as string;
        if (s in statusCounts) statusCounts[s as keyof typeof statusCounts]++;
      }
    }

    const metrics: HealthMetrics = {
      pending_missing_fixture_results: (pendingMissingResult.count ?? 0) - (pendingWithFtResult.count ?? 0),
      pending_with_ft_results: pendingWithFtResult.count ?? 0,
      pending_older_than_6h: older6hResult.count ?? 0,
      total_win: statusCounts.WIN,
      total_loss: statusCounts.LOSS,
      total_void: statusCounts.VOID,
      total_pending: statusCounts.PENDING,
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
        const msg = `Scorer stalled: pending_with_ft_results=${metrics.pending_with_ft_results} for 2+ consecutive checks`;
        console.error(`${LOG} ALERT: ${msg}`);
        alerts.push(msg);
        await supabase.from("pipeline_alerts").insert({
          alert_type: "scorer_stalled",
          severity: "error",
          message: msg,
          details: { pending_with_ft: metrics.pending_with_ft_results, metrics },
        });
      } else {
        console.warn(`${LOG} pending_with_ft=${metrics.pending_with_ft_results} (first occurrence, watching)`);
      }
    }

    // ===== WATCHDOG 2: Backfill stall =====
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
        const msg = `Backfill stalled: ${metrics.pending_missing_fixture_results} missing fixtures but 3 consecutive zero-insert runs`;
        console.error(`${LOG} ALERT: ${msg}`);
        alerts.push(msg);
        await supabase.from("pipeline_alerts").insert({
          alert_type: "backfill_stalled",
          severity: "warning",
          message: msg,
          details: { pending_missing: metrics.pending_missing_fixture_results, metrics },
        });
      }
    }

    const health = (metrics.pending_with_ft_results === 0 && alerts.length === 0) ? "GREEN" :
      (alerts.length > 0 ? "RED" : "YELLOW");

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
