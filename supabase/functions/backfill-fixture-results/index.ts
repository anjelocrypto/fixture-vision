// Backfill historical fixture_results for last 12 months
// STRATEGY: Fetch FT fixtures directly from API-Football, not from fixtures table
// Deployed: 2025-11-23 (v2 - direct API fetch)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { API_BASE, apiHeaders } from "../_shared/api.ts";

interface FixtureResultRow {
  fixture_id: number;
  league_id: number;
  kickoff_at: string;
  finished_at: string;
  goals_home: number;
  goals_away: number;
  corners_home?: number;
  corners_away?: number;
  cards_home?: number;
  cards_away?: number;
  status: string;
  source: string;
  fetched_at: string;
}

async function fetchWithRetry(url: string, headers: Record<string, string>, maxRetries = 3): Promise<Response> {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 || res.status >= 500) {
      const delay = Math.min(1000 * Math.pow(2, i) + Math.random() * 1000, 10000);
      console.warn(`[backfill-fixture-results] Got ${res.status}, retrying in ${delay}ms (attempt ${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    return res;
  }
  throw new Error(`Failed after ${maxRetries} retries`);
}

async function fetchFixtureStatistics(fixtureId: number): Promise<any> {
  const url = `${API_BASE}/fixtures/statistics?fixture=${fixtureId}`;
  const res = await fetchWithRetry(url, apiHeaders());
  
  if (!res.ok) {
    console.warn(`[backfill-fixture-results] API error for statistics ${fixtureId}: ${res.status}`);
    return null;
  }
  
  const json = await res.json();
  return json.response || null;
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
      return errorResponse("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Auth check
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    
    let isAuthorized = false;

    if (!cronKeyHeader && !authHeader) {
      isAuthorized = true;
      console.log("[backfill-fixture-results] Authorized via no-auth (admin UI)");
    }

    if (!isAuthorized && cronKeyHeader) {
      const { data: dbKey } = await supabase.rpc("get_cron_internal_key").single();
      if (dbKey && cronKeyHeader === dbKey) {
        isAuthorized = true;
        console.log("[backfill-fixture-results] Authorized via X-CRON-KEY");
      }
    }

    if (!isAuthorized && authHeader) {
      if (authHeader === `Bearer ${serviceRoleKey}`) {
        isAuthorized = true;
        console.log("[backfill-fixture-results] Authorized via service role");
      } else {
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
        const userClient = createClient(supabaseUrl, anonKey!, {
          global: { headers: { Authorization: authHeader } }
        });
        
        const { data: isWhitelisted } = await userClient.rpc("is_user_whitelisted").single();
        if (isWhitelisted) {
          isAuthorized = true;
          console.log("[backfill-fixture-results] Authorized via admin user");
        }
      }
    }

    if (!isAuthorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const batchSize = body.batch_size || 50;
    const monthsBack = body.months_back || 12;
    const leagueId = body.league_id; // Optional: target specific league

    const startTime = Date.now();
    const lookbackDate = new Date();
    lookbackDate.setMonth(lookbackDate.getMonth() - monthsBack);

    console.log(`[backfill-fixture-results] Starting backfill for last ${monthsBack} months (batch size: ${batchSize})`);
    console.log(`[backfill-fixture-results] Lookback date: ${lookbackDate.toISOString()}`);
    if (leagueId) {
      console.log(`[backfill-fixture-results] Targeting league_id: ${leagueId}`);
    }

    // STRATEGY: Fetch historical FT fixtures directly from API-Football by season
    const currentYear = new Date().getFullYear();
    const seasons = [currentYear, currentYear - 1]; // Current and previous season
    
    console.log(`[backfill-fixture-results] Fetching FT fixtures for seasons: ${seasons.join(', ')}`);

    // Get leagues with their seasons
    const { data: leagues, error: leaguesError } = await supabase
      .from("leagues")
      .select("id, season");
    
    if (leaguesError || !leagues) {
      return errorResponse(`Failed to fetch leagues: ${leaguesError?.message}`, origin, 500, req);
    }

    const targetLeagues = leagueId 
      ? leagues.filter(l => l.id === leagueId)
      : leagues.slice(0, 30); // Limit to first 30 leagues
    
    console.log(`[backfill-fixture-results] Targeting ${targetLeagues.length} leagues`);

    let allApiFixtures: any[] = [];
    let apiCallCount = 0;

    // Fetch finished fixtures from API for each league/season combo
    for (const league of targetLeagues) {
      for (const season of seasons) {
        try {
          // Use season-based query which is more reliable
          const apiUrl = `${API_BASE}/fixtures?league=${league.id}&season=${season}&status=FT&last=50`;
          console.log(`[backfill-fixture-results] API call ${apiCallCount + 1}: league ${league.id}, season ${season}...`);
          
          const res = await fetchWithRetry(apiUrl, apiHeaders());
          apiCallCount++;
          
          if (!res.ok) {
            console.warn(`[backfill-fixture-results] API error for league ${league.id} season ${season}: ${res.status}`);
            continue;
          }

          const json = await res.json();
          const fixtures = json.response || [];
          console.log(`[backfill-fixture-results] League ${league.id} season ${season}: got ${fixtures.length} FT fixtures`);
          
          if (fixtures.length > 0) {
            // Filter to last 12 months only
            const twelveMonthsAgo = lookbackDate.getTime();
            const recentFixtures = fixtures.filter((f: any) => {
              const fixtureDate = new Date(f.fixture.date).getTime();
              return fixtureDate >= twelveMonthsAgo;
            });
            
            console.log(`[backfill-fixture-results] After 12-month filter: ${recentFixtures.length} fixtures`);
            allApiFixtures.push(...recentFixtures);
          }

          // Rate limiting: 1300ms between requests = ~46 RPM
          await new Promise(resolve => setTimeout(resolve, 1300));
        } catch (err) {
          console.error(`[backfill-fixture-results] Error fetching league ${league.id} season ${season}:`, err);
        }

        if (allApiFixtures.length >= batchSize * 3) {
          console.log(`[backfill-fixture-results] Collected ${allApiFixtures.length} fixtures, stopping API fetch`);
          break;
        }
      }
      
      if (allApiFixtures.length >= batchSize * 3) break;
    }

    console.log(`[backfill-fixture-results] Total fixtures from API: ${allApiFixtures.length} (${apiCallCount} API calls)`);

    if (allApiFixtures.length === 0) {
      console.log("[backfill-fixture-results] No fixtures found from API");
      return jsonResponse({
        success: true,
        scanned: 0,
        inserted: 0,
        skipped: 0,
        errors: 0,
        api_calls: apiCallCount
      }, origin, 200, req);
    }

    // Check which already have results
    const apiFixtureIds = allApiFixtures.map(f => f.fixture.id);
    const { data: existingResults } = await supabase
      .from("fixture_results")
      .select("fixture_id")
      .in("fixture_id", apiFixtureIds);

    const existingIds = new Set(existingResults?.map((r: any) => r.fixture_id) || []);
    const fixtures = allApiFixtures.filter(f => !existingIds.has(f.fixture.id)).slice(0, batchSize);

    console.log(`[backfill-fixture-results] Already have results: ${existingIds.size}, Need processing: ${fixtures.length}`);

    if (fixtures.length === 0) {
      return jsonResponse({
        success: true,
        scanned: allApiFixtures.length,
        inserted: 0,
        skipped: existingIds.size,
        errors: 0,
        api_calls: apiCallCount
      }, origin, 200, req);
    }

    const results: FixtureResultRow[] = [];
    const fixturesForUpsert: any[] = [];
    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    console.log(`[backfill-fixture-results] Processing ${fixtures.length} fixtures...`);

    for (const apiFixture of fixtures) {
      try {
        const fixtureId = apiFixture.fixture.id;
        const leagueId = apiFixture.league.id;
        const timestamp = apiFixture.fixture.timestamp;
        
        console.log(`[backfill-fixture-results] Processing fixture ${fixtureId}...`);
        
        // Upsert into fixtures table
        fixturesForUpsert.push({
          id: fixtureId,
          league_id: leagueId,
          date: new Date(timestamp * 1000).toISOString().split('T')[0],
          timestamp: timestamp,
          teams_home: apiFixture.teams.home,
          teams_away: apiFixture.teams.away,
          status: apiFixture.fixture.status.short,
        });
        
        const goalsHome = apiFixture.goals?.home ?? apiFixture.score?.fulltime?.home ?? 0;
        const goalsAway = apiFixture.goals?.away ?? apiFixture.score?.fulltime?.away ?? 0;
        
        // Fetch detailed statistics
        let cornersHome: number | null = null;
        let cornersAway: number | null = null;
        let cardsHome: number | null = null;
        let cardsAway: number | null = null;

        const statsData = await fetchFixtureStatistics(fixtureId);
        
        if (statsData && Array.isArray(statsData) && statsData.length === 2) {
          const homeStats = statsData.find((s: any) => s.team?.id === apiFixture.teams?.home?.id);
          const awayStats = statsData.find((s: any) => s.team?.id === apiFixture.teams?.away?.id);
          
          if (homeStats?.statistics) {
            const cornersStat = homeStats.statistics.find((st: any) => 
              st.type === "Corner Kicks" || st.type === "Corners"
            );
            cornersHome = cornersStat?.value ?? null;
            
            const yellowCards = homeStats.statistics.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
            const redCards = homeStats.statistics.find((st: any) => st.type === "Red Cards")?.value ?? 0;
            cardsHome = yellowCards + redCards;
          }
          
          if (awayStats?.statistics) {
            const cornersStat = awayStats.statistics.find((st: any) => 
              st.type === "Corner Kicks" || st.type === "Corners"
            );
            cornersAway = cornersStat?.value ?? null;
            
            const yellowCards = awayStats.statistics.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
            const redCards = awayStats.statistics.find((st: any) => st.type === "Red Cards")?.value ?? 0;
            cardsAway = yellowCards + redCards;
          }
        }

        const result: FixtureResultRow = {
          fixture_id: fixtureId,
          league_id: leagueId,
          kickoff_at: new Date(timestamp * 1000).toISOString(),
          finished_at: new Date().toISOString(),
          goals_home: goalsHome,
          goals_away: goalsAway,
          corners_home: cornersHome ?? undefined,
          corners_away: cornersAway ?? undefined,
          cards_home: cardsHome ?? undefined,
          cards_away: cardsAway ?? undefined,
          status: apiFixture.fixture.status.short,
          source: "api-football",
          fetched_at: new Date().toISOString(),
        };

        results.push(result);
        console.log(`[backfill-fixture-results] ✓ Fixture ${fixtureId}: goals=${goalsHome}-${goalsAway}, corners=${cornersHome ?? 'null'}-${cornersAway ?? 'null'}, cards=${cardsHome ?? 'null'}-${cardsAway ?? 'null'}`);

        // Rate limiting: 1200ms between fixture stats requests
        await new Promise(resolve => setTimeout(resolve, 1200));
      } catch (err) {
        console.error(`[backfill-fixture-results] Error processing fixture:`, err);
        errors++;
      }
    }

    // Upsert fixtures first
    if (fixturesForUpsert.length > 0) {
      console.log(`[backfill-fixture-results] Upserting ${fixturesForUpsert.length} fixtures...`);
      const { error: fixturesUpsertError } = await supabase
        .from("fixtures")
        .upsert(fixturesForUpsert, { onConflict: "id" });

      if (fixturesUpsertError) {
        console.error("[backfill-fixture-results] Fixtures upsert error:", fixturesUpsertError);
      } else {
        console.log(`[backfill-fixture-results] ✓ Upserted ${fixturesForUpsert.length} fixtures`);
      }
    }

    // Upsert results
    if (results.length > 0) {
      const { error: upsertError } = await supabase
        .from("fixture_results")
        .upsert(results, { onConflict: "fixture_id" });

      if (upsertError) {
        console.error("[backfill-fixture-results] Results upsert error:", upsertError);
        return errorResponse(`Failed to upsert results: ${upsertError.message}`, origin, 500, req);
      }

      inserted = results.length;
      console.log(`[backfill-fixture-results] ✓ Upserted ${inserted} results`);
    }

    const duration = Date.now() - startTime;

    // Log run
    await supabase.from("optimizer_run_logs").insert({
      run_type: "backfill-fixture-results",
      window_start: lookbackDate.toISOString(),
      window_end: new Date().toISOString(),
      scanned: allApiFixtures.length,
      upserted: inserted,
      skipped,
      failed: errors,
      duration_ms: duration,
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date().toISOString(),
      notes: `batch_size=${batchSize}, months_back=${monthsBack}, api_calls=${apiCallCount}`,
    });

    return jsonResponse({
      success: true,
      scanned: allApiFixtures.length,
      needed_results: fixtures.length,
      inserted,
      skipped,
      errors,
      duration_ms: duration,
      api_calls: apiCallCount,
      batch_size: batchSize,
      months_back: monthsBack,
    }, origin, 200, req);

  } catch (error) {
    console.error("[backfill-fixture-results] Unexpected error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Internal server error",
      origin,
      500,
      req
    );
  }
});
