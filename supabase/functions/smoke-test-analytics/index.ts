/**
 * SMOKE-TEST-ANALYTICS: End-to-end verification of analytics features
 * 
 * RUNS: Every 6 hours via cron
 * PURPOSE: Call Who Concedes and Card War for key leagues and verify correct team counts
 * 
 * Expected counts:
 * - EPL (39): 20 teams
 * - Championship (40): 24 teams
 * - Bundesliga (78): 18 teams
 * - La Liga (140): 20 teams
 * 
 * On failure: logs CRITICAL alert to pipeline_alerts table
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getFootballSeasonForLeague } from "../_shared/season.ts";

interface LeagueExpectation {
  league_id: number;
  league_name: string;
  expected_teams: number;
}

const LEAGUE_EXPECTATIONS: LeagueExpectation[] = [
  { league_id: 39, league_name: "Premier League", expected_teams: 20 },
  { league_id: 40, league_name: "Championship", expected_teams: 24 },
  { league_id: 78, league_name: "Bundesliga", expected_teams: 18 },
  { league_id: 140, league_name: "La Liga", expected_teams: 20 },
];

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  
  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const startTime = Date.now();
  console.log("[smoke-test] ===== FUNCTION START =====");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[smoke-test] Missing environment variables");
      return errorResponse("Missing configuration", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Auth check - NO .single() on scalar RPCs!
    const cronKeyHeader = req.headers.get("x-cron-key") ?? req.headers.get("X-CRON-KEY");
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    let isAuthorized = false;

    if (authHeader === `Bearer ${serviceRoleKey}`) {
      isAuthorized = true;
      console.log("[smoke-test] Authorized via service role");
    }

    if (!isAuthorized && cronKeyHeader) {
      const { data: dbKey, error: keyError } = await supabase.rpc("get_cron_internal_key");
      if (keyError) {
        console.error("[smoke-test] get_cron_internal_key error:", keyError);
      } else {
        const expectedKey = String(dbKey || "").trim();
        const providedKey = String(cronKeyHeader || "").trim();
        if (providedKey && expectedKey && providedKey === expectedKey) {
          isAuthorized = true;
          console.log("[smoke-test] Authorized via X-CRON-KEY");
        }
      }
    }

    if (!isAuthorized && authHeader) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (anonKey) {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } }
        });
        const { data: isWhitelisted, error: wlError } = await userClient.rpc("is_user_whitelisted");
        if (wlError) {
          console.error("[smoke-test] is_user_whitelisted error:", wlError);
        } else if (isWhitelisted === true) {
          isAuthorized = true;
          console.log("[smoke-test] Authorized via admin user");
        }
      }
    }

    if (!isAuthorized) {
      console.error("[smoke-test] Authorization failed - no valid credentials");
      return errorResponse("Unauthorized", origin, 401, req);
    }

    console.log("[smoke-test] Running analytics smoke tests...");

    const results: {
      league_id: number;
      league_name: string;
      expected_range: [number, number];
      roster_count: number;
      fresh_stats_count: number;
      fresh_stats_coverage_pct: number;
      pass: boolean;
      errors: string[];
    }[] = [];

    const failures: string[] = [];

    for (const expectation of LEAGUE_EXPECTATIONS) {
      console.log(`[smoke-test] Testing ${expectation.league_name} (${expectation.league_id})...`);

      const leagueErrors: string[] = [];
      const season = getFootballSeasonForLeague(expectation.league_id);
      const { data: roster, error: rosterError } = await supabase
        .from("football_league_teams")
        .select("team_id")
        .eq("league_id", expectation.league_id)
        .eq("season", season)
        .eq("active", true)
        .limit(100);
      if (rosterError) leagueErrors.push(`roster_query:${rosterError.code ?? "error"}`);

      const teamIds = new Set<number>((roster ?? []).map((team) => Number(team.team_id)));
      if (teamIds.size === 0) leagueErrors.push("authoritative_roster_missing");

      let freshStatsCount = 0;
      if (teamIds.size > 0) {
        const freshnessFloor = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const { data: freshStats, error: statsError } = await supabase
          .from("stats_cache")
          .select("team_id")
          .in("team_id", [...teamIds])
          .gte("computed_at", freshnessFloor);
        if (statsError) leagueErrors.push(`stats_query:${statsError.code ?? "error"}`);
        freshStatsCount = new Set((freshStats ?? []).map((row) => Number(row.team_id))).size;
      }

      const expectedMin = Math.max(1, expectation.expected_teams - 2);
      const expectedMax = expectation.expected_teams + 2;
      const coveragePct = teamIds.size > 0 ? Math.round((freshStatsCount / teamIds.size) * 100) : 0;
      const passed = leagueErrors.length === 0
        && teamIds.size >= expectedMin
        && teamIds.size <= expectedMax
        && coveragePct >= 80;

      results.push({
        league_id: expectation.league_id,
        league_name: expectation.league_name,
        expected_range: [expectedMin, expectedMax],
        roster_count: teamIds.size,
        fresh_stats_count: freshStatsCount,
        fresh_stats_coverage_pct: coveragePct,
        pass: passed,
        errors: leagueErrors,
      });

      const fingerprint = `analytics-core:${expectation.league_id}`;
      if (!passed) {
        const failure = `${expectation.league_name}: roster=${teamIds.size} expected=${expectedMin}-${expectedMax}, fresh_coverage=${coveragePct}%`;
        failures.push(failure);
        await supabase.rpc("record_pipeline_alert", {
          p_fingerprint: fingerprint,
          p_alert_type: "analytics_core_health",
          p_severity: "critical",
          p_message: `Analytics core health failed for league ${expectation.league_id}`,
          p_details: { season, roster_source: "api-football", roster_count: teamIds.size, expected_range: [expectedMin, expectedMax], coverage_pct: coveragePct, errors: leagueErrors },
        });
      } else {
        await supabase.rpc("resolve_pipeline_alert", { p_fingerprint: fingerprint });
      }
      console.log(`[smoke-test] ${expectation.league_name}: roster=${teamIds.size}, fresh=${coveragePct}% (${passed ? "PASS" : "FAIL"})`);
    }

    const allPassed = failures.length === 0;
    const duration = Date.now() - startTime;

    // Log result to pipeline_run_logs
    await supabase.from("pipeline_run_logs").insert({
      job_name: "smoke-test-analytics",
      run_started: new Date(startTime).toISOString(),
      run_finished: new Date().toISOString(),
      success: allPassed,
      mode: "auto",
      processed: LEAGUE_EXPECTATIONS.length,
      failed: failures.length,
      leagues_covered: LEAGUE_EXPECTATIONS.map(e => e.league_id),
      details: { results, failures },
      error_message: allPassed ? null : failures.join("; "),
    });

    // Per-league alerts above are fingerprinted and auto-resolve on recovery.
    if (!allPassed) {
      console.error(`[smoke-test] FAILURES DETECTED: ${failures.join(", ")}`);
    } else {
      console.log("[smoke-test] All tests PASSED ✓");
    }

    console.log(`[smoke-test] COMPLETE: ${allPassed ? 'ALL PASS' : 'FAILURES'}, ${duration}ms`);
    console.log("[smoke-test] ===== FUNCTION END =====");

    return jsonResponse({
      success: allPassed,
      tests_run: LEAGUE_EXPECTATIONS.length,
      failures_count: failures.length,
      results,
      failures,
      duration_ms: duration,
    }, origin, 200, req);

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[smoke-test] Handler error:", errMsg);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
