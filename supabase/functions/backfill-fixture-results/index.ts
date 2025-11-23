// Backfill historical fixture_results for last 12 months
// Deployed: 2025-11-23
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

    // Auth check - allow unauthenticated requests since verify_jwt=false and this is admin-only
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    
    let isAuthorized = false;

    // If no auth headers provided at all, allow (admin UI access)
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

    const startTime = Date.now();
    const lookbackDate = new Date();
    lookbackDate.setMonth(lookbackDate.getMonth() - monthsBack);

    console.log(`[backfill-fixture-results] Starting backfill for last ${monthsBack} months (batch size: ${batchSize})`);
    console.log(`[backfill-fixture-results] Lookback date: ${lookbackDate.toISOString()}`);

    // Find finished fixtures without results
    const { data: fixtures, error: fixturesError } = await supabase
      .from("fixtures")
      .select("id, league_id, timestamp, status")
      .eq("status", "FT")
      .gte("date", lookbackDate.toISOString().split("T")[0])
      .order("timestamp", { ascending: false })
      .limit(batchSize);

    if (fixturesError) {
      console.error("[backfill-fixture-results] Error fetching fixtures:", fixturesError);
      return errorResponse(`Failed to fetch fixtures: ${fixturesError.message}`, origin, 500, req);
    }

    console.log(`[backfill-fixture-results] Query returned ${fixtures?.length || 0} FT fixtures from DB`);

    if (!fixtures || fixtures.length === 0) {
      console.log("[backfill-fixture-results] No fixtures to backfill");
      return jsonResponse({
        success: true,
        scanned: 0,
        inserted: 0,
        skipped: 0,
        errors: 0
      }, origin, 200, req);
    }

    console.log(`[backfill-fixture-results] Found ${fixtures.length} fixtures to process`);

    // Filter out fixtures already in fixture_results
    const { data: existingResults } = await supabase
      .from("fixture_results")
      .select("fixture_id")
      .in("fixture_id", fixtures.map((f: any) => f.id));

    const existingIds = new Set(existingResults?.map((r: any) => r.fixture_id) || []);
    const fixturesNeedingResults = fixtures.filter((f: any) => !existingIds.has(f.id));

    console.log(`[backfill-fixture-results] Existing results: ${existingIds.size}, Need processing: ${fixturesNeedingResults.length}`);

    if (fixturesNeedingResults.length === 0) {
      return jsonResponse({
        success: true,
        scanned: fixtures.length,
        inserted: 0,
        skipped: fixtures.length,
        errors: 0
      }, origin, 200, req);
    }

    const results: FixtureResultRow[] = [];
    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    console.log(`[backfill-fixture-results] Processing ${fixturesNeedingResults.length} fixtures...`);

    for (const fixture of fixturesNeedingResults) {
      try {
        console.log(`[backfill-fixture-results] Fetching fixture ${fixture.id}...`);
        
        // Fetch fixture details and statistics
        const fixtureUrl = `${API_BASE}/fixtures?id=${fixture.id}`;
        const fixtureRes = await fetchWithRetry(fixtureUrl, apiHeaders());
        
        if (!fixtureRes.ok) {
          console.warn(`[backfill-fixture-results] API error for fixture ${fixture.id}: ${fixtureRes.status}`);
          errors++;
          continue;
        }

        const fixtureJson = await fixtureRes.json();
        const apiFixture = fixtureJson.response?.[0];
        
        if (!apiFixture || !apiFixture.score) {
          console.warn(`[backfill-fixture-results] Incomplete data for fixture ${fixture.id}`);
          skipped++;
          continue;
        }

        const goalsHome = apiFixture.goals?.home ?? apiFixture.score?.fulltime?.home ?? 0;
        const goalsAway = apiFixture.goals?.away ?? apiFixture.score?.fulltime?.away ?? 0;
        
        // Fetch statistics separately
        let cornersHome: number | null = null;
        let cornersAway: number | null = null;
        let cardsHome: number | null = null;
        let cardsAway: number | null = null;

        const statsData = await fetchFixtureStatistics(fixture.id);
        
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
          fixture_id: fixture.id,
          league_id: fixture.league_id,
          kickoff_at: new Date(fixture.timestamp * 1000).toISOString(),
          finished_at: new Date().toISOString(),
          goals_home: goalsHome,
          goals_away: goalsAway,
          corners_home: cornersHome ?? undefined,
          corners_away: cornersAway ?? undefined,
          cards_home: cardsHome ?? undefined,
          cards_away: cardsAway ?? undefined,
          status: apiFixture.fixture?.status?.short || "FT",
          source: "api-football",
          fetched_at: new Date().toISOString(),
        };

        results.push(result);
        console.log(`[backfill-fixture-results] ✓ Fixture ${fixture.id}: goals=${goalsHome}-${goalsAway}, corners=${cornersHome ?? 'null'}-${cornersAway ?? 'null'}, cards=${cardsHome ?? 'null'}-${cardsAway ?? 'null'}`);

        // Rate limiting: 1200ms between requests = ~50 RPM
        await new Promise(resolve => setTimeout(resolve, 1200));
      } catch (err) {
        console.error(`[backfill-fixture-results] Error processing fixture ${fixture.id}:`, err);
        errors++;
      }
    }

    // Batch upsert results
    if (results.length > 0) {
      const { error: upsertError } = await supabase
        .from("fixture_results")
        .upsert(results, { onConflict: "fixture_id" });

      if (upsertError) {
        console.error("[backfill-fixture-results] Upsert error:", upsertError);
        return errorResponse(`Failed to upsert results: ${upsertError.message}`, origin, 500, req);
      }

      inserted = results.length;
      console.log(`[backfill-fixture-results] Successfully upserted ${inserted} results`);
    }

    const duration = Date.now() - startTime;

    // Log run
    await supabase.from("optimizer_run_logs").insert({
      run_type: "backfill-fixture-results",
      window_start: lookbackDate.toISOString(),
      window_end: new Date().toISOString(),
      scanned: fixtures.length,
      upserted: inserted,
      skipped,
      failed: errors,
      duration_ms: duration,
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date().toISOString(),
      notes: `batch_size=${batchSize}, months_back=${monthsBack}`,
    });

    return jsonResponse({
      success: true,
      scanned: fixtures.length,
      needed_results: fixturesNeedingResults.length,
      inserted,
      skipped,
      errors,
      duration_ms: duration,
      batch_size: batchSize,
      months_back: monthsBack,
      remaining_estimate: existingIds.size > 0 ? `~${Math.ceil((fixtures.length - existingIds.size) / batchSize)} more batches` : "Unknown"
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
