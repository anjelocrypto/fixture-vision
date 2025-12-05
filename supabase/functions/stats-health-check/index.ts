/**
 * Stats Health Check - READ-ONLY lightweight health monitor
 * 
 * CRITICAL RULES:
 * 1. This function MUST NEVER mutate any data
 * 2. This function MUST NEVER throw unhandled errors
 * 3. This function MUST NEVER return HTTP 500 - always 200
 * 4. This function MUST complete in < 1 second (simple aggregate queries only)
 * 5. If any error occurs, return { ok: false, error: "..." } with HTTP 200
 * 
 * Purpose: Provide a quick snapshot of system health for monitoring.
 * NOT for deep audits or auto-healing - those are separate tools.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { UPCOMING_WINDOW_HOURS } from "../_shared/config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

function jsonOk(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Wrap EVERYTHING in try-catch to guarantee no 500s
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[stats-health-check] Missing Supabase configuration");
      return jsonOk({ ok: false, error: "missing_config" });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // === AUTH CHECK ===
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    let isAuthorized = false;

    // Check cron key
    if (cronKeyHeader) {
      try {
        const { data: dbKey } = await supabase.rpc("get_cron_internal_key");
        if (dbKey && cronKeyHeader === dbKey) {
          isAuthorized = true;
        }
      } catch (e) {
        console.error("[stats-health-check] Cron key check failed:", e);
      }
    }

    // Check service role
    if (!isAuthorized && authHeader === `Bearer ${serviceRoleKey}`) {
      isAuthorized = true;
    }

    // Check admin user
    if (!isAuthorized && authHeader) {
      try {
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
        if (anonKey) {
          const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } },
          });
          const { data: isWhitelisted } = await userClient.rpc("is_user_whitelisted");
          if (isWhitelisted) isAuthorized = true;
        }
      } catch (e) {
        console.error("[stats-health-check] Admin check failed:", e);
      }
    }

    if (!isAuthorized) {
      return jsonOk({ ok: false, error: "unauthorized" });
    }

    // === HEALTH METRICS (simple aggregate queries only) ===
    const startTime = Date.now();
    const nowSec = Math.floor(Date.now() / 1000);
    const futureTimestampSec = nowSec + (UPCOMING_WINDOW_HOURS * 3600);

    // Query 1: Get total teams with upcoming fixtures in 48h window
    let totalTeams = 0;
    try {
      const { data: fixtures } = await supabase
        .from("fixtures")
        .select("teams_home, teams_away")
        .gte("timestamp", nowSec)
        .lte("timestamp", futureTimestampSec)
        .not("status", "in", '("FT","AET","PEN")')
        .limit(2000);

      if (fixtures) {
        const teamIds = new Set<number>();
        for (const f of fixtures) {
          const homeId = f.teams_home?.id;
          const awayId = f.teams_away?.id;
          if (homeId) teamIds.add(Number(homeId));
          if (awayId) teamIds.add(Number(awayId));
        }
        totalTeams = teamIds.size;
      }
    } catch (e) {
      console.error("[stats-health-check] Fixtures query failed:", e);
    }

    // Query 2: Count fresh teams in stats_cache (sample_size >= 5)
    let freshTeams = 0;
    try {
      const { count } = await supabase
        .from("stats_cache")
        .select("*", { count: "exact", head: true })
        .gte("sample_size", 5);
      freshTeams = count || 0;
    } catch (e) {
      console.error("[stats-health-check] Stats cache query failed:", e);
    }

    // Query 3: Stats refresh activity in last hour
    let statsRunsLastHour = 0;
    let lastStatsRunAt: string | null = null;
    try {
      const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      const { data: runsData, count } = await supabase
        .from("optimizer_run_logs")
        .select("finished_at", { count: "exact" })
        .eq("run_type", "stats-refresh-batch")
        .gte("started_at", oneHourAgo)
        .order("finished_at", { ascending: false })
        .limit(1);

      statsRunsLastHour = count || 0;
      lastStatsRunAt = runsData?.[0]?.finished_at || null;
    } catch (e) {
      console.error("[stats-health-check] Run logs query failed:", e);
    }

    // Query 4: Last warmup time
    let lastWarmupAt: string | null = null;
    try {
      const { data: warmupData } = await supabase
        .from("optimizer_run_logs")
        .select("finished_at")
        .eq("run_type", "cron-warmup-odds")
        .order("finished_at", { ascending: false })
        .limit(1);

      lastWarmupAt = warmupData?.[0]?.finished_at || null;
    } catch (e) {
      console.error("[stats-health-check] Warmup logs query failed:", e);
    }

    // Query 5: Active locks
    let activeLocks = 0;
    try {
      const nowIso = new Date().toISOString();
      const { count } = await supabase
        .from("cron_job_locks")
        .select("*", { count: "exact", head: true })
        .gt("locked_until", nowIso);

      activeLocks = count || 0;
    } catch (e) {
      console.error("[stats-health-check] Locks query failed:", e);
    }

    // Calculate coverage percentage
    const freshCoveragePct = totalTeams > 0 
      ? Math.round((freshTeams / totalTeams) * 100 * 10) / 10 
      : 0;

    const durationMs = Date.now() - startTime;

    console.log(`[stats-health-check] Completed in ${durationMs}ms: ${freshTeams}/${totalTeams} teams (${freshCoveragePct}%)`);

    return jsonOk({
      ok: true,
      fresh_teams: freshTeams,
      total_teams: totalTeams,
      fresh_coverage_pct: freshCoveragePct,
      stats_runs_last_hour: statsRunsLastHour,
      last_stats_run_at: lastStatsRunAt,
      last_warmup_at: lastWarmupAt,
      active_locks: activeLocks,
      duration_ms: durationMs,
      window_hours: UPCOMING_WINDOW_HOURS,
    });

  } catch (error) {
    // CATCH-ALL: Never let any error escape as a 500
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[stats-health-check] Unhandled error:", errorMessage);
    
    return jsonOk({
      ok: false,
      error: "stats-health-check failed",
      details: errorMessage,
    });
  }
});
