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
      expected: number;
      who_concedes_count: number;
      card_war_count: number;
      who_concedes_pass: boolean;
      card_war_pass: boolean;
    }[] = [];

    const failures: string[] = [];

    for (const expectation of LEAGUE_EXPECTATIONS) {
      console.log(`[smoke-test] Testing ${expectation.league_name} (${expectation.league_id})...`);

      // Test Who Concedes
      let whoConcedesCount = 0;
      try {
        const { data: whoConcedesData, error: wcError } = await supabase.functions.invoke("who-concedes", {
          body: { league_id: expectation.league_id, mode: "concedes" },
        });

        if (wcError) {
          console.error(`[smoke-test] Who Concedes error for ${expectation.league_name}:`, wcError);
        } else if (whoConcedesData?.rankings) {
          whoConcedesCount = whoConcedesData.rankings.length;
        }
      } catch (e) {
        console.error(`[smoke-test] Who Concedes exception for ${expectation.league_name}:`, e);
      }

      // Test Card War
      let cardWarCount = 0;
      try {
        const { data: cardWarData, error: cwError } = await supabase.functions.invoke("card-war", {
          body: { league_id: expectation.league_id, mode: "cards" },
        });

        if (cwError) {
          console.error(`[smoke-test] Card War error for ${expectation.league_name}:`, cwError);
        } else if (cardWarData?.rankings) {
          cardWarCount = cardWarData.rankings.length;
        }
      } catch (e) {
        console.error(`[smoke-test] Card War exception for ${expectation.league_name}:`, e);
      }

      const whoConcedesPass = whoConcedesCount === expectation.expected_teams;
      const cardWarPass = cardWarCount === expectation.expected_teams;

      results.push({
        league_id: expectation.league_id,
        league_name: expectation.league_name,
        expected: expectation.expected_teams,
        who_concedes_count: whoConcedesCount,
        card_war_count: cardWarCount,
        who_concedes_pass: whoConcedesPass,
        card_war_pass: cardWarPass,
      });

      if (!whoConcedesPass) {
        failures.push(`Who Concedes ${expectation.league_name}: expected ${expectation.expected_teams}, got ${whoConcedesCount}`);
      }
      if (!cardWarPass) {
        failures.push(`Card War ${expectation.league_name}: expected ${expectation.expected_teams}, got ${cardWarCount}`);
      }

      console.log(`[smoke-test] ${expectation.league_name}: WC=${whoConcedesCount}/${expectation.expected_teams} (${whoConcedesPass ? 'PASS' : 'FAIL'}), CW=${cardWarCount}/${expectation.expected_teams} (${cardWarPass ? 'PASS' : 'FAIL'})`);
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

    // If failures, create CRITICAL alert
    if (!allPassed) {
      console.error(`[smoke-test] FAILURES DETECTED: ${failures.join(", ")}`);
      
      await supabase.from("pipeline_alerts").insert({
        alert_type: "smoke_test_failure",
        severity: "critical",
        message: `Analytics smoke test failed: ${failures.length} assertion(s) failed`,
        details: { results, failures, tested_at: new Date().toISOString() },
      });

      console.log("[smoke-test] CRITICAL alert created");
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
