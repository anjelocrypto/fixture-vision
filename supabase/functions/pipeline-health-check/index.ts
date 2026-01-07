// Pipeline Health Check - Monitors data freshness and job health
// Returns OK/WARNING/CRITICAL status based on fixture coverage and job runs
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

// Key leagues to monitor
const MONITORED_LEAGUES = [
  { id: 39, name: "Premier League", country: "England", expected_teams: 20 },
  { id: 40, name: "Championship", country: "England", expected_teams: 24 },
  { id: 140, name: "La Liga", country: "Spain", expected_teams: 20 },
  { id: 141, name: "Segunda", country: "Spain", expected_teams: 22 },
  { id: 78, name: "Bundesliga", country: "Germany", expected_teams: 18 },
  { id: 79, name: "2. Bundesliga", country: "Germany", expected_teams: 18 },
  { id: 135, name: "Serie A", country: "Italy", expected_teams: 20 },
  { id: 136, name: "Serie B", country: "Italy", expected_teams: 20 },
  { id: 88, name: "Eredivisie", country: "Netherlands", expected_teams: 18 },
  { id: 61, name: "Ligue 1", country: "France", expected_teams: 18 },
  { id: 2, name: "UEFA Champions League", country: "UEFA", expected_teams: 36 },
  { id: 3, name: "UEFA Europa League", country: "UEFA", expected_teams: 36 },
  { id: 848, name: "UEFA Conference League", country: "UEFA", expected_teams: 36 },
];

// Critical jobs to monitor
const CRITICAL_JOBS = ["results-refresh", "stats-refresh"];

interface LeagueHealth {
  league_id: number;
  league_name: string;
  country: string;
  max_fixture_date: string | null;
  ft_fixtures_2025_26: number;
  results_2025_26: number;
  missing_results: number;
  status: "OK" | "WARNING" | "CRITICAL";
}

interface JobHealth {
  job_name: string;
  last_run: string | null;
  last_success: boolean | null;
  hours_since_last_run: number | null;
  status: "OK" | "WARNING" | "CRITICAL";
}

interface StatsCacheHealth {
  total_teams: number;
  updated_last_24h: number;
  updated_last_48h: number;
  coverage_24h_pct: number;
  coverage_48h_pct: number;
  oldest_update: string | null;
  newest_update: string | null;
  status: "OK" | "WARNING" | "CRITICAL";
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const startTime = Date.now();
  console.log("[pipeline-health-check] ===== HEALTH CHECK START =====");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse("Missing environment variables", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    
    // Auth check (allow cron key, service role, or admin) - NO .single() on scalar RPCs!
    const cronKeyHeader = req.headers.get("x-cron-key") ?? req.headers.get("X-CRON-KEY");
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    let isAuthorized = false;

    if (cronKeyHeader) {
      const { data: dbKey, error: keyError } = await supabase.rpc("get_cron_internal_key");
      if (keyError) {
        console.error("[pipeline-health-check] get_cron_internal_key error:", keyError);
      } else {
        const expectedKey = String(dbKey || "").trim();
        const providedKey = String(cronKeyHeader || "").trim();
        if (providedKey && expectedKey && providedKey === expectedKey) {
          isAuthorized = true;
          console.log("[pipeline-health-check] Authorized via X-CRON-KEY");
        }
      }
    }
    
    if (!isAuthorized && authHeader === `Bearer ${serviceRoleKey}`) {
      isAuthorized = true;
      console.log("[pipeline-health-check] Authorized via service role");
    }
    
    if (!isAuthorized && authHeader) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (anonKey) {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } }
        });
        const { data: isWhitelisted, error: wlError } = await userClient.rpc("is_user_whitelisted");
        if (wlError) {
          console.error("[pipeline-health-check] is_user_whitelisted error:", wlError);
        } else if (isWhitelisted === true) {
          isAuthorized = true;
          console.log("[pipeline-health-check] Authorized via admin user");
        }
      }
    }

    if (!isAuthorized) {
      console.error("[pipeline-health-check] Authorization failed - no valid credentials");
      return errorResponse("Unauthorized", origin, 401, req);
    }

    const issues: string[] = [];
    const seasonStart = "2025-08-01";

    // ===========================================
    // 1. CHECK LEAGUE FIXTURE/RESULTS COVERAGE
    // ===========================================
    console.log("[pipeline-health-check] Checking league fixture/results coverage...");
    
    const leagueHealthResults: LeagueHealth[] = [];
    
    for (const league of MONITORED_LEAGUES) {
      // Get max fixture date
      const { data: maxFixture } = await supabase
        .from("fixtures")
        .select("date")
        .eq("league_id", league.id)
        .order("date", { ascending: false })
        .limit(1)
        .single();

      // Count FT fixtures since season start
      const { count: ftCount } = await supabase
        .from("fixtures")
        .select("*", { count: "exact", head: true })
        .eq("league_id", league.id)
        .eq("status", "FT")
        .gte("date", seasonStart);

      // Count results since season start
      const { count: resultsCount } = await supabase
        .from("fixture_results")
        .select("*", { count: "exact", head: true })
        .eq("league_id", league.id)
        .gte("kickoff_at", seasonStart);

      const missingResults = (ftCount || 0) - (resultsCount || 0);
      
      let status: "OK" | "WARNING" | "CRITICAL" = "OK";
      if (missingResults > 10) {
        status = "CRITICAL";
        issues.push(`${league.name}: ${missingResults} missing results`);
      } else if (missingResults > 0) {
        status = "WARNING";
        issues.push(`${league.name}: ${missingResults} missing results (minor)`);
      }

      leagueHealthResults.push({
        league_id: league.id,
        league_name: league.name,
        country: league.country,
        max_fixture_date: maxFixture?.date || null,
        ft_fixtures_2025_26: ftCount || 0,
        results_2025_26: resultsCount || 0,
        missing_results: Math.max(0, missingResults),
        status,
      });
    }

    // ===========================================
    // 2. CHECK STATS CACHE FRESHNESS
    // ===========================================
    console.log("[pipeline-health-check] Checking stats cache freshness...");

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const { count: totalTeams } = await supabase
      .from("stats_cache")
      .select("*", { count: "exact", head: true });

    const { count: updated24h } = await supabase
      .from("stats_cache")
      .select("*", { count: "exact", head: true })
      .gte("computed_at", last24h.toISOString());

    const { count: updated48h } = await supabase
      .from("stats_cache")
      .select("*", { count: "exact", head: true })
      .gte("computed_at", last48h.toISOString());

    const { data: oldestStats } = await supabase
      .from("stats_cache")
      .select("computed_at")
      .order("computed_at", { ascending: true })
      .limit(1)
      .single();

    const { data: newestStats } = await supabase
      .from("stats_cache")
      .select("computed_at")
      .order("computed_at", { ascending: false })
      .limit(1)
      .single();

    const coverage24hPct = totalTeams ? Math.round(((updated24h || 0) / totalTeams) * 100) : 0;
    const coverage48hPct = totalTeams ? Math.round(((updated48h || 0) / totalTeams) * 100) : 0;

    let statsCacheStatus: "OK" | "WARNING" | "CRITICAL" = "OK";
    if (coverage48hPct < 70) {
      statsCacheStatus = "CRITICAL";
      issues.push(`Stats cache critically stale: only ${coverage48hPct}% updated in 48h`);
    } else if (coverage48hPct < 85) {
      statsCacheStatus = "WARNING";
      issues.push(`Stats cache degraded: ${coverage48hPct}% updated in 48h`);
    }

    const statsCacheHealth: StatsCacheHealth = {
      total_teams: totalTeams || 0,
      updated_last_24h: updated24h || 0,
      updated_last_48h: updated48h || 0,
      coverage_24h_pct: coverage24hPct,
      coverage_48h_pct: coverage48hPct,
      oldest_update: oldestStats?.computed_at || null,
      newest_update: newestStats?.computed_at || null,
      status: statsCacheStatus,
    };

    // ===========================================
    // 3. CHECK RECENT PIPELINE JOB RUNS
    // ===========================================
    console.log("[pipeline-health-check] Checking recent pipeline job runs...");

    const last6h = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    const jobHealthResults: JobHealth[] = [];

    for (const jobName of CRITICAL_JOBS) {
      // Check pipeline_run_logs first, fall back to optimizer_run_logs
      let lastRun = null;
      let lastSuccess = null;

      // Try pipeline_run_logs
      const { data: pipelineLog } = await supabase
        .from("pipeline_run_logs")
        .select("run_started, success")
        .eq("job_name", jobName)
        .order("run_started", { ascending: false })
        .limit(1)
        .single();

      if (pipelineLog) {
        lastRun = pipelineLog.run_started;
        lastSuccess = pipelineLog.success;
      } else {
        // Fall back to optimizer_run_logs
        const runType = jobName === "stats-refresh" ? "stats-refresh-batch" : "results-refresh";
        const { data: optimizerLog } = await supabase
          .from("optimizer_run_logs")
          .select("started_at, finished_at")
          .eq("run_type", runType)
          .order("started_at", { ascending: false })
          .limit(1)
          .single();

        if (optimizerLog) {
          lastRun = optimizerLog.started_at;
          lastSuccess = !!optimizerLog.finished_at;
        }
      }

      const hoursSinceRun = lastRun
        ? (now.getTime() - new Date(lastRun).getTime()) / (1000 * 60 * 60)
        : null;

      let status: "OK" | "WARNING" | "CRITICAL" = "OK";
      if (hoursSinceRun === null || hoursSinceRun > 6) {
        status = "CRITICAL";
        issues.push(`${jobName}: no runs in last 6 hours`);
      } else if (hoursSinceRun > 3) {
        status = "WARNING";
      }

      jobHealthResults.push({
        job_name: jobName,
        last_run: lastRun,
        last_success: lastSuccess,
        hours_since_last_run: hoursSinceRun ? Math.round(hoursSinceRun * 10) / 10 : null,
        status,
      });
    }

    // ===========================================
    // 4. COMPUTE OVERALL STATUS
    // ===========================================
    let overallStatus: "OK" | "WARNING" | "CRITICAL" = "OK";
    
    const hasCriticalLeague = leagueHealthResults.some(l => l.status === "CRITICAL");
    const hasCriticalJob = jobHealthResults.some(j => j.status === "CRITICAL");
    const hasCriticalStats = statsCacheHealth.status === "CRITICAL";
    
    if (hasCriticalLeague || hasCriticalJob || hasCriticalStats) {
      overallStatus = "CRITICAL";
    } else if (
      leagueHealthResults.some(l => l.status === "WARNING") ||
      jobHealthResults.some(j => j.status === "WARNING") ||
      statsCacheHealth.status === "WARNING"
    ) {
      overallStatus = "WARNING";
    }

    const durationMs = Date.now() - startTime;
    console.log(`[pipeline-health-check] Status: ${overallStatus}, Issues: ${issues.length}, Duration: ${durationMs}ms`);
    console.log("[pipeline-health-check] ===== HEALTH CHECK END =====");

    // Log this health check run
    await supabase.from("pipeline_run_logs").insert({
      job_name: "pipeline-health-check",
      run_started: new Date(startTime).toISOString(),
      run_finished: new Date().toISOString(),
      success: true,
      mode: "scheduled",
      processed: MONITORED_LEAGUES.length,
      failed: issues.length,
      leagues_covered: MONITORED_LEAGUES.map(l => l.id),
      details: { overall_status: overallStatus, issue_count: issues.length },
    });

    const response = {
      status: overallStatus,
      checked_at: new Date().toISOString(),
      duration_ms: durationMs,
      leagues: leagueHealthResults,
      stats_cache: statsCacheHealth,
      jobs: jobHealthResults,
      issues,
      summary: {
        leagues_checked: leagueHealthResults.length,
        leagues_ok: leagueHealthResults.filter(l => l.status === "OK").length,
        leagues_warning: leagueHealthResults.filter(l => l.status === "WARNING").length,
        leagues_critical: leagueHealthResults.filter(l => l.status === "CRITICAL").length,
        total_missing_results: leagueHealthResults.reduce((sum, l) => sum + l.missing_results, 0),
      },
    };

    // Return non-200 for CRITICAL status so cron logs show failure
    const httpStatus = overallStatus === "CRITICAL" ? 500 : 200;
    
    return new Response(JSON.stringify(response, null, 2), {
      status: httpStatus,
      headers: {
        ...getCorsHeaders(origin, req),
        "Content-Type": "application/json",
      },
    });

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[pipeline-health-check] Error:", errMsg);
    return errorResponse(`Health check failed: ${errMsg}`, origin, 500, req);
  }
});