// Stats Health Check - Global integrity monitoring for stats pipeline
// Runs periodically to detect and log violations to stats_health_violations table
// KEY FEATURES:
// - Deduplication: Uses upsert to avoid duplicate violations for same team/metric
// - Auto-healing: Clears stale cache for critical violations and triggers recompute
// - Per-metric thresholds: Different sensitivity for goals (strict) vs fouls (lenient)
// - Top-league focus: Only considers ALLOWED_LEAGUE_IDS teams for CRITICAL status

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { ALLOWED_LEAGUE_IDS } from "../_shared/leagues.ts";

// Top 5 leagues for strict monitoring - only these trigger CRITICAL status for goals
const TOP_LEAGUE_IDS = [39, 140, 135, 78, 61]; // Premier League, La Liga, Serie A, Bundesliga, Ligue 1

interface TeamDiscovery {
  team_id: number;
  team_name: string;
  league_ids: number[];
}

interface RecomputedStats {
  goals: number | null;
  corners: number | null;
  cards: number | null;
  fouls: number | null;
  offsides: number | null;
  sample_size_goals: number;
  sample_size_corners: number;
  sample_size_cards: number;
  sample_size_fouls: number;
  sample_size_offsides: number;
  fixture_ids: number[];
  league_ids: number[];
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
}

interface HealthCheckResult {
  timestamp: string;
  teams_checked: number;
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
  top_league_goals_critical: number;
}

// Metric-specific thresholds to reduce noise while catching real bugs
// Goals: strictest (core metric)
// Corners/Cards: moderate (important but some API coverage gaps)
// Fouls/Offsides: lenient (frequent API coverage issues)
const METRIC_THRESHOLDS: Record<string, { warning: number; error: number; critical: number }> = {
  goals:    { warning: 0.3, error: 0.7, critical: 1.0 },    // e.g., 0.8 vs 2.0 = 1.2 diff → critical (real bug)
  corners:  { warning: 0.8, error: 1.5, critical: 2.5 },    // more variance allowed
  cards:    { warning: 0.5, error: 1.0, critical: 1.5 },    // moderate strictness
  fouls:    { warning: 2.0, error: 4.0, critical: 8.0 },    // lenient - API coverage spotty
  offsides: { warning: 1.0, error: 2.0, critical: 3.0 },    // lenient - API coverage spotty
};

const DEFAULT_THRESHOLDS = { warning: 0.5, error: 1.0, critical: 2.0 };

const LOOKBACK_DAYS = 365;
const BATCH_SIZE = 50;

function getSeverityForMetric(metric: string, diff: number): 'info' | 'warning' | 'error' | 'critical' {
  const thresholds = METRIC_THRESHOLDS[metric] || DEFAULT_THRESHOLDS;
  if (diff >= thresholds.critical) return 'critical';
  if (diff >= thresholds.error) return 'error';
  if (diff >= thresholds.warning) return 'warning';
  return 'info';
}

// Check if team plays in a top league
function isTopLeagueTeam(leagueIds: number[]): boolean {
  return leagueIds.some(lid => TOP_LEAGUE_IDS.includes(lid));
}

// Check if team plays in any ALLOWED league
function isAllowedLeagueTeam(leagueIds: number[]): boolean {
  return leagueIds.some(lid => ALLOWED_LEAGUE_IDS.includes(lid));
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

    console.log("[stats-health-check] Starting comprehensive integrity check...");
    const startTime = Date.now();

    const lookbackTimestamp = Math.floor((Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000) / 1000);
    const violations: Violation[] = [];
    const teamsDiscovered: TeamDiscovery[] = [];
    const teamsToAutoHeal: number[] = [];

    // Step 1: Discover all teams from finished fixtures in allowed leagues
    console.log("[stats-health-check] Step 1: Discovering teams from fixtures...");
    
    const { data: homeTeams } = await supabase
      .from("fixtures")
      .select("teams_home, league_id")
      .in("league_id", ALLOWED_LEAGUE_IDS)
      .in("status", ["FT", "AET", "PEN"])
      .gt("timestamp", lookbackTimestamp)
      .limit(5000);

    const { data: awayTeams } = await supabase
      .from("fixtures")
      .select("teams_away, league_id")
      .in("league_id", ALLOWED_LEAGUE_IDS)
      .in("status", ["FT", "AET", "PEN"])
      .gt("timestamp", lookbackTimestamp)
      .limit(5000);

    const teamMap = new Map<number, { name: string; leagues: Set<number> }>();
    
    for (const row of homeTeams || []) {
      const teamId = Number(row.teams_home?.id);
      const teamName = String(row.teams_home?.name || `Team ${teamId}`);
      if (teamId) {
        if (!teamMap.has(teamId)) {
          teamMap.set(teamId, { name: teamName, leagues: new Set() });
        }
        teamMap.get(teamId)!.leagues.add(row.league_id);
      }
    }
    
    for (const row of awayTeams || []) {
      const teamId = Number(row.teams_away?.id);
      const teamName = String(row.teams_away?.name || `Team ${teamId}`);
      if (teamId) {
        if (!teamMap.has(teamId)) {
          teamMap.set(teamId, { name: teamName, leagues: new Set() });
        }
        teamMap.get(teamId)!.leagues.add(row.league_id);
      }
    }

    for (const [teamId, data] of teamMap) {
      teamsDiscovered.push({
        team_id: teamId,
        team_name: data.name,
        league_ids: Array.from(data.leagues)
      });
    }

    console.log(`[stats-health-check] Discovered ${teamsDiscovered.length} teams`);

    // Step 2: Check for FT fixtures missing fixture_results (limit scope to recent 60 days)
    console.log("[stats-health-check] Step 2: Checking for missing fixture_results (last 60 days)...");
    
    const recentLookback = Math.floor((Date.now() - 60 * 24 * 3600 * 1000) / 1000);
    const { data: ftFixtures } = await supabase
      .from("fixtures")
      .select("id, league_id, teams_home, teams_away")
      .in("league_id", ALLOWED_LEAGUE_IDS)
      .in("status", ["FT", "AET", "PEN"])
      .gt("timestamp", recentLookback)
      .limit(2000);

    if (ftFixtures && ftFixtures.length > 0) {
      const fixtureIds = ftFixtures.map(f => f.id);
      const { data: existingResults } = await supabase
        .from("fixture_results")
        .select("fixture_id")
        .in("fixture_id", fixtureIds);
      
      const existingIds = new Set((existingResults || []).map(r => r.fixture_id));
      const missingFixtures = ftFixtures.filter(f => !existingIds.has(f.id));
      
      console.log(`[stats-health-check] Found ${missingFixtures.length} FT fixtures missing results`);
      
      const teamsMissingResults = new Map<number, { name: string; count: number; leagues: Set<number> }>();
      
      for (const f of missingFixtures) {
        const homeId = Number(f.teams_home?.id);
        const awayId = Number(f.teams_away?.id);
        const homeName = String(f.teams_home?.name || `Team ${homeId}`);
        const awayName = String(f.teams_away?.name || `Team ${awayId}`);
        
        if (homeId) {
          if (!teamsMissingResults.has(homeId)) {
            teamsMissingResults.set(homeId, { name: homeName, count: 0, leagues: new Set() });
          }
          teamsMissingResults.get(homeId)!.count++;
          teamsMissingResults.get(homeId)!.leagues.add(f.league_id);
        }
        if (awayId) {
          if (!teamsMissingResults.has(awayId)) {
            teamsMissingResults.set(awayId, { name: awayName, count: 0, leagues: new Set() });
          }
          teamsMissingResults.get(awayId)!.count++;
          teamsMissingResults.get(awayId)!.leagues.add(f.league_id);
        }
      }
      
      for (const [teamId, data] of teamsMissingResults) {
        if (data.count >= 2) {
          violations.push({
            team_id: teamId,
            team_name: data.name,
            league_ids: Array.from(data.leagues),
            metric: 'missing_results',
            db_value: data.count,
            cache_value: null,
            diff: null,
            sample_size: data.count,
            severity: data.count >= 5 ? 'critical' : 'error',
            notes: `${data.count} FT fixtures missing fixture_results`
          });
        }
      }
    }

    // Step 3: Process teams in batches to check stats consistency
    console.log("[stats-health-check] Step 3: Checking stats consistency...");
    
    const { data: allStatsCache } = await supabase
      .from("stats_cache")
      .select("team_id, goals, corners, cards, fouls, offsides, sample_size, computed_at");

    const statsCacheMap = new Map(
      (allStatsCache || []).map(sc => [sc.team_id, sc])
    );

    let teamsProcessed = 0;
    const teamBatches = [];
    for (let i = 0; i < teamsDiscovered.length; i += BATCH_SIZE) {
      teamBatches.push(teamsDiscovered.slice(i, i + BATCH_SIZE));
    }

    for (const batch of teamBatches) {
      for (const team of batch) {
        const { data: teamFixtures } = await supabase
          .from("fixtures")
          .select("id, league_id, teams_home, teams_away, timestamp")
          .in("league_id", ALLOWED_LEAGUE_IDS)
          .in("status", ["FT", "AET", "PEN"])
          .or(`teams_home->>id.eq.${team.team_id},teams_away->>id.eq.${team.team_id}`)
          .order("timestamp", { ascending: false })
          .limit(5);

        if (!teamFixtures || teamFixtures.length === 0) continue;

        const fixtureIds = teamFixtures.map(f => f.id);
        const fixtureLeagues = [...new Set(teamFixtures.map(f => f.league_id))];

        const { data: results } = await supabase
          .from("fixture_results")
          .select("fixture_id, goals_home, goals_away, corners_home, corners_away, cards_home, cards_away, fouls_home, fouls_away, offsides_home, offsides_away")
          .in("fixture_id", fixtureIds);

        const resultsMap = new Map((results || []).map(r => [r.fixture_id, r]));

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
          sample_size_goals: countGoals,
          sample_size_corners: countCorners,
          sample_size_cards: countCards,
          sample_size_fouls: countFouls,
          sample_size_offsides: countOffsides,
          fixture_ids: fixtureIds,
          league_ids: fixtureLeagues
        };

        const cacheEntry = statsCacheMap.get(team.team_id);

        // Missing cache check
        if (!cacheEntry && countGoals >= 3) {
          violations.push({
            team_id: team.team_id,
            team_name: team.team_name,
            league_ids: fixtureLeagues,
            metric: 'missing_cache',
            db_value: countGoals,
            cache_value: null,
            diff: null,
            sample_size: countGoals,
            severity: 'error',
            notes: `Team has ${countGoals} FT fixtures but no stats_cache entry`
          });
          // Mark for auto-heal if in allowed leagues
          if (isAllowedLeagueTeam(fixtureLeagues)) {
            teamsToAutoHeal.push(team.team_id);
          }
          continue;
        }

        if (!cacheEntry) continue;

        // Sample size check
        if (cacheEntry.sample_size === 0 || cacheEntry.sample_size > 5) {
          violations.push({
            team_id: team.team_id,
            team_name: team.team_name,
            league_ids: fixtureLeagues,
            metric: 'sample_size',
            db_value: countGoals,
            cache_value: cacheEntry.sample_size,
            diff: Math.abs(countGoals - cacheEntry.sample_size),
            sample_size: cacheEntry.sample_size,
            severity: 'error',
            notes: `Invalid sample_size: ${cacheEntry.sample_size} (expected 1-5)`
          });
          teamsToAutoHeal.push(team.team_id);
        }

        // Compare each metric
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
              notes: `DB avg: ${m.db.toFixed(2)}, Cache: ${m.cache.toFixed(2)}, Diff: ${diff.toFixed(2)}`
            });

            // Auto-heal: mark CRITICAL goals violations in ALLOWED leagues for cache clear
            if (m.name === 'goals' && severity === 'critical' && isAllowedLeagueTeam(fixtureLeagues)) {
              teamsToAutoHeal.push(team.team_id);
            }
          }
        }

        teamsProcessed++;
      }

      console.log(`[stats-health-check] Processed ${teamsProcessed}/${teamsDiscovered.length} teams, ${violations.length} violations so far`);
    }

    // Step 4: Upsert violations (deduplicate by team_id + metric)
    // First delete old unresolved violations for teams we're about to update
    console.log(`[stats-health-check] Step 4: Upserting ${violations.length} violations (with deduplication)...`);
    
    // Group violations by team_id+metric to keep only the most recent
    const violationMap = new Map<string, Violation>();
    for (const v of violations) {
      const key = `${v.team_id}_${v.metric}`;
      violationMap.set(key, v); // Later violations overwrite earlier ones
    }
    
    const deduplicatedViolations = Array.from(violationMap.values());
    console.log(`[stats-health-check] After deduplication: ${deduplicatedViolations.length} unique violations`);
    
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

    // Step 5: Auto-heal critical violations (clear cache for affected teams)
    const uniqueTeamsToHeal = [...new Set(teamsToAutoHeal)];
    let autoHealedCount = 0;
    
    if (uniqueTeamsToHeal.length > 0) {
      console.log(`[stats-health-check] Step 5: Auto-healing ${uniqueTeamsToHeal.length} teams with critical violations...`);
      
      // Delete stats_cache entries for these teams to force recalculation
      const { error: deleteError } = await supabase
        .from("stats_cache")
        .delete()
        .in("team_id", uniqueTeamsToHeal);
      
      if (!deleteError) {
        autoHealedCount = uniqueTeamsToHeal.length;
        console.log(`[stats-health-check] Cleared stats_cache for ${autoHealedCount} teams. They will be recomputed by next stats-refresh batch.`);
        
        // Mark violations as auto-healed in notes
        await supabase
          .from("stats_health_violations")
          .update({ 
            notes: 'Auto-heal initiated - cache cleared'
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

    // Count only the deduplicated violations
    for (const v of deduplicatedViolations) {
      violationsBySeverity[v.severity]++;
      violationsByMetric[v.metric] = (violationsByMetric[v.metric] || 0) + 1;
    }

    // Count top-league goals critical for status determination
    const topLeagueGoalsCritical = deduplicatedViolations.filter(v => 
      v.metric === 'goals' && 
      v.severity === 'critical' && 
      v.league_ids && 
      isTopLeagueTeam(v.league_ids)
    ).length;

    // Determine status based on TOP LEAGUE GOALS CRITICAL count only
    // This prevents lower-division noise from triggering false alarms
    let status: "HEALTHY" | "DEGRADED" | "CRITICAL" = "HEALTHY";
    if (topLeagueGoalsCritical > 3) {
      status = "CRITICAL";
    } else if (topLeagueGoalsCritical > 0 || violationsBySeverity.critical > 50) {
      status = "DEGRADED";
    }

    const durationMs = Date.now() - startTime;

    // Generate recommendations
    const recommendations: string[] = [];
    if (topLeagueGoalsCritical > 0) {
      recommendations.push(`⚠️ ${topLeagueGoalsCritical} TOP LEAGUE teams have critical GOALS violations - auto-heal initiated`);
    }
    if (violationsByMetric['missing_results'] > 0) {
      recommendations.push(`Run results-refresh to backfill ${violationsByMetric['missing_results']} fixtures with missing results`);
    }
    if (violationsByMetric['missing_cache'] > 0) {
      recommendations.push(`Run stats-refresh to populate ${violationsByMetric['missing_cache']} teams with missing cache`);
    }
    if (autoHealedCount > 0) {
      recommendations.push(`✅ Auto-healed ${autoHealedCount} teams - cache cleared, awaiting next stats-refresh`);
    }

    // Log to optimizer_run_logs
    await supabase.from("optimizer_run_logs").insert({
      run_type: "stats-health-check",
      window_start: new Date(lookbackTimestamp * 1000).toISOString(),
      window_end: new Date().toISOString(),
      scanned: teamsProcessed,
      upserted: deduplicatedViolations.length,
      failed: 0,
      duration_ms: durationMs,
      notes: `Status: ${status}, Critical: ${violationsBySeverity.critical}, TopLeagueCritical: ${topLeagueGoalsCritical}, AutoHealed: ${autoHealedCount}`
    });

    const result: HealthCheckResult = {
      timestamp: new Date().toISOString(),
      teams_checked: teamsProcessed,
      violations_by_severity: violationsBySeverity,
      violations_by_metric: violationsByMetric,
      status,
      top_violations: deduplicatedViolations
        .filter(v => v.severity === 'critical' || v.severity === 'error')
        .slice(0, 20),
      recommendations,
      duration_ms: durationMs,
      auto_healed: autoHealedCount,
      top_league_goals_critical: topLeagueGoalsCritical
    };

    console.log(`[stats-health-check] Complete. Status: ${status}, Critical: ${violationsBySeverity.critical}, TopLeagueGoalsCritical: ${topLeagueGoalsCritical}, AutoHealed: ${autoHealedCount}, Duration: ${durationMs}ms`);

    return jsonResponse(result, origin, 200, req);

  } catch (error) {
    console.error("[stats-health-check] Error:", error);
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(errMsg, origin, 500, req);
  }
});
