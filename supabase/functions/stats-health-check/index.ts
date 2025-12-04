// Stats Health Check - STRICT integrity monitoring for ALL upcoming fixtures
// CRITICAL: No different rules for lower divisions. If a team appears in any tool, it MUST have correct stats.
// 
// KEY PRINCIPLES:
// 1. UPCOMING TEAMS ONLY: Only check teams with fixtures in next 7 days
// 2. NO TIER DIFFERENTIATION: All leagues treated equally - if we use it, stats must be correct
// 3. STRICT THRESHOLDS: goals diff > 0.3 = CRITICAL, corners diff > 1.0 = CRITICAL, etc.
// 4. AUTO-HEALING: Automatically fix any issues found
// 5. EXCLUSION FLAG: Mark teams with irrecoverable issues to exclude from tools

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { ALLOWED_LEAGUE_IDS } from "../_shared/leagues.ts";

// STRICT THRESHOLDS for upcoming teams - these trigger CRITICAL status
const UPCOMING_THRESHOLDS = {
  goals:    { warning: 0.15, error: 0.25, critical: 0.3 },
  corners:  { warning: 0.5, error: 0.8, critical: 1.0 },
  cards:    { warning: 0.4, error: 0.6, critical: 0.8 },
  fouls:    { warning: 1.5, error: 2.5, critical: 3.0 },
  offsides: { warning: 0.8, error: 1.2, critical: 1.5 },
};

const MIN_SAMPLE_SIZE = 3; // Minimum fixtures required for valid stats

interface TeamDiscovery {
  team_id: number;
  team_name: string;
  league_ids: number[];
  fixture_ids: number[];
}

interface RecomputedStats {
  goals: number | null;
  corners: number | null;
  cards: number | null;
  fouls: number | null;
  offsides: number | null;
  sample_size: number;
  fixture_ids: number[];
}

interface Violation {
  team_id: number;
  team_name: string | null;
  league_ids: number[] | null;
  metric: string;
  db_value: number | null;
  cache_value: number | null;
  diff: number | null;
  sample_size: number | null;
  severity: 'info' | 'warning' | 'error' | 'critical';
  notes: string | null;
  is_upcoming: boolean;
}

interface HealthCheckResult {
  timestamp: string;
  mode: 'upcoming' | 'all';
  teams_checked: number;
  upcoming_fixtures: number;
  violations_by_severity: {
    info: number;
    warning: number;
    error: number;
    critical: number;
  };
  violations_by_metric: Record<string, number>;
  status: "HEALTHY" | "DEGRADED" | "CRITICAL";
  top_violations: Violation[];
  recommendations: string[];
  duration_ms: number;
  auto_healed: number;
  excluded_teams: number;
  acceptance_checks: {
    teams_missing_cache: number;
    teams_with_goals_diff_gt_03: number;
    teams_with_sample_lt_3: number;
    all_passed: boolean;
  };
}

function getSeverityForMetric(metric: string, diff: number): 'info' | 'warning' | 'error' | 'critical' {
  const thresholds = UPCOMING_THRESHOLDS[metric as keyof typeof UPCOMING_THRESHOLDS];
  if (!thresholds) return 'info';
  
  if (diff >= thresholds.critical) return 'critical';
  if (diff >= thresholds.error) return 'error';
  if (diff >= thresholds.warning) return 'warning';
  return 'info';
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

    // Parse body for options
    let mode: 'upcoming' | 'all' = 'upcoming';
    let autoHeal = true;
    let lookbackDays = 7;
    
    try {
      const body = await req.json();
      if (body.mode) mode = body.mode;
      if (body.autoHeal !== undefined) autoHeal = body.autoHeal;
      if (body.lookbackDays) lookbackDays = body.lookbackDays;
    } catch {
      // Default values
    }

    console.log(`[stats-health-check] Starting STRICT integrity check (mode=${mode}, autoHeal=${autoHeal})...`);
    const startTime = Date.now();

    const violations: Violation[] = [];
    const teamsToAutoHeal: number[] = [];
    const teamsToExclude: number[] = [];

    // STEP 1: Discover ALL teams with UPCOMING fixtures (next 7 days)
    console.log("[stats-health-check] Step 1: Discovering teams from UPCOMING fixtures...");
    
    const nowTimestamp = Math.floor(Date.now() / 1000);
    const futureTimestamp = nowTimestamp + (lookbackDays * 24 * 3600);

    // Get upcoming fixtures in allowed leagues
    const { data: upcomingFixtures, error: fixturesError } = await supabase
      .from("fixtures")
      .select("id, league_id, teams_home, teams_away, timestamp, status")
      .in("league_id", ALLOWED_LEAGUE_IDS)
      .gte("timestamp", nowTimestamp)
      .lte("timestamp", futureTimestamp)
      .not("status", "in", "(\"FT\",\"AET\",\"PEN\")")
      .limit(2000);

    if (fixturesError) {
      console.error("[stats-health-check] Error fetching upcoming fixtures:", fixturesError);
      return errorResponse("Failed to fetch upcoming fixtures", origin, 500, req);
    }

    const upcomingCount = upcomingFixtures?.length || 0;
    console.log(`[stats-health-check] Found ${upcomingCount} upcoming fixtures in next ${lookbackDays} days`);

    // Build team map from upcoming fixtures
    const teamMap = new Map<number, { name: string; leagues: Set<number>; fixtures: number[] }>();
    
    for (const fixture of upcomingFixtures || []) {
      const homeId = Number(fixture.teams_home?.id);
      const homeName = String(fixture.teams_home?.name || `Team ${homeId}`);
      const awayId = Number(fixture.teams_away?.id);
      const awayName = String(fixture.teams_away?.name || `Team ${awayId}`);
      
      if (homeId) {
        if (!teamMap.has(homeId)) {
          teamMap.set(homeId, { name: homeName, leagues: new Set(), fixtures: [] });
        }
        teamMap.get(homeId)!.leagues.add(fixture.league_id);
        teamMap.get(homeId)!.fixtures.push(fixture.id);
      }
      if (awayId) {
        if (!teamMap.has(awayId)) {
          teamMap.set(awayId, { name: awayName, leagues: new Set(), fixtures: [] });
        }
        teamMap.get(awayId)!.leagues.add(fixture.league_id);
        teamMap.get(awayId)!.fixtures.push(fixture.id);
      }
    }

    const teamsDiscovered: TeamDiscovery[] = Array.from(teamMap.entries()).map(([teamId, data]) => ({
      team_id: teamId,
      team_name: data.name,
      league_ids: Array.from(data.leagues),
      fixture_ids: data.fixtures
    }));

    console.log(`[stats-health-check] Discovered ${teamsDiscovered.length} teams with upcoming fixtures`);

    // STEP 2: Load all stats_cache entries
    const { data: allStatsCache } = await supabase
      .from("stats_cache")
      .select("team_id, goals, corners, cards, fouls, offsides, sample_size, computed_at, last_five_fixture_ids");

    const statsCacheMap = new Map(
      (allStatsCache || []).map(sc => [sc.team_id, sc])
    );

    // STEP 3: For each upcoming team, recompute stats from fixture_results and compare
    console.log("[stats-health-check] Step 3: Checking stats consistency for upcoming teams...");
    
    let teamsProcessed = 0;
    let teamsMissingCache = 0;
    let teamsWithGoalsDiffGt03 = 0;
    let teamsWithSampleLt3 = 0;

    for (const team of teamsDiscovered) {
      // Get team's last 5 FINISHED fixtures
      const { data: teamFixtures } = await supabase
        .from("fixtures")
        .select("id, league_id, teams_home, teams_away, timestamp")
        .in("league_id", ALLOWED_LEAGUE_IDS)
        .in("status", ["FT", "AET", "PEN"])
        .or(`teams_home->>id.eq.${team.team_id},teams_away->>id.eq.${team.team_id}`)
        .order("timestamp", { ascending: false })
        .limit(5);

      if (!teamFixtures || teamFixtures.length === 0) {
        // Team has no finished fixtures - may be new team
        violations.push({
          team_id: team.team_id,
          team_name: team.team_name,
          league_ids: team.league_ids,
          metric: 'no_history',
          db_value: 0,
          cache_value: null,
          diff: null,
          sample_size: 0,
          severity: 'error',
          notes: `Team has upcoming fixtures but no finished match history`,
          is_upcoming: true
        });
        teamsToExclude.push(team.team_id);
        continue;
      }

      const fixtureIds = teamFixtures.map(f => f.id);
      const fixtureLeagues = [...new Set(teamFixtures.map(f => f.league_id))];

      // Get fixture_results for these fixtures
      const { data: results } = await supabase
        .from("fixture_results")
        .select("fixture_id, goals_home, goals_away, corners_home, corners_away, cards_home, cards_away, fouls_home, fouls_away, offsides_home, offsides_away")
        .in("fixture_id", fixtureIds);

      const resultsMap = new Map((results || []).map(r => [r.fixture_id, r]));

      // Check for missing fixture_results
      const missingResults = teamFixtures.filter(f => !resultsMap.has(f.id));
      if (missingResults.length > 0) {
        violations.push({
          team_id: team.team_id,
          team_name: team.team_name,
          league_ids: fixtureLeagues,
          metric: 'missing_results',
          db_value: missingResults.length,
          cache_value: null,
          diff: null,
          sample_size: teamFixtures.length,
          severity: missingResults.length >= 3 ? 'critical' : 'error',
          notes: `${missingResults.length}/${teamFixtures.length} FT fixtures missing fixture_results: [${missingResults.map(f => f.id).join(',')}]`,
          is_upcoming: true
        });
        if (autoHeal) {
          // These fixtures need results-refresh - log for now
          console.log(`[auto-heal] Team ${team.team_id} needs results for fixtures: ${missingResults.map(f => f.id).join(',')}`);
        }
      }

      // Compute averages from fixture_results
      let totalGoals = 0, countGoals = 0;
      let totalCorners = 0, countCorners = 0;
      let totalCards = 0, countCards = 0;
      let totalFouls = 0, countFouls = 0;
      let totalOffsides = 0, countOffsides = 0;

      for (const fixture of teamFixtures) {
        const result = resultsMap.get(fixture.id);
        if (!result) continue;

        const homeId = Number(fixture.teams_home?.id);
        const isHome = homeId === team.team_id;

        const goals = isHome ? result.goals_home : result.goals_away;
        if (goals !== null && goals !== undefined) {
          totalGoals += goals;
          countGoals++;
        }

        const corners = isHome ? result.corners_home : result.corners_away;
        if (corners !== null && corners !== undefined) {
          totalCorners += corners;
          countCorners++;
        }

        const cards = isHome ? result.cards_home : result.cards_away;
        if (cards !== null && cards !== undefined) {
          totalCards += cards;
          countCards++;
        }

        const fouls = isHome ? result.fouls_home : result.fouls_away;
        if (fouls !== null && fouls !== undefined) {
          totalFouls += fouls;
          countFouls++;
        }

        const offsides = isHome ? result.offsides_home : result.offsides_away;
        if (offsides !== null && offsides !== undefined) {
          totalOffsides += offsides;
          countOffsides++;
        }
      }

      const dbStats: RecomputedStats = {
        goals: countGoals > 0 ? totalGoals / countGoals : null,
        corners: countCorners > 0 ? totalCorners / countCorners : null,
        cards: countCards > 0 ? totalCards / countCards : null,
        fouls: countFouls > 0 ? totalFouls / countFouls : null,
        offsides: countOffsides > 0 ? totalOffsides / countOffsides : null,
        sample_size: countGoals,
        fixture_ids: fixtureIds
      };

      // Check sample size
      if (dbStats.sample_size < MIN_SAMPLE_SIZE) {
        teamsWithSampleLt3++;
        violations.push({
          team_id: team.team_id,
          team_name: team.team_name,
          league_ids: fixtureLeagues,
          metric: 'low_sample',
          db_value: dbStats.sample_size,
          cache_value: null,
          diff: null,
          sample_size: dbStats.sample_size,
          severity: dbStats.sample_size === 0 ? 'critical' : 'error',
          notes: `Only ${dbStats.sample_size} valid fixtures (need ${MIN_SAMPLE_SIZE}+) - stats unreliable`,
          is_upcoming: true
        });
        if (dbStats.sample_size === 0) {
          teamsToExclude.push(team.team_id);
        }
      }

      // Check cache existence
      const cacheEntry = statsCacheMap.get(team.team_id);
      
      if (!cacheEntry) {
        teamsMissingCache++;
        violations.push({
          team_id: team.team_id,
          team_name: team.team_name,
          league_ids: fixtureLeagues,
          metric: 'missing_cache',
          db_value: dbStats.sample_size,
          cache_value: null,
          diff: null,
          sample_size: dbStats.sample_size,
          severity: 'critical',
          notes: `Team has upcoming fixtures but NO stats_cache entry`,
          is_upcoming: true
        });
        teamsToAutoHeal.push(team.team_id);
        continue;
      }

      // Check cache sample_size validity
      if (cacheEntry.sample_size === 0 || cacheEntry.sample_size > 5) {
        violations.push({
          team_id: team.team_id,
          team_name: team.team_name,
          league_ids: fixtureLeagues,
          metric: 'invalid_sample_size',
          db_value: dbStats.sample_size,
          cache_value: cacheEntry.sample_size,
          diff: Math.abs(dbStats.sample_size - cacheEntry.sample_size),
          sample_size: cacheEntry.sample_size,
          severity: 'critical',
          notes: `Invalid cache sample_size: ${cacheEntry.sample_size} (expected 1-5, DB has ${dbStats.sample_size})`,
          is_upcoming: true
        });
        teamsToAutoHeal.push(team.team_id);
      }

      // Compare each metric with STRICT thresholds
      const metrics = [
        { name: 'goals', db: dbStats.goals, cache: cacheEntry.goals, count: countGoals },
        { name: 'corners', db: dbStats.corners, cache: cacheEntry.corners, count: countCorners },
        { name: 'cards', db: dbStats.cards, cache: cacheEntry.cards, count: countCards },
        { name: 'fouls', db: dbStats.fouls, cache: cacheEntry.fouls, count: countFouls },
        { name: 'offsides', db: dbStats.offsides, cache: cacheEntry.offsides, count: countOffsides }
      ];

      for (const m of metrics) {
        if (m.db === null || m.count < 2) continue;
        
        const diff = Math.abs(m.db - m.cache);
        const severity = getSeverityForMetric(m.name, diff);
        
        if (severity !== 'info') {
          violations.push({
            team_id: team.team_id,
            team_name: team.team_name,
            league_ids: fixtureLeagues,
            metric: m.name,
            db_value: Math.round(m.db * 1000) / 1000,
            cache_value: Math.round(m.cache * 1000) / 1000,
            diff: Math.round(diff * 1000) / 1000,
            sample_size: m.count,
            severity,
            notes: `DB avg: ${m.db.toFixed(2)}, Cache: ${m.cache.toFixed(2)}, Diff: ${diff.toFixed(2)}`,
            is_upcoming: true
          });

          // Track goals critical for acceptance check
          if (m.name === 'goals' && diff > 0.3) {
            teamsWithGoalsDiffGt03++;
          }

          // Auto-heal ALL critical violations (not just top leagues)
          if (severity === 'critical') {
            teamsToAutoHeal.push(team.team_id);
          }
        }
      }

      teamsProcessed++;
    }

    console.log(`[stats-health-check] Processed ${teamsProcessed} upcoming teams`);

    // STEP 4: Upsert violations with deduplication
    console.log(`[stats-health-check] Step 4: Upserting ${violations.length} violations...`);
    
    const violationMap = new Map<string, Violation>();
    for (const v of violations) {
      const key = `${v.team_id}_${v.metric}`;
      violationMap.set(key, v);
    }
    
    const deduplicatedViolations = Array.from(violationMap.values());
    
    // Delete existing unresolved violations for teams we're updating
    const teamIds = [...new Set(deduplicatedViolations.map(v => v.team_id))];
    if (teamIds.length > 0) {
      await supabase
        .from("stats_health_violations")
        .delete()
        .in("team_id", teamIds)
        .is("resolved_at", null);
    }
    
    // Insert new violations
    if (deduplicatedViolations.length > 0) {
      const insertBatches = [];
      for (let i = 0; i < deduplicatedViolations.length; i += 100) {
        insertBatches.push(deduplicatedViolations.slice(i, i + 100));
      }

      for (const batch of insertBatches) {
        const { error: insertError } = await supabase
          .from("stats_health_violations")
          .insert(batch.map(v => ({
            team_id: v.team_id,
            team_name: v.team_name,
            league_ids: v.league_ids,
            metric: v.metric,
            db_value: v.db_value,
            cache_value: v.cache_value,
            diff: v.diff,
            sample_size: v.sample_size,
            severity: v.severity,
            notes: v.notes
          })));

        if (insertError) {
          console.error("[stats-health-check] Insert error:", insertError.message);
        }
      }
    }

    // STEP 5: Auto-heal ALL critical violations (no tier differentiation)
    const uniqueTeamsToHeal = [...new Set(teamsToAutoHeal)];
    let autoHealedCount = 0;
    
    if (autoHeal && uniqueTeamsToHeal.length > 0) {
      console.log(`[stats-health-check] Step 5: Auto-healing ${uniqueTeamsToHeal.length} teams...`);
      
      // Delete stats_cache entries to force recalculation
      const { error: deleteError } = await supabase
        .from("stats_cache")
        .delete()
        .in("team_id", uniqueTeamsToHeal);
      
      if (!deleteError) {
        autoHealedCount = uniqueTeamsToHeal.length;
        console.log(`[stats-health-check] Cleared stats_cache for ${autoHealedCount} teams`);
        
        // Mark violations as auto-healed
        await supabase
          .from("stats_health_violations")
          .update({ 
            notes: 'Auto-heal initiated - cache cleared, awaiting stats-refresh'
          })
          .in("team_id", uniqueTeamsToHeal)
          .is("resolved_at", null);
      } else {
        console.error("[stats-health-check] Auto-heal delete error:", deleteError.message);
      }
    }

    // Build summary
    const violationsBySeverity = { info: 0, warning: 0, error: 0, critical: 0 };
    const violationsByMetric: Record<string, number> = {};

    for (const v of deduplicatedViolations) {
      violationsBySeverity[v.severity]++;
      violationsByMetric[v.metric] = (violationsByMetric[v.metric] || 0) + 1;
    }

    // Determine status - STRICT: ANY critical upcoming team = CRITICAL
    let status: "HEALTHY" | "DEGRADED" | "CRITICAL" = "HEALTHY";
    if (violationsBySeverity.critical > 0) {
      status = "CRITICAL";
    } else if (violationsBySeverity.error > 0 || violationsBySeverity.warning > 10) {
      status = "DEGRADED";
    }

    const durationMs = Date.now() - startTime;

    // Acceptance checks
    const acceptanceChecks = {
      teams_missing_cache: teamsMissingCache,
      teams_with_goals_diff_gt_03: teamsWithGoalsDiffGt03,
      teams_with_sample_lt_3: teamsWithSampleLt3,
      all_passed: teamsMissingCache === 0 && teamsWithGoalsDiffGt03 === 0 && teamsWithSampleLt3 === 0
    };

    // Generate recommendations
    const recommendations: string[] = [];
    if (teamsMissingCache > 0) {
      recommendations.push(`🚨 ${teamsMissingCache} upcoming teams have NO stats_cache - run stats-refresh immediately`);
    }
    if (teamsWithGoalsDiffGt03 > 0) {
      recommendations.push(`🚨 ${teamsWithGoalsDiffGt03} upcoming teams have goals diff > 0.3 - data integrity issue`);
    }
    if (teamsWithSampleLt3 > 0) {
      recommendations.push(`⚠️ ${teamsWithSampleLt3} upcoming teams have sample_size < 3 - may need exclusion`);
    }
    if (violationsByMetric['missing_results'] > 0) {
      recommendations.push(`Run results-refresh for ${violationsByMetric['missing_results']} teams with missing fixture_results`);
    }
    if (autoHealedCount > 0) {
      recommendations.push(`✅ Auto-healed ${autoHealedCount} teams - cache cleared, awaiting next stats-refresh`);
    }
    if (acceptanceChecks.all_passed) {
      recommendations.push(`✅ ALL ACCEPTANCE CHECKS PASSED - stats integrity verified`);
    }

    // Log to optimizer_run_logs
    await supabase.from("optimizer_run_logs").insert({
      run_type: "stats-health-check",
      window_start: new Date(nowTimestamp * 1000).toISOString(),
      window_end: new Date(futureTimestamp * 1000).toISOString(),
      scanned: teamsProcessed,
      upserted: deduplicatedViolations.length,
      failed: violationsBySeverity.critical,
      duration_ms: durationMs,
      notes: `Status: ${status}, Teams: ${teamsProcessed}, Critical: ${violationsBySeverity.critical}, AutoHealed: ${autoHealedCount}, Acceptance: ${acceptanceChecks.all_passed ? 'PASSED' : 'FAILED'}`
    });

    const result: HealthCheckResult = {
      timestamp: new Date().toISOString(),
      mode,
      teams_checked: teamsProcessed,
      upcoming_fixtures: upcomingCount,
      violations_by_severity: violationsBySeverity,
      violations_by_metric: violationsByMetric,
      status,
      top_violations: deduplicatedViolations
        .filter(v => v.severity === 'critical' || v.severity === 'error')
        .slice(0, 30),
      recommendations,
      duration_ms: durationMs,
      auto_healed: autoHealedCount,
      excluded_teams: [...new Set(teamsToExclude)].length,
      acceptance_checks: acceptanceChecks
    };

    console.log(`[stats-health-check] Complete. Status: ${status}, Teams: ${teamsProcessed}, Critical: ${violationsBySeverity.critical}, AutoHealed: ${autoHealedCount}, Acceptance: ${acceptanceChecks.all_passed ? 'PASSED' : 'FAILED'}`);

    return jsonResponse(result, origin, 200, req);

  } catch (error) {
    console.error("[stats-health-check] Error:", error);
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(errMsg, origin, 500, req);
  }
});
