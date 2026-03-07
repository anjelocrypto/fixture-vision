// Pipeline Health Check - Monitors data freshness, job health, and optimized_selections coverage
// Returns OK/WARNING/CRITICAL status + auto-triggers optimizer if coverage is dangerously low
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";

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

const CRITICAL_JOBS = ["results-refresh", "stats-refresh"];

// Threshold: if optimized_selections with odds in next 48h < this, auto-trigger optimizer
const MIN_SELECTIONS_48H_WITH_ODDS = 50;

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

interface SelectionsCoverage {
  next_48h_total: number;
  next_48h_with_odds: number;
  next_7d_total: number;
  next_7d_with_odds: number;
  unique_fixtures_48h: number;
  unique_fixtures_7d: number;
  status: "OK" | "WARNING" | "CRITICAL";
  auto_triggered_optimizer: boolean;
}

interface CronJobLastRun {
  job_name: string;
  last_run_at: string | null;
  last_success: boolean | null;
  hours_ago: number | null;
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
    
    // Auth check
    const auth = await checkCronOrAdminAuth(req, supabase, serviceRoleKey, "[pipeline-health-check]");
    if (!auth.authorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }

    const issues: string[] = [];
    const now = new Date();
    const seasonStart = "2025-08-01";

    // ===========================================
    // 1. OPTIMIZED SELECTIONS COVERAGE (new!)
    // ===========================================
    console.log("[pipeline-health-check] Checking optimized_selections coverage...");
    
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const nowISO = now.toISOString();

    const [sel48h, sel48hOdds, sel7d, sel7dOdds] = await Promise.all([
      supabase.from("optimized_selections").select("fixture_id", { count: "exact", head: true })
        .gte("utc_kickoff", nowISO).lt("utc_kickoff", in48h),
      supabase.from("optimized_selections").select("fixture_id", { count: "exact", head: true })
        .gte("utc_kickoff", nowISO).lt("utc_kickoff", in48h).not("odds", "is", null),
      supabase.from("optimized_selections").select("fixture_id", { count: "exact", head: true })
        .gte("utc_kickoff", nowISO).lt("utc_kickoff", in7d),
      supabase.from("optimized_selections").select("fixture_id", { count: "exact", head: true })
        .gte("utc_kickoff", nowISO).lt("utc_kickoff", in7d).not("odds", "is", null),
    ]);

    // Get unique fixture counts
    const [fixtures48h, fixtures7d] = await Promise.all([
      supabase.from("optimized_selections").select("fixture_id")
        .gte("utc_kickoff", nowISO).lt("utc_kickoff", in48h),
      supabase.from("optimized_selections").select("fixture_id")
        .gte("utc_kickoff", nowISO).lt("utc_kickoff", in7d),
    ]);

    const uniqueFixtures48h = new Set(fixtures48h.data?.map((r: any) => r.fixture_id) || []).size;
    const uniqueFixtures7d = new Set(fixtures7d.data?.map((r: any) => r.fixture_id) || []).size;

    let selectionsStatus: "OK" | "WARNING" | "CRITICAL" = "OK";
    let autoTriggered = false;
    const sel48hWithOddsCount = sel48hOdds.count ?? 0;
    
    if (sel48hWithOddsCount < MIN_SELECTIONS_48H_WITH_ODDS) {
      selectionsStatus = "CRITICAL";
      issues.push(`optimized_selections next 48h with odds: ${sel48hWithOddsCount} (threshold: ${MIN_SELECTIONS_48H_WITH_ODDS})`);
      
      // Auto-trigger optimizer
      console.log(`[pipeline-health-check] ⚡ Auto-triggering optimizer: only ${sel48hWithOddsCount} selections with odds in 48h`);
      try {
        const optimizeUrl = `${supabaseUrl}/functions/v1/optimize-selections-refresh`;
        fetch(optimizeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ window_hours: 120 }),
        }).then(async (res) => {
          console.log(`[pipeline-health-check] Auto-trigger optimizer -> ${res.status}`);
        }).catch((e) => {
          console.error("[pipeline-health-check] Auto-trigger optimizer failed:", e?.message);
        });
        autoTriggered = true;
      } catch (triggerErr: any) {
        console.error("[pipeline-health-check] Failed to auto-trigger optimizer:", triggerErr.message);
      }
    } else if (sel48hWithOddsCount < MIN_SELECTIONS_48H_WITH_ODDS * 2) {
      selectionsStatus = "WARNING";
    }

    const selectionsCoverage: SelectionsCoverage = {
      next_48h_total: sel48h.count ?? 0,
      next_48h_with_odds: sel48hWithOddsCount,
      next_7d_total: sel7d.count ?? 0,
      next_7d_with_odds: sel7dOdds.count ?? 0,
      unique_fixtures_48h: uniqueFixtures48h,
      unique_fixtures_7d: uniqueFixtures7d,
      status: selectionsStatus,
      auto_triggered_optimizer: autoTriggered,
    };

    console.log(`[pipeline-health-check] Selections: 48h=${sel48h.count}(odds=${sel48hWithOddsCount}), 7d=${sel7d.count}(odds=${sel7dOdds.count})`);

    // ===========================================
    // 2. CRON JOB LAST RUNS (new!)
    // ===========================================
    console.log("[pipeline-health-check] Checking cron job last runs...");
    
    const cronJobs = [
      "cron-fetch-fixtures", "stats-refresh", "cron-warmup-odds",
      "auto-backfill-results", "score-ticket-legs", "pipeline-health-snapshot",
      "rebuild-green-buckets",
    ];

    const cronLastRuns: CronJobLastRun[] = [];
    for (const jobName of cronJobs) {
      // Check optimizer_run_logs for most cron jobs
      const { data: optimizerLog } = await supabase
        .from("optimizer_run_logs")
        .select("started_at, finished_at")
        .eq("run_type", jobName)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Also check pipeline_run_logs
      const { data: pipelineLog } = await supabase
        .from("pipeline_run_logs")
        .select("run_started, success")
        .eq("job_name", jobName)
        .order("run_started", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastRun = optimizerLog?.started_at || pipelineLog?.run_started || null;
      const lastSuccess = pipelineLog?.success ?? (optimizerLog?.finished_at ? true : null);
      const hoursAgo = lastRun
        ? (now.getTime() - new Date(lastRun).getTime()) / (1000 * 60 * 60)
        : null;

      cronLastRuns.push({
        job_name: jobName,
        last_run_at: lastRun,
        last_success: lastSuccess,
        hours_ago: hoursAgo !== null ? Math.round(hoursAgo * 10) / 10 : null,
      });
    }

    // ===========================================
    // 3. CHECK LEAGUE FIXTURE/RESULTS COVERAGE
    // ===========================================
    console.log("[pipeline-health-check] Checking league fixture/results coverage...");
    
    const leagueHealthResults: LeagueHealth[] = [];
    
    for (const league of MONITORED_LEAGUES) {
      const { data: maxFixture } = await supabase
        .from("fixtures")
        .select("date")
        .eq("league_id", league.id)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count: ftCount } = await supabase
        .from("fixtures")
        .select("*", { count: "exact", head: true })
        .eq("league_id", league.id)
        .eq("status", "FT")
        .gte("date", seasonStart);

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
    // 4. CHECK STATS CACHE FRESHNESS
    // ===========================================
    console.log("[pipeline-health-check] Checking stats cache freshness...");

    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const [totalTeamsR, updated24hR, updated48hR, oldestStatsR, newestStatsR] = await Promise.all([
      supabase.from("stats_cache").select("*", { count: "exact", head: true }),
      supabase.from("stats_cache").select("*", { count: "exact", head: true }).gte("computed_at", last24h.toISOString()),
      supabase.from("stats_cache").select("*", { count: "exact", head: true }).gte("computed_at", last48h.toISOString()),
      supabase.from("stats_cache").select("computed_at").order("computed_at", { ascending: true }).limit(1).maybeSingle(),
      supabase.from("stats_cache").select("computed_at").order("computed_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const totalTeams = totalTeamsR.count ?? 0;
    const updated24h = updated24hR.count ?? 0;
    const updated48h = updated48hR.count ?? 0;
    const coverage24hPct = totalTeams ? Math.round((updated24h / totalTeams) * 100) : 0;
    const coverage48hPct = totalTeams ? Math.round((updated48h / totalTeams) * 100) : 0;

    let statsCacheStatus: "OK" | "WARNING" | "CRITICAL" = "OK";
    if (coverage48hPct < 70) {
      statsCacheStatus = "CRITICAL";
      issues.push(`Stats cache critically stale: only ${coverage48hPct}% updated in 48h`);
    } else if (coverage48hPct < 85) {
      statsCacheStatus = "WARNING";
    }

    const statsCacheHealth: StatsCacheHealth = {
      total_teams: totalTeams,
      updated_last_24h: updated24h,
      updated_last_48h: updated48h,
      coverage_24h_pct: coverage24hPct,
      coverage_48h_pct: coverage48hPct,
      oldest_update: oldestStatsR.data?.computed_at || null,
      newest_update: newestStatsR.data?.computed_at || null,
      status: statsCacheStatus,
    };

    // ===========================================
    // 5. CHECK RECENT PIPELINE JOB RUNS
    // ===========================================
    console.log("[pipeline-health-check] Checking recent pipeline job runs...");
    const jobHealthResults: JobHealth[] = [];

    for (const jobName of CRITICAL_JOBS) {
      let lastRun = null;
      let lastSuccess = null;

      const { data: pipelineLog } = await supabase
        .from("pipeline_run_logs")
        .select("run_started, success")
        .eq("job_name", jobName)
        .order("run_started", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pipelineLog) {
        lastRun = pipelineLog.run_started;
        lastSuccess = pipelineLog.success;
      } else {
        const runType = jobName === "stats-refresh" ? "stats-refresh-batch" : "results-refresh";
        const { data: optimizerLog } = await supabase
          .from("optimizer_run_logs")
          .select("started_at, finished_at")
          .eq("run_type", runType)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

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
    // 6. COMPUTE OVERALL STATUS
    // ===========================================
    let overallStatus: "OK" | "WARNING" | "CRITICAL" = "OK";
    
    if (
      leagueHealthResults.some(l => l.status === "CRITICAL") ||
      jobHealthResults.some(j => j.status === "CRITICAL") ||
      statsCacheHealth.status === "CRITICAL" ||
      selectionsCoverage.status === "CRITICAL"
    ) {
      overallStatus = "CRITICAL";
    } else if (
      leagueHealthResults.some(l => l.status === "WARNING") ||
      jobHealthResults.some(j => j.status === "WARNING") ||
      statsCacheHealth.status === "WARNING" ||
      selectionsCoverage.status === "WARNING"
    ) {
      overallStatus = "WARNING";
    }

    const durationMs = Date.now() - startTime;
    console.log(`[pipeline-health-check] Status: ${overallStatus}, Issues: ${issues.length}, Duration: ${durationMs}ms`);

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
      details: {
        overall_status: overallStatus,
        issue_count: issues.length,
        selections_48h_with_odds: sel48hWithOddsCount,
        auto_triggered: autoTriggered,
      },
    });

    const response = {
      status: overallStatus,
      checked_at: now.toISOString(),
      duration_ms: durationMs,
      optimized_selections: selectionsCoverage,
      cron_last_runs: cronLastRuns,
      stats_cache: statsCacheHealth,
      leagues: leagueHealthResults,
      jobs: jobHealthResults,
      issues,
      summary: {
        leagues_checked: leagueHealthResults.length,
        leagues_ok: leagueHealthResults.filter(l => l.status === "OK").length,
        leagues_warning: leagueHealthResults.filter(l => l.status === "WARNING").length,
        leagues_critical: leagueHealthResults.filter(l => l.status === "CRITICAL").length,
        total_missing_results: leagueHealthResults.reduce((sum, l) => sum + l.missing_results, 0),
        selections_48h_with_odds: sel48hWithOddsCount,
        selections_48h_threshold: MIN_SELECTIONS_48H_WITH_ODDS,
        optimizer_auto_triggered: autoTriggered,
      },
    };

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
