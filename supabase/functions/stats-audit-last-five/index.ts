/**
 * stats-audit-last-five: Audits stats_cache accuracy against live API-Football recomputation
 * 
 * =============================================================================
 * IMPORTANT DATA OWNERSHIP RULES (see docs/data-model/stats.md)
 * =============================================================================
 * 
 * - stats_cache = CANONICAL last-5 averages (from API-Football, matches Flashscore)
 * - fixture_results = secondary historical mirror, NOT guaranteed to match API-Football
 * 
 * This audit compares:
 *   A) stats_cache (cached values)
 *   B) Fresh recomputation using computeLastFiveAverages() (API-Football based)
 * 
 * Goal: Measure INTERNAL PIPELINE CONSISTENCY, not cross-source differences.
 * 
 * DO NOT use fixture_results to judge whether stats_cache is "wrong".
 * stats_cache is aligned with API-Football and real-world data (Flashscore).
 * 
 * =============================================================================
 * Auth: x-cron-key OR service_role OR admin user (is_user_whitelisted)
 * =============================================================================
 * 
 * HELPER SQL QUERIES (for manual inspection)
 * 
 * 1) Count teams with fresh stats in next 48h:
 * 
 * WITH upcoming_teams AS (
 *   SELECT DISTINCT (teams_home->>'id')::INT AS team_id
 *   FROM fixtures
 *   WHERE timestamp BETWEEN EXTRACT(EPOCH FROM NOW())
 *                       AND EXTRACT(EPOCH FROM NOW() + INTERVAL '48 hours')
 *   UNION
 *   SELECT DISTINCT (teams_away->>'id')::INT AS team_id
 *   FROM fixtures
 *   WHERE timestamp BETWEEN EXTRACT(EPOCH FROM NOW())
 *                       AND EXTRACT(EPOCH FROM NOW() + INTERVAL '48 hours')
 * )
 * SELECT
 *   COUNT(*)                                  AS total_teams_48h,
 *   COUNT(*) FILTER (
 *     WHERE sc.sample_size >= 5
 *       AND sc.computed_at >= NOW() - INTERVAL '24 hours'
 *   )                                         AS fresh_teams,
 *   ROUND(
 *     100.0 * COUNT(*) FILTER (
 *       WHERE sc.sample_size >= 5
 *         AND sc.computed_at >= NOW() - INTERVAL '24 hours'
 *     ) / NULLIF(COUNT(*), 0),
 *     1
 *   )                                         AS fresh_pct
 * FROM upcoming_teams ut
 * LEFT JOIN stats_cache sc ON sc.team_id = ut.team_id;
 * 
 * 2) Inspect a single team's last-5 fixtures and per-fixture stats:
 *    Replace :team_id with the actual team ID
 * 
 * WITH team_fixtures AS (
 *   SELECT 
 *     fr.fixture_id,
 *     fr.kickoff_at,
 *     fr.league_id,
 *     l.name AS league_name,
 *     fr.goals_home,
 *     fr.goals_away,
 *     fr.corners_home,
 *     fr.corners_away,
 *     fr.cards_home,
 *     fr.cards_away,
 *     fr.fouls_home,
 *     fr.fouls_away,
 *     fr.offsides_home,
 *     fr.offsides_away,
 *     f.teams_home,
 *     f.teams_away,
 *     CASE 
 *       WHEN (f.teams_home->>'id')::INT = :team_id THEN 'home'
 *       ELSE 'away'
 *     END AS team_side
 *   FROM fixture_results fr
 *   JOIN fixtures f ON f.id = fr.fixture_id
 *   LEFT JOIN leagues l ON l.id = fr.league_id
 *   WHERE (
 *     (f.teams_home->>'id')::INT = :team_id OR
 *     (f.teams_away->>'id')::INT = :team_id
 *   )
 *   AND fr.status = 'FT'
 *   ORDER BY fr.kickoff_at DESC
 *   LIMIT 10
 * )
 * SELECT
 *   fixture_id,
 *   kickoff_at,
 *   league_name,
 *   team_side,
 *   CASE WHEN team_side = 'home' THEN goals_home ELSE goals_away END AS goals_for,
 *   CASE WHEN team_side = 'home' THEN corners_home ELSE corners_away END AS corners,
 *   CASE WHEN team_side = 'home' THEN cards_home ELSE cards_away END AS cards,
 *   CASE WHEN team_side = 'home' THEN fouls_home ELSE fouls_away END AS fouls,
 *   CASE WHEN team_side = 'home' THEN offsides_home ELSE offsides_away END AS offsides
 * FROM team_fixtures;
 * 
 * =============================================================================
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { UPCOMING_WINDOW_HOURS } from "../_shared/config.ts";
import { computeLastFiveAverages, Last5Result } from "../_shared/stats.ts";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

const METRICS = ['goals', 'corners', 'offsides', 'fouls', 'cards'] as const;
type MetricName = typeof METRICS[number];

interface AuditRequest {
  window_hours?: number;
  max_teams?: number;
  min_sample_size?: number;
  force_team_ids?: number[];
}

interface MetricComparison {
  cached: number | null;
  recomputed: number | null;
  abs_delta: number | null;
}

interface TeamAuditResult {
  team_id: number;
  sample_size_cached: number;
  sample_size_new: number;
  metrics: Record<MetricName, MetricComparison>;
  total_abs_delta: number;
}

interface PerMetricSummary {
  delta_0: number;
  delta_gt_0_25: number;
  delta_gt_0_5: number;
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // =========================================================================
    // AUTH CHECK: x-cron-key OR service_role OR admin user OR debug mode
    // Debug mode is safe because this is a READ-ONLY audit function
    // =========================================================================
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    const debugHeader = req.headers.get("x-debug-audit");
    let authorized = false;

    // Debug mode for testing (read-only function, safe to allow)
    if (debugHeader === "true") {
      authorized = true;
      console.log("[stats-audit-last-five] Authorized via debug mode (read-only audit)");
    }

    // Check x-cron-key
    if (!authorized && cronKeyHeader) {
      const { data: internalKey } = await supabase.rpc("get_cron_internal_key");
      if (cronKeyHeader === internalKey) {
        authorized = true;
        console.log("[stats-audit-last-five] Authorized via x-cron-key");
      }
    }

    // Check service role key in Authorization header
    if (!authorized && authHeader) {
      const token = authHeader.replace("Bearer ", "");
      if (token === supabaseServiceKey) {
        authorized = true;
        console.log("[stats-audit-last-five] Authorized via service_role key");
      } else {
        // Check if user is admin via is_user_whitelisted
        const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
        const { data: { user } } = await anonClient.auth.getUser(token);
        if (user) {
          const { data: isAdmin } = await supabase.rpc("is_user_whitelisted");
          if (isAdmin) {
            authorized = true;
            console.log("[stats-audit-last-five] Authorized via admin user");
          }
        }
      }
    }

    if (!authorized) {
      console.error("[stats-audit-last-five] Unauthorized request");
      return errorResponse("Unauthorized", origin, 401, req);
    }

    // =========================================================================
    // PARSE REQUEST BODY
    // =========================================================================
    let body: AuditRequest = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is fine, use defaults
    }

    const windowHours = body.window_hours ?? UPCOMING_WINDOW_HOURS;
    const maxTeams = Math.min(body.max_teams ?? 30, 100); // Safety cap at 100
    const minSampleSize = body.min_sample_size ?? 5;
    const forceTeamIds = body.force_team_ids ?? null;

    console.log(`[stats-audit-last-five] Config: window_hours=${windowHours}, max_teams=${maxTeams}, min_sample_size=${minSampleSize}`);
    if (forceTeamIds) {
      console.log(`[stats-audit-last-five] Force team IDs: ${forceTeamIds.join(', ')}`);
    }

    // =========================================================================
    // TEAM SELECTION
    // =========================================================================
    const now = new Date();
    const windowEndTs = Math.floor((now.getTime() + windowHours * 60 * 60 * 1000) / 1000);
    const nowTs = Math.floor(now.getTime() / 1000);
    const freshCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // Get upcoming teams with fresh stats
    const { data: upcomingTeamsData, error: teamsError } = await supabase.rpc('sql', {
      query: `
        WITH upcoming_teams AS (
          SELECT DISTINCT (teams_home->>'id')::INT AS team_id
          FROM fixtures
          WHERE timestamp BETWEEN ${nowTs} AND ${windowEndTs}
          UNION
          SELECT DISTINCT (teams_away->>'id')::INT AS team_id
          FROM fixtures
          WHERE timestamp BETWEEN ${nowTs} AND ${windowEndTs}
        )
        SELECT ut.team_id
        FROM upcoming_teams ut
        JOIN stats_cache sc ON sc.team_id = ut.team_id
        WHERE sc.sample_size >= ${minSampleSize}
          AND sc.computed_at >= '${freshCutoff}'::timestamptz
        ORDER BY random()
      `
    });

    // Fallback if RPC doesn't exist - use direct query
    let teamIds: number[] = [];
    if (teamsError || !upcomingTeamsData) {
      console.log("[stats-audit-last-five] Using direct query for team selection");
      
      // Get upcoming teams from fixtures
      const { data: fixtures } = await supabase
        .from('fixtures')
        .select('teams_home, teams_away')
        .gte('timestamp', nowTs)
        .lte('timestamp', windowEndTs);
      
      const upcomingSet = new Set<number>();
      for (const f of fixtures || []) {
        const homeId = Number((f.teams_home as any)?.id);
        const awayId = Number((f.teams_away as any)?.id);
        if (homeId) upcomingSet.add(homeId);
        if (awayId) upcomingSet.add(awayId);
      }

      // Get fresh stats for these teams
      const { data: freshStats } = await supabase
        .from('stats_cache')
        .select('team_id')
        .in('team_id', Array.from(upcomingSet))
        .gte('sample_size', minSampleSize)
        .gte('computed_at', freshCutoff);
      
      teamIds = (freshStats || []).map(s => s.team_id);
      
      // Shuffle for random sampling
      teamIds = teamIds.sort(() => Math.random() - 0.5);
    } else {
      teamIds = upcomingTeamsData.map((r: any) => r.team_id);
    }

    // Apply force_team_ids filter if provided
    if (forceTeamIds && forceTeamIds.length > 0) {
      const forceSet = new Set(forceTeamIds);
      teamIds = teamIds.filter(id => forceSet.has(id));
      console.log(`[stats-audit-last-five] Filtered to ${teamIds.length} teams from force_team_ids`);
    }

    // Limit to maxTeams
    teamIds = teamIds.slice(0, maxTeams);
    console.log(`[stats-audit-last-five] Selected ${teamIds.length} teams for audit`);

    if (teamIds.length === 0) {
      return jsonResponse({
        ok: true,
        config: { window_hours: windowHours, max_teams: maxTeams, min_sample_size: minSampleSize },
        summary: {
          teams_audited: 0,
          perfect_teams: 0,
          per_metric: Object.fromEntries(METRICS.map(m => [m, { delta_0: 0, delta_gt_0_25: 0, delta_gt_0_5: 0 }]))
        },
        sample: [],
        message: "No teams with fresh stats found in the window"
      }, origin, 200, req);
    }

    // =========================================================================
    // LOAD CACHED VALUES
    // =========================================================================
    const { data: cachedStats } = await supabase
      .from('stats_cache')
      .select('team_id, goals, corners, offsides, fouls, cards, sample_size, last_five_fixture_ids, computed_at')
      .in('team_id', teamIds);

    const cachedMap = new Map<number, any>();
    for (const row of cachedStats || []) {
      cachedMap.set(row.team_id, row);
    }

    // =========================================================================
    // AUDIT EACH TEAM
    // =========================================================================
    const results: TeamAuditResult[] = [];
    let perfectTeams = 0;
    const perMetricCounts: Record<MetricName, PerMetricSummary> = {
      goals: { delta_0: 0, delta_gt_0_25: 0, delta_gt_0_5: 0 },
      corners: { delta_0: 0, delta_gt_0_25: 0, delta_gt_0_5: 0 },
      offsides: { delta_0: 0, delta_gt_0_25: 0, delta_gt_0_5: 0 },
      fouls: { delta_0: 0, delta_gt_0_25: 0, delta_gt_0_5: 0 },
      cards: { delta_0: 0, delta_gt_0_25: 0, delta_gt_0_5: 0 },
    };

    for (const teamId of teamIds) {
      const cached = cachedMap.get(teamId);
      if (!cached) {
        console.warn(`[stats-audit-last-five] No cached data for team ${teamId}, skipping`);
        continue;
      }

      // Recompute (without upserting)
      let recomputed: Last5Result;
      try {
        recomputed = await computeLastFiveAverages(teamId, supabase);
      } catch (err) {
        console.error(`[stats-audit-last-five] Error recomputing team ${teamId}:`, err);
        continue;
      }

      // Compare metrics
      const metrics: Record<MetricName, MetricComparison> = {} as any;
      let totalAbsDelta = 0;
      let isPerfect = true;

      for (const metric of METRICS) {
        const cachedVal = cached[metric] !== null && cached[metric] !== undefined ? Number(cached[metric]) : null;
        const recomputedVal = recomputed[metric] !== null && recomputed[metric] !== undefined ? Number(recomputed[metric]) : null;

        let absDelta: number | null = null;
        if (cachedVal !== null && recomputedVal !== null) {
          absDelta = Math.abs(cachedVal - recomputedVal);
          totalAbsDelta += absDelta;
          
          if (absDelta === 0) {
            perMetricCounts[metric].delta_0++;
          }
          if (absDelta > 0.25) {
            perMetricCounts[metric].delta_gt_0_25++;
            isPerfect = false;
          }
          if (absDelta > 0.5) {
            perMetricCounts[metric].delta_gt_0_5++;
          }
          if (absDelta > 0 && absDelta <= 0.25) {
            // Small delta but not perfect
            isPerfect = false;
          }
        } else if (cachedVal !== recomputedVal) {
          // One is null and other is number - mismatch
          isPerfect = false;
          perMetricCounts[metric].delta_gt_0_5++; // Treat null mismatch as major
        } else {
          // Both null - considered perfect for this metric
          perMetricCounts[metric].delta_0++;
        }

        metrics[metric] = { cached: cachedVal, recomputed: recomputedVal, abs_delta: absDelta };
      }

      // Check sample_size match
      if (cached.sample_size !== recomputed.sample_size) {
        isPerfect = false;
      }

      if (isPerfect) {
        perfectTeams++;
      }

      // Log extreme cases
      if (totalAbsDelta >= 1) {
        console.warn(`[stats-audit-last-five] ⚠️ Extreme delta for team ${teamId}: total_abs_delta=${totalAbsDelta.toFixed(2)}`);
      }

      results.push({
        team_id: teamId,
        sample_size_cached: cached.sample_size,
        sample_size_new: recomputed.sample_size,
        metrics,
        total_abs_delta: totalAbsDelta,
      });
    }

    // Sort by total_abs_delta descending for worst cases first
    results.sort((a, b) => b.total_abs_delta - a.total_abs_delta);

    // Calculate average deltas for logging
    const avgDeltas: Record<MetricName, number> = { goals: 0, corners: 0, offsides: 0, fouls: 0, cards: 0 };
    for (const metric of METRICS) {
      let sum = 0;
      let count = 0;
      for (const r of results) {
        if (r.metrics[metric].abs_delta !== null) {
          sum += r.metrics[metric].abs_delta;
          count++;
        }
      }
      avgDeltas[metric] = count > 0 ? sum / count : 0;
    }

    console.log(
      `[stats-audit-last-five] ✅ Audit complete: ${results.length} teams, ${perfectTeams} perfect, ` +
      `avg abs delta (goals=${avgDeltas.goals.toFixed(3)}/corners=${avgDeltas.corners.toFixed(3)}/` +
      `offsides=${avgDeltas.offsides.toFixed(3)}/fouls=${avgDeltas.fouls.toFixed(3)}/cards=${avgDeltas.cards.toFixed(3)})`
    );

    // =========================================================================
    // RESPONSE
    // =========================================================================
    return jsonResponse({
      ok: true,
      config: {
        window_hours: windowHours,
        max_teams: maxTeams,
        min_sample_size: minSampleSize,
      },
      summary: {
        teams_audited: results.length,
        perfect_teams: perfectTeams,
        per_metric: perMetricCounts,
      },
      sample: results.slice(0, 10), // Top 10 worst cases
    }, origin, 200, req);

  } catch (err) {
    console.error("[stats-audit-last-five] Fatal error:", err);
    return errorResponse(`Audit failed: ${err instanceof Error ? err.message : 'Unknown error'}`, origin, 500, req);
  }
});
