// Stats Health Check - Global integrity monitoring for stats pipeline
// Runs periodically to detect and optionally auto-heal data inconsistencies
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

interface HealthCheckResult {
  timestamp: string;
  stale_ns_fixtures: number;
  finished_missing_goals: number;
  teams_with_large_diff: number;
  max_diff: number;
  status: "HEALTHY" | "DEGRADED" | "CRITICAL";
  details: {
    top_affected_teams: Array<{
      team_id: number;
      cached_goals: number;
      recomputed_goals: number | null;
      diff: number;
    }>;
    stale_fixture_sample: Array<{
      fixture_id: number;
      league_id: number;
      kickoff: string;
      status: string;
    }>;
    ft_missing_goals_sample: Array<{
      fixture_id: number;
      league_id: number;
      kickoff: string;
    }>;
  };
  recommendations: string[];
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  
  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse("Missing Supabase configuration", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Auth check
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    let isAuthorized = false;

    if (cronKeyHeader) {
      const { data: dbKey } = await supabase.rpc("get_cron_internal_key").single();
      if (dbKey && cronKeyHeader === dbKey) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized && authHeader) {
      if (authHeader === `Bearer ${serviceRoleKey}`) {
        isAuthorized = true;
      } else {
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
        if (anonKey) {
          const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } }
          });
          const { data: isWhitelisted } = await userClient.rpc("is_user_whitelisted").single();
          if (isWhitelisted) isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }

    console.log("[stats-health-check] Starting global integrity check...");
    const startTime = Date.now();

    // Query 1: Stale NS fixtures older than 24h
    const { data: staleFixtures, error: staleErr } = await supabase
      .from("fixtures")
      .select("id, league_id, timestamp, status")
      .lt("timestamp", Math.floor((Date.now() - 24 * 3600 * 1000) / 1000))
      .not("status", "in", "(FT,AET,PEN,PST,CANC,ABD,AWD,WO)")
      .order("timestamp", { ascending: false })
      .limit(100);

    const staleCount = staleFixtures?.length || 0;
    console.log(`[stats-health-check] Stale NS fixtures: ${staleCount}`);

    // Query 2: FT fixtures missing goals in fixture_results
    const { data: ftMissingGoals } = await supabase.rpc("exec_sql", {
      sql: `
        SELECT f.id, f.league_id, f.timestamp
        FROM fixtures f
        LEFT JOIN fixture_results fr ON fr.fixture_id = f.id
        WHERE f.status IN ('FT','AET','PEN')
          AND (fr.goals_home IS NULL OR fr.goals_away IS NULL)
        ORDER BY f.timestamp DESC
        LIMIT 100
      `
    });

    // Alternative: direct query if RPC doesn't exist
    let ftMissingCount = 0;
    let ftMissingSample: Array<{ fixture_id: number; league_id: number; kickoff: string }> = [];
    
    const { data: allFTFixtures } = await supabase
      .from("fixtures")
      .select("id, league_id, timestamp")
      .in("status", ["FT", "AET", "PEN"])
      .order("timestamp", { ascending: false })
      .limit(500);

    if (allFTFixtures) {
      const fixtureIds = allFTFixtures.map(f => f.id);
      const { data: existingResults } = await supabase
        .from("fixture_results")
        .select("fixture_id")
        .in("fixture_id", fixtureIds);
      
      const existingIds = new Set((existingResults || []).map(r => r.fixture_id));
      const missing = allFTFixtures.filter(f => !existingIds.has(f.id));
      ftMissingCount = missing.length;
      ftMissingSample = missing.slice(0, 10).map(f => ({
        fixture_id: f.id,
        league_id: f.league_id,
        kickoff: new Date(f.timestamp * 1000).toISOString()
      }));
    }

    console.log(`[stats-health-check] FT fixtures missing results: ${ftMissingCount}`);

    // Query 3: Stats cache consistency check
    // We sample teams and compare cached vs recomputed from fixture_results
    const { data: statsCache } = await supabase
      .from("stats_cache")
      .select("team_id, goals, sample_size")
      .gt("sample_size", 0)
      .limit(500);

    let teamsWithLargeDiff = 0;
    let maxDiff = 0;
    const topAffectedTeams: Array<{
      team_id: number;
      cached_goals: number;
      recomputed_goals: number | null;
      diff: number;
    }> = [];

    // For each cached team, try to recompute from fixture_results
    if (statsCache) {
      for (const team of statsCache.slice(0, 100)) { // Check first 100 for speed
        const { data: teamFixtures } = await supabase
          .from("fixtures")
          .select("id, teams_home, teams_away, timestamp")
          .in("status", ["FT", "AET", "PEN"])
          .or(`teams_home->>id.eq.${team.team_id},teams_away->>id.eq.${team.team_id}`)
          .order("timestamp", { ascending: false })
          .limit(5);

        if (teamFixtures && teamFixtures.length > 0) {
          const fixtureIds = teamFixtures.map(f => f.id);
          const { data: results } = await supabase
            .from("fixture_results")
            .select("fixture_id, goals_home, goals_away")
            .in("fixture_id", fixtureIds);

          if (results && results.length > 0) {
            let totalGoals = 0;
            let count = 0;

            for (const fixture of teamFixtures) {
              const result = results.find(r => r.fixture_id === fixture.id);
              if (result && result.goals_home !== null && result.goals_away !== null) {
                const homeId = Number(fixture.teams_home?.id);
                const awayId = Number(fixture.teams_away?.id);
                const teamId = Number(team.team_id);

                if (teamId === homeId) {
                  totalGoals += result.goals_home;
                  count++;
                } else if (teamId === awayId) {
                  totalGoals += result.goals_away;
                  count++;
                }
              }
            }

            if (count > 0) {
              const recomputedGoals = totalGoals / count;
              const diff = Math.abs(team.goals - recomputedGoals);
              
              if (diff > 0.15) {
                teamsWithLargeDiff++;
                if (diff > maxDiff) maxDiff = diff;
                
                if (topAffectedTeams.length < 10) {
                  topAffectedTeams.push({
                    team_id: team.team_id,
                    cached_goals: team.goals,
                    recomputed_goals: Math.round(recomputedGoals * 1000) / 1000,
                    diff: Math.round(diff * 1000) / 1000
                  });
                }
              }
            }
          }
        }
      }
    }

    // Sort by diff descending
    topAffectedTeams.sort((a, b) => b.diff - a.diff);

    console.log(`[stats-health-check] Teams with large diff (>0.15): ${teamsWithLargeDiff}, max diff: ${maxDiff.toFixed(3)}`);

    // Determine health status
    let status: "HEALTHY" | "DEGRADED" | "CRITICAL" = "HEALTHY";
    const recommendations: string[] = [];

    if (staleCount > 100 || ftMissingCount > 50 || teamsWithLargeDiff > 20) {
      status = "CRITICAL";
      recommendations.push("Run results-refresh with backfill_mode=true and window_hours=336");
      recommendations.push("Clear and rebuild stats_cache for affected teams");
    } else if (staleCount > 10 || ftMissingCount > 10 || teamsWithLargeDiff > 5) {
      status = "DEGRADED";
      recommendations.push("Run results-refresh manually to catch up on missing results");
    }

    if (staleCount > 0) {
      recommendations.push(`${staleCount} fixtures still have NS status after 24h - results-refresh should process these`);
    }
    if (ftMissingCount > 0) {
      recommendations.push(`${ftMissingCount} FT fixtures missing from fixture_results table`);
    }

    const result: HealthCheckResult = {
      timestamp: new Date().toISOString(),
      stale_ns_fixtures: staleCount,
      finished_missing_goals: ftMissingCount,
      teams_with_large_diff: teamsWithLargeDiff,
      max_diff: Math.round(maxDiff * 1000) / 1000,
      status,
      details: {
        top_affected_teams: topAffectedTeams,
        stale_fixture_sample: (staleFixtures || []).slice(0, 10).map(f => ({
          fixture_id: f.id,
          league_id: f.league_id,
          kickoff: new Date(f.timestamp * 1000).toISOString(),
          status: f.status
        })),
        ft_missing_goals_sample: ftMissingSample
      },
      recommendations
    };

    // Log to optimizer_run_logs
    const duration = Date.now() - startTime;
    await supabase.from("optimizer_run_logs").insert({
      run_type: "stats-health-check",
      window_start: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      window_end: new Date().toISOString(),
      scanned: (statsCache?.length || 0) + staleCount + ftMissingCount,
      upserted: 0,
      skipped: 0,
      failed: teamsWithLargeDiff,
      duration_ms: duration,
      notes: JSON.stringify({
        status,
        stale_ns: staleCount,
        ft_missing: ftMissingCount,
        teams_diff: teamsWithLargeDiff,
        max_diff: maxDiff
      })
    });

    console.log(`[stats-health-check] Completed in ${duration}ms, status: ${status}`);

    return jsonResponse(result, origin, 200, req);

  } catch (error) {
    console.error("[stats-health-check] Error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Unknown error",
      origin,
      500,
      req
    );
  }
});
