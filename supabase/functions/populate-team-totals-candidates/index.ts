import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { apiHeaders, API_BASE } from "../_shared/api.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RequestBody {
  window_hours?: number;
  league_whitelist?: number[];
}

interface SeasonStats {
  scoring_rate: number;
  conceding_rate: number;
}

interface Last5Result {
  conceded_2plus_count: number;
  sample_size: number;
}

const RATE_DELAY_MS = 1000; // ~50 rpm with margin
const MAX_PROCESSING_TIME_MS = 130000; // 130 seconds (leave 20s buffer before timeout)
const MAX_FIXTURES_PER_RUN = 50; // Limit fixtures to prevent timeout

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
      console.warn(`[team-totals] Stats API error for team ${teamId}:`, json.errors);
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
    console.error(`[team-totals] Fetch error for team ${teamId}:`, err);
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
      console.warn(`[team-totals] Last 5 API error for team ${teamId}:`, json.errors);
      return { conceded_2plus_count: 0, sample_size: 0 };
    }

    const fixtures = json.response || [];
    const sample_size = fixtures.length;
    let conceded_2plus_count = 0;

    for (const fixture of fixtures) {
      const homeId = fixture.teams?.home?.id;
      const awayId = fixture.teams?.away?.id;
      const homeGoals = fixture.goals?.home ?? 0;
      const awayGoals = fixture.goals?.away ?? 0;

      // Determine opponent goals
      const opponentGoals = homeId === teamId ? awayGoals : homeGoals;
      if (opponentGoals >= 2) {
        conceded_2plus_count++;
      }
    }

    return { conceded_2plus_count, sample_size };
  } catch (err) {
    console.error(`[team-totals] Fetch error for last 5 (team ${teamId}):`, err);
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

    // Auth check
    const cronKey = req.headers.get("x-cron-key");
    const validCronKey = Deno.env.get("CRON_INTERNAL_KEY");
    const authHeader = req.headers.get("authorization");

    let isAuthorized = false;
    if (cronKey && cronKey === validCronKey) {
      isAuthorized = true;
      console.log("[team-totals] Authorized via cron key");
    } else if (authHeader) {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(
          authHeader.replace("Bearer ", "")
        );
        if (authError || !user) {
          return errorResponse("Unauthorized", origin, 401, req);
        }
        const { data: roleData } = await supabase.rpc("has_role", {
          _user_id: user.id,
          _role: "admin",
        });
        if (!roleData) {
          return errorResponse("Admin access required", origin, 403, req);
        }
        isAuthorized = true;
        console.log("[team-totals] Authorized via admin JWT");
      } catch (authErr) {
        console.error("[team-totals] Auth error:", authErr);
        return errorResponse("Authentication error", origin, 401, req);
      }
    }

    if (!isAuthorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }

    let body: RequestBody = {};
    try {
      if (req.method === "POST") {
        body = await req.json();
      }
    } catch (e) {
      console.warn("[team-totals] Failed to parse body:", e);
    }

    const windowHours = body.window_hours ?? 120;
    const leagueWhitelist = body.league_whitelist;

    console.log(`[team-totals] Starting: window=${windowHours}h`);

    // Get upcoming fixtures
    const windowEnd = Date.now() / 1000 + windowHours * 3600;
    let fixturesQuery = supabase
      .from("fixtures")
      .select("id, league_id, timestamp, teams_home, teams_away, status")
      .in("status", ["NS", "TBD"])
      .gte("timestamp", Math.floor(Date.now() / 1000))
      .lte("timestamp", Math.floor(windowEnd))
      .order("timestamp", { ascending: true });

    if (leagueWhitelist && leagueWhitelist.length > 0) {
      fixturesQuery = fixturesQuery.in("league_id", leagueWhitelist);
    }

    const { data: fixtures, error: fixturesError } = await fixturesQuery;

    if (fixturesError) {
      console.error("[team-totals] Fixtures query error:", fixturesError);
      return errorResponse("Failed to fetch fixtures", origin, 500, req);
    }

    // Limit fixtures to prevent timeout
    const totalFixtures = fixtures.length;
    const processFixtures = fixtures.slice(0, MAX_FIXTURES_PER_RUN);
    
    if (totalFixtures > MAX_FIXTURES_PER_RUN) {
      console.log(`[team-totals] Found ${totalFixtures} fixtures, processing first ${MAX_FIXTURES_PER_RUN} to prevent timeout`);
    } else {
      console.log(`[team-totals] Found ${totalFixtures} upcoming fixtures`);
    }

    let scannedFixtures = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let homePass = 0;
    let awayPass = 0;
    let errors = 0;

    // Cache for season stats to avoid duplicate API calls
    const statsCache = new Map<string, SeasonStats | null>();

    for (const fixture of processFixtures) {
      // Check if approaching timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_PROCESSING_TIME_MS) {
        console.log(`[team-totals] Approaching timeout at ${elapsed}ms, stopping early`);
        break;
      }

      scannedFixtures++;

      const homeTeamId = fixture.teams_home?.id;
      const awayTeamId = fixture.teams_away?.id;
      const leagueId = fixture.league_id;
      const season = 2025; // Current season
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
            console.error(`[team-totals] Home O1.5 upsert error for fixture ${fixture.id}:`, upsertError);
            errors++;
          } else {
            if (homePasses) homePass++;
            // Check if it was insert or update by querying
            const { count } = await supabase
              .from("team_totals_candidates")
              .select("id", { count: "exact", head: true })
              .eq("fixture_id", fixture.id)
              .eq("team_id", homeTeamId)
              .eq("team_context", "home");
            if (count === 1) inserted++;
            else updated++;
          }
        } catch (err) {
          console.error(`[team-totals] Home O1.5 error for fixture ${fixture.id}:`, err);
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
            console.error(`[team-totals] Away O1.5 upsert error for fixture ${fixture.id}:`, upsertError);
            errors++;
          } else {
            if (awayPasses) awayPass++;
            const { count } = await supabase
              .from("team_totals_candidates")
              .select("id", { count: "exact", head: true })
              .eq("fixture_id", fixture.id)
              .eq("team_id", awayTeamId)
              .eq("team_context", "away");
            if (count === 1) inserted++;
            else updated++;
          }
        } catch (err) {
          console.error(`[team-totals] Away O1.5 error for fixture ${fixture.id}:`, err);
          errors++;
        }
      }

      // Progress log every 10 fixtures
      if (scannedFixtures % 10 === 0) {
        const elapsed = Date.now() - startTime;
        console.log(
          `[team-totals] Progress: ${scannedFixtures}/${processFixtures.length} fixtures, ${homePass} home + ${awayPass} away passed (${Math.floor(elapsed/1000)}s elapsed)`
        );
      }
    }

    const duration = Date.now() - startTime;
    const wasLimited = totalFixtures > MAX_FIXTURES_PER_RUN;
    const timedOut = duration > MAX_PROCESSING_TIME_MS;
    
    console.log(
      `[team-totals] Complete: scanned=${scannedFixtures}/${totalFixtures}, inserted=${inserted}, updated=${updated}, skipped=${skipped}, home_pass=${homePass}, away_pass=${awayPass}, errors=${errors}, duration=${duration}ms`
    );

    return jsonResponse(
      {
        success: true,
        scanned_fixtures: scannedFixtures,
        total_fixtures: totalFixtures,
        inserted,
        updated,
        skipped,
        home_pass: homePass,
        away_pass: awayPass,
        errors,
        duration_ms: duration,
        was_limited: wasLimited,
        timed_out: timedOut,
        message: wasLimited 
          ? `Processed ${scannedFixtures}/${totalFixtures} fixtures (limited to prevent timeout). Run again to process more.`
          : timedOut
          ? `Timed out after processing ${scannedFixtures}/${totalFixtures} fixtures. Run again to continue.`
          : undefined,
      },
      origin,
      200,
      req
    );
  } catch (err) {
    console.error("[team-totals] Unhandled error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, origin, 500, req);
  }
});
