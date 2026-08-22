import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { apiHeaders, API_BASE } from "../_shared/api.ts";
import { getFootballSeasonForLeague } from "../_shared/season.ts";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";
import { readJsonWithLimit } from "../_shared/request.ts";
import {
  boundedRotatingSelection,
  clampProviderCallLimit,
  fetchWithProviderBudget,
  ProviderCallBudget,
  ProviderControlError,
} from "../_shared/provider_budget.ts";

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
const MAX_PROVIDER_CALLS_PER_RUN = 12;

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
  season: number,
  budget: ProviderCallBudget,
): Promise<SeasonStats | null> {
  const url = `${API_BASE}/teams/statistics?team=${teamId}&league=${leagueId}&season=${season}`;
  const headers = apiHeaders();

  try {
    const response = await fetchWithProviderBudget(url, { headers }, budget);
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
    if (err instanceof ProviderControlError) throw err;
    console.error(`[team-totals-refresh] Fetch error for team ${teamId}:`, err);
    return null;
  }
}

async function fetchLast5LeagueFixtures(
  teamId: number,
  leagueId: number,
  season: number,
  budget: ProviderCallBudget,
): Promise<Last5Result> {
  const url = `${API_BASE}/fixtures?team=${teamId}&league=${leagueId}&season=${season}&last=5&status=FT`;
  const headers = apiHeaders();

  try {
    const response = await fetchWithProviderBudget(url, { headers }, budget);
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
    if (err instanceof ProviderControlError) throw err;
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
    const auth = await checkCronOrAdminAuth(
      req,
      supabase,
      SUPABASE_SERVICE_ROLE_KEY,
      "[team-totals-refresh]",
    );
    if (!auth.authorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }
    const trigger = auth.method === "cron_key" ? "cron" : "admin";

    const body = (await readJsonWithLimit(req, 16_384).catch(() => null) ?? {}) as Record<string, unknown>;
    if (auth.method !== "cron_key" && body.confirm_provider_calls !== true) {
      return errorResponse("Manual provider calls require confirm_provider_calls=true", origin, 412, req);
    }
    const providerBudget = new ProviderCallBudget(
      clampProviderCallLimit(body.max_provider_calls, MAX_PROVIDER_CALLS_PER_RUN),
    );
    let windowHours = TEAM_TOTALS_WINDOW_HOURS;
    if (body.window_hours && typeof body.window_hours === "number") {
      windowHours = Math.min(Math.max(body.window_hours, 1), 720);
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

    const selectedFixtures = boundedRotatingSelection(
      fixtures || [],
      Math.min(MAX_FIXTURES_PER_RUN, Math.ceil(providerBudget.limit / 2)),
      Math.floor(Date.now() / (6 * 60 * 60 * 1000)),
    );

    for (const fixture of selectedFixtures) {
      try {
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
      const season = getFootballSeasonForLeague(
        leagueId,
        new Date(fixture.timestamp * 1000),
      );
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
        const homeStats = await fetchSeasonStats(homeTeamId, leagueId, season, providerBudget);
        statsCache.set(homeCacheKey, homeStats);
      }

      if (!statsCache.has(awayCacheKey)) {
        await delay(RATE_DELAY_MS);
        const awayStats = await fetchSeasonStats(awayTeamId, leagueId, season, providerBudget);
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
        const awayLast5 = await fetchLast5LeagueFixtures(awayTeamId, leagueId, season, providerBudget);

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
        const homeLast5 = await fetchLast5LeagueFixtures(homeTeamId, leagueId, season, providerBudget);

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
      } catch (err) {
        errors++;
        if (err instanceof ProviderControlError) {
          console.warn(`[team-totals-refresh] Provider stop: ${err.reason}`);
          break;
        }
        console.error(`[team-totals-refresh] Fixture ${fixture.id} failed:`, err);
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
          selected_fixtures: selectedFixtures.length,
          provider: providerBudget.snapshot(),
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
        success: errors === 0 && providerBudget.failures === 0,
        trigger,
        window_hours: windowHours,
        scanned_fixtures: scannedFixtures,
        total_fixtures: totalFixtures,
        upserted: inserted + updated,
        skipped,
        home_pass: homePass,
        away_pass: awayPass,
        errors,
        provider: providerBudget.snapshot(),
        duration_ms: duration,
      },
      origin,
      errors === 0 && providerBudget.failures === 0 ? 200 : 502,
      req
    );
  } catch (err) {
    console.error("[team-totals-refresh] Unhandled error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, origin, 500, req);
  }
});
