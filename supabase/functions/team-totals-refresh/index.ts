import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { apiHeaders, API_BASE } from "../_shared/api.ts";

/**
 * team-totals-refresh
 * 
 * Automated edge function that populates/refreshes team_totals_candidates table.
 * Reuses the same logic as populate-team-totals-candidates but designed for cron automation.
 * 
 * Called by:
 * - pg_cron job every 6 hours
 * - Admin manual trigger (uses same endpoint)
 * 
 * Auth: X-CRON-KEY or admin JWT
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Configuration constants
const TEAM_TOTALS_WINDOW_HOURS = 48; // Focus on 48h window per architectural constraint
const RATE_DELAY_MS = 1000; // ~50 rpm with margin
const MAX_PROCESSING_TIME_MS = 50000; // 50 seconds (safe for Edge timeout)
const MAX_FIXTURES_PER_RUN = 30; // Conservative batch size

interface SeasonStats {
  scoring_rate: number;
  conceding_rate: number;
}

interface Last5Result {
  conceded_2plus_count: number;
  sample_size: number;
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSeasonStats(
  teamId: number,
  leagueId: number,
  season: number
): Promise<SeasonStats | null> {
  const url = `${API_BASE}/teams/statistics?team=${teamId}&league=${leagueId}&season=${season}`;
  const headers = apiHeaders();

  try {
    const response = await fetch(url, { headers });
    const json = await response.json();

    if (!response.ok || json.errors?.length > 0) {
      console.warn(`[team-totals-refresh] Stats API error for team ${teamId}:`, json.errors);
      return null;
    }

    const stats = json.response;
    if (!stats) return null;

    const fixturesPlayed = stats.fixtures?.played?.total || 0;
    if (fixturesPlayed === 0) return null;

    const goalsFor = stats.goals?.for?.total?.total || 0;
    const goalsAgainst = stats.goals?.against?.total?.total || 0;

    return {
      scoring_rate: goalsFor / fixturesPlayed,
      conceding_rate: goalsAgainst / fixturesPlayed,
    };
  } catch (err) {
    console.error(`[team-totals-refresh] Fetch error for team ${teamId}:`, err);
    return null;
  }
}

async function fetchLast5LeagueFixtures(
  teamId: number,
  leagueId: number,
  season: number
): Promise<Last5Result> {
  const url = `${API_BASE}/fixtures?team=${teamId}&league=${leagueId}&season=${season}&last=5&status=FT`;
  const headers = apiHeaders();

  try {
    const response = await fetch(url, { headers });
    const json = await response.json();

    if (!response.ok || json.errors?.length > 0) {
      console.warn(`[team-totals-refresh] Last 5 API error for team ${teamId}:`, json.errors);
      return { conceded_2plus_count: 0, sample_size: 0 };
    }

    const fixtures = json.response || [];
    const sample_size = fixtures.length;
    let conceded_2plus_count = 0;

    for (const fixture of fixtures) {
      const homeId = fixture.teams?.home?.id;
      const homeGoals = fixture.goals?.home ?? 0;
      const awayGoals = fixture.goals?.away ?? 0;

      const opponentGoals = homeId === teamId ? awayGoals : homeGoals;
      if (opponentGoals >= 2) {
        conceded_2plus_count++;
      }
    }

    return { conceded_2plus_count, sample_size };
  } catch (err) {
    console.error(`[team-totals-refresh] Fetch error for last 5 (team ${teamId}):`, err);
    return { conceded_2plus_count: 0, sample_size: 0 };
  }
}

serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    // Auth check: cron key or admin JWT
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");

    let isAuthorized = false;
    let trigger = "unknown";

    // Check X-CRON-KEY first (via RPC to get stored key)
    if (cronKeyHeader) {
      const { data: dbKey, error: keyError } = await supabase.rpc("get_cron_internal_key");
      if (!keyError && dbKey && cronKeyHeader === dbKey) {
        isAuthorized = true;
        trigger = "cron";
        console.log("[team-totals-refresh] Authorized via cron key");
      }
    }

    // If not authorized via cron key, check admin JWT
    if (!isAuthorized && authHeader && supabaseAnonKey) {
      try {
        const userClient = createClient(SUPABASE_URL, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader } }
        });
        const { data: isWhitelisted } = await userClient.rpc("is_user_whitelisted");
        if (isWhitelisted) {
          isAuthorized = true;
          trigger = "admin";
          console.log("[team-totals-refresh] Authorized via admin JWT");
        }
      } catch (authErr) {
        console.error("[team-totals-refresh] Auth error:", authErr);
      }
    }

    if (!isAuthorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }

    // Parse optional window_hours from body (default to TEAM_TOTALS_WINDOW_HOURS)
    let windowHours = TEAM_TOTALS_WINDOW_HOURS;
    try {
      const body = await req.json().catch(() => ({}));
      if (body.window_hours && typeof body.window_hours === "number") {
        windowHours = Math.min(Math.max(body.window_hours, 1), 720);
      }
    } catch {
      // Use defaults
    }

    console.log(`[team-totals-refresh] Starting: window=${windowHours}h, trigger=${trigger}`);

    // Get upcoming fixtures within window
    const windowEnd = Date.now() / 1000 + windowHours * 3600;
    const { data: fixtures, error: fixturesError } = await supabase
      .from("fixtures")
      .select("id, league_id, timestamp, teams_home, teams_away, status")
      .in("status", ["NS", "TBD"])
      .gte("timestamp", Math.floor(Date.now() / 1000))
      .lte("timestamp", Math.floor(windowEnd))
      .order("timestamp", { ascending: true })
      .limit(MAX_FIXTURES_PER_RUN);

    if (fixturesError) {
      console.error("[team-totals-refresh] Fixtures query error:", fixturesError);
      return errorResponse("Failed to fetch fixtures", origin, 500, req);
    }

    const totalFixtures = fixtures?.length || 0;
    console.log(`[team-totals-refresh] Found ${totalFixtures} upcoming fixtures`);

    let scannedFixtures = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let homePass = 0;
    let awayPass = 0;
    let errors = 0;

    // Cache for season stats to avoid duplicate API calls
    const statsCache = new Map<string, SeasonStats | null>();

    for (const fixture of fixtures || []) {
      // Check if approaching timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_PROCESSING_TIME_MS) {
        console.log(`[team-totals-refresh] Approaching timeout at ${elapsed}ms, stopping early`);
        break;
      }

      scannedFixtures++;

      const homeTeamId = fixture.teams_home?.id;
      const awayTeamId = fixture.teams_away?.id;
      const leagueId = fixture.league_id;
      const season = 2025;
      const utcKickoff = new Date(fixture.timestamp * 1000).toISOString();

      if (!homeTeamId || !awayTeamId) {
        skipped++;
        continue;
      }

      // Fetch season stats for both teams (with caching)
      const homeCacheKey = `${homeTeamId}-${leagueId}-${season}`;
      const awayCacheKey = `${awayTeamId}-${leagueId}-${season}`;

      if (!statsCache.has(homeCacheKey)) {
        await delay(RATE_DELAY_MS);
        const homeStats = await fetchSeasonStats(homeTeamId, leagueId, season);
        statsCache.set(homeCacheKey, homeStats);
      }

      if (!statsCache.has(awayCacheKey)) {
        await delay(RATE_DELAY_MS);
        const awayStats = await fetchSeasonStats(awayTeamId, leagueId, season);
        statsCache.set(awayCacheKey, awayStats);
      }

      const homeStats = statsCache.get(homeCacheKey);
      const awayStats = statsCache.get(awayCacheKey);

      if (!homeStats || !awayStats) {
        skipped++;
        continue;
      }

      // Evaluate Home O1.5
      if (homeStats.scoring_rate >= 2.0) {
        await delay(RATE_DELAY_MS);
        const awayLast5 = await fetchLast5LeagueFixtures(awayTeamId, leagueId, season);

        const homePasses =
          awayStats.conceding_rate >= 2.0 &&
          awayLast5.conceded_2plus_count >= 3 &&
          awayLast5.sample_size >= 3;

        try {
          const { error: upsertError } = await supabase
            .from("team_totals_candidates")
            .upsert(
              {
                fixture_id: fixture.id,
                league_id: leagueId,
                team_id: homeTeamId,
                team_context: "home",
                line: 1.5,
                season_scoring_rate: homeStats.scoring_rate,
                opponent_season_conceding_rate: awayStats.conceding_rate,
                opponent_recent_conceded_2plus: awayLast5.conceded_2plus_count,
                recent_sample_size: awayLast5.sample_size,
                rules_passed: homePasses,
                rules_version: "v1.0",
                utc_kickoff: utcKickoff,
                computed_at: new Date().toISOString(),
              },
              { onConflict: "fixture_id,team_id,team_context" }
            );

          if (upsertError) {
            console.error(`[team-totals-refresh] Home O1.5 upsert error for fixture ${fixture.id}:`, upsertError);
            errors++;
          } else {
            if (homePasses) homePass++;
            inserted++;
          }
        } catch (err) {
          console.error(`[team-totals-refresh] Home O1.5 error for fixture ${fixture.id}:`, err);
          errors++;
        }
      }

      // Evaluate Away O1.5
      if (awayStats.scoring_rate >= 2.0) {
        await delay(RATE_DELAY_MS);
        const homeLast5 = await fetchLast5LeagueFixtures(homeTeamId, leagueId, season);

        const awayPasses =
          homeStats.conceding_rate >= 2.0 &&
          homeLast5.conceded_2plus_count >= 3 &&
          homeLast5.sample_size >= 3;

        try {
          const { error: upsertError } = await supabase
            .from("team_totals_candidates")
            .upsert(
              {
                fixture_id: fixture.id,
                league_id: leagueId,
                team_id: awayTeamId,
                team_context: "away",
                line: 1.5,
                season_scoring_rate: awayStats.scoring_rate,
                opponent_season_conceding_rate: homeStats.conceding_rate,
                opponent_recent_conceded_2plus: homeLast5.conceded_2plus_count,
                recent_sample_size: homeLast5.sample_size,
                rules_passed: awayPasses,
                rules_version: "v1.0",
                utc_kickoff: utcKickoff,
                computed_at: new Date().toISOString(),
              },
              { onConflict: "fixture_id,team_id,team_context" }
            );

          if (upsertError) {
            console.error(`[team-totals-refresh] Away O1.5 upsert error for fixture ${fixture.id}:`, upsertError);
            errors++;
          } else {
            if (awayPasses) awayPass++;
            updated++;
          }
        } catch (err) {
          console.error(`[team-totals-refresh] Away O1.5 error for fixture ${fixture.id}:`, err);
          errors++;
        }
      }
    }

    const duration = Date.now() - startTime;

    // Log to optimizer_run_logs for monitoring
    try {
      await supabase.from("optimizer_run_logs").insert({
        run_type: "team-totals-refresh",
        window_start: new Date().toISOString(),
        window_end: new Date(Date.now() + windowHours * 3600 * 1000).toISOString(),
        scanned: scannedFixtures,
        upserted: inserted + updated,
        skipped,
        failed: errors,
        started_at: new Date(startTime).toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: duration,
        scope: {
          trigger,
          window_hours: windowHours,
          home_pass: homePass,
          away_pass: awayPass,
          total_fixtures: totalFixtures,
        },
        notes: `Team Totals O1.5 refresh: ${homePass} home + ${awayPass} away passed`,
      });
    } catch (logErr) {
      console.warn("[team-totals-refresh] Failed to log run:", logErr);
    }

    console.log(
      `[team-totals-refresh] Complete: scanned=${scannedFixtures}/${totalFixtures}, upserted=${inserted + updated}, skipped=${skipped}, home_pass=${homePass}, away_pass=${awayPass}, errors=${errors}, duration=${duration}ms`
    );

    return jsonResponse(
      {
        success: true,
        trigger,
        window_hours: windowHours,
        scanned_fixtures: scannedFixtures,
        total_fixtures: totalFixtures,
        upserted: inserted + updated,
        skipped,
        home_pass: homePass,
        away_pass: awayPass,
        errors,
        duration_ms: duration,
      },
      origin,
      200,
      req
    );
  } catch (err) {
    console.error("[team-totals-refresh] Unhandled error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, origin, 500, req);
  }
});
