// Fetch final match results and upsert into fixture_results
// CRITICAL FIX: Also updates fixtures.status from NS to FT for finished matches
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { API_BASE, apiHeaders } from "../_shared/api.ts";

interface RequestBody {
  window_hours?: number;
  retention_months?: number;
  backfill_mode?: boolean;
  batch_size?: number;
}

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
  fouls_home?: number;
  fouls_away?: number;
  offsides_home?: number;
  offsides_away?: number;
  status: string;
  source: string;
  fetched_at: string;
}

// Exponential backoff helper
async function fetchWithRetry(url: string, headers: Record<string, string>, maxRetries = 3): Promise<Response> {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 || res.status >= 500) {
      const delay = Math.min(1000 * Math.pow(2, i) + Math.random() * 1000, 10000);
      console.warn(`[results-refresh] Got ${res.status}, retrying in ${delay}ms (attempt ${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    return res;
  }
  throw new Error(`Failed after ${maxRetries} retries`);
}

// Fetch detailed statistics for a fixture
async function fetchFixtureStatistics(fixtureId: number): Promise<any> {
  const url = `${API_BASE}/fixtures/statistics?fixture=${fixtureId}`;
  const res = await fetchWithRetry(url, apiHeaders());
  
  if (!res.ok) {
    console.warn(`[results-refresh] API error for statistics ${fixtureId}: ${res.status}`);
    return null;
  }
  
  const json = await res.json();
  return json.response || null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", origin, 500, req);
    }

    // Create service role client (bypasses RLS for inserts)
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Standardized auth: X-CRON-KEY or whitelisted user
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    
    let isAuthorized = false;

    // Check X-CRON-KEY first
    if (cronKeyHeader) {
      const { data: dbKey, error: keyError } = await supabase
        .rpc("get_cron_internal_key")
        .single();
      
      if (!keyError && dbKey && cronKeyHeader === dbKey) {
        isAuthorized = true;
        console.log("[results-refresh] Authorized via X-CRON-KEY");
      }
    }

    // If not authorized via cron key, check Authorization header
    if (!isAuthorized && authHeader) {
      // Accept internal calls using service role bearer token
      if (authHeader === `Bearer ${serviceRoleKey}`) {
        isAuthorized = true;
        console.log("[results-refresh] Authorized via service role bearer");
      } else {
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
        if (!anonKey) {
          console.error("[results-refresh] Missing SUPABASE_ANON_KEY");
          return errorResponse("Configuration error", origin, 500, req);
        }

        const userClient = createClient(
          supabaseUrl,
          anonKey,
          { global: { headers: { Authorization: authHeader } } }
        );
        
        const { data: isWhitelisted, error: wlError } = await userClient
          .rpc("is_user_whitelisted")
          .single();
        
        if (!wlError && isWhitelisted) {
          isAuthorized = true;
          console.log("[results-refresh] Authorized via user whitelist");
        } else {
          return errorResponse("Forbidden: Admin access required", origin, 403, req);
        }
      }
    }

    if (!isAuthorized) {
      return errorResponse("Unauthorized: missing/invalid X-CRON-KEY or user not whitelisted", origin, 401, req);
    }

    // Parse request body
    const body: RequestBody = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const windowHours = body.window_hours ?? 6;
    const retentionMonths = body.retention_months;
    const isCleanup = req.headers.get("x-cleanup") === "1";

    // Handle cleanup mode
    if (isCleanup && retentionMonths) {
      console.log(`[results-refresh] Running cleanup: retention_months=${retentionMonths}`);
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);
      
      const { error: deleteError } = await supabase
        .from("fixture_results")
        .delete()
        .lt("finished_at", cutoffDate.toISOString());
      
      if (deleteError) {
        console.error("[results-refresh] Cleanup delete error:", deleteError);
        return errorResponse(`Cleanup failed: ${deleteError.message}`, origin, 500, req);
      }
      
      console.log("[results-refresh] Cleanup completed successfully");
      return jsonResponse({ success: true, mode: "cleanup", retention_months: retentionMonths }, origin, 200, req);
    }

    // AUTO-CLEANUP: Remove selections for past/finished fixtures (defensive)
    console.log("[results-refresh] Auto-cleanup: removing past/finished selections");
    const cleanupStart = Date.now();
    
    // Delete from optimized_selections where fixture is past or not NS/TBD
    const { data: pastFixtures, error: pastFixturesError } = await supabase
      .from("fixtures")
      .select("id")
      .or(`timestamp.lt.${Math.floor(Date.now() / 1000)},status.not.in.(NS,TBD)`);
    
    if (!pastFixturesError && pastFixtures && pastFixtures.length > 0) {
      const pastFixtureIds = pastFixtures.map((f: any) => f.id);
      console.log(`[results-refresh] Found ${pastFixtureIds.length} past/finished fixtures to clean`);
      
      // Delete from optimized_selections
      const { error: deleteOptError } = await supabase
        .from("optimized_selections")
        .delete()
        .in("fixture_id", pastFixtureIds);
      
      if (deleteOptError) {
        console.warn("[results-refresh] Failed to clean optimized_selections:", deleteOptError);
      }
      
      // Delete from outcome_selections
      const { error: deleteOutError } = await supabase
        .from("outcome_selections")
        .delete()
        .in("fixture_id", pastFixtureIds);
      
      if (deleteOutError) {
        console.warn("[results-refresh] Failed to clean outcome_selections:", deleteOutError);
      }
      
      console.log(`[results-refresh] Auto-cleanup completed in ${Date.now() - cleanupStart}ms`);
    } else {
      console.log("[results-refresh] No past/finished fixtures to clean");
    }

    // ============================================================================
    // CRITICAL FIX: Query by TIMESTAMP, not STATUS
    // Find fixtures where kickoff was >2 hours ago (should be finished)
    // This fixes the bug where fixtures.status never gets updated from NS to FT
    // ============================================================================
    const startTime = Date.now();
    // P0 FIX: Extended lookback from 14 to 30 days for better coverage
    const maxLookbackDays = body.backfill_mode ? 365 : 30;
    const lookbackLimit = new Date(Date.now() - maxLookbackDays * 24 * 3600 * 1000);
    
    // Fixtures that kicked off >2 hours ago should be finished
    const finishedThreshold = Math.floor((Date.now() - 2 * 3600 * 1000) / 1000);
    
    console.log(`[results-refresh] Finding fixtures that kicked off >2h ago (lookback: ${maxLookbackDays} days, backfill: ${body.backfill_mode || false})`);

    // P0 FIX: Increased batch size from 200 to 400 for faster results capture
    const batchSize = body.batch_size || (body.backfill_mode ? 100 : 400);
    
    // CRITICAL: Query by timestamp, not status - find matches that should be finished
    let fixturesQuery = supabase
      .from("fixtures")
      .select("id, league_id, timestamp, status")
      .lt("timestamp", finishedThreshold) // Kickoff was >2 hours ago
      .order("timestamp", { ascending: false })
      .limit(batchSize * 3); // Get more to account for filtering
    
    // In normal mode, filter by lookback limit
    if (!body.backfill_mode) {
      fixturesQuery = fixturesQuery.gte("timestamp", Math.floor(lookbackLimit.getTime() / 1000));
    }
    
    const { data: allFixtures, error: fixturesError } = await fixturesQuery;

    if (fixturesError) {
      console.error("[results-refresh] Error fetching fixtures:", fixturesError);
      return errorResponse(`Failed to fetch fixtures: ${fixturesError.message}`, origin, 500, req);
    }

    if (!allFixtures || allFixtures.length === 0) {
      console.log("[results-refresh] No past fixtures found in database");
      return jsonResponse({
        success: true, 
        window_hours: windowHours,
        scanned: 0, 
        inserted: 0, 
        skipped: 0,
        errors: 0,
        status_updates: 0
      }, origin, 200, req);
    }

    console.log(`[results-refresh] Found ${allFixtures.length} fixtures that kicked off >2h ago`);

    // Check which ones already have results
    const fixtureIds = allFixtures.map((f: any) => f.id);
    const { data: existingResults } = await supabase
      .from("fixture_results")
      .select("fixture_id")
      .in("fixture_id", fixtureIds);
    
    const existingIds = new Set((existingResults || []).map((r: any) => r.fixture_id));
    const fixtures = allFixtures.filter((f: any) => !existingIds.has(f.id)).slice(0, batchSize);
    
    console.log(`[results-refresh] Total past fixtures: ${allFixtures.length}, Already have results: ${existingIds.size}, Need results: ${fixtures.length}`);

    if (!fixtures || fixtures.length === 0) {
      console.log("[results-refresh] No new finished fixtures to process");
      return jsonResponse({ 
        success: true, 
        window_hours: windowHours,
        scanned: 0, 
        inserted: 0, 
        skipped: 0,
        errors: 0,
        status_updates: 0
      }, origin, 200, req);
    }

    console.log(`[results-refresh] Processing ${fixtures.length} fixtures without results`);

    // Fetch results from API for each fixture
    const results: FixtureResultRow[] = [];
    const statusUpdates: { id: number; status: string }[] = [];
    let inserted = 0;
    let skipped = 0;
    let errors = 0;

    for (const fixture of fixtures) {
      try {
        const url = `${API_BASE}/fixtures?id=${fixture.id}`;
        const res = await fetchWithRetry(url, apiHeaders());
        
        if (!res.ok) {
          console.warn(`[results-refresh] API error for fixture ${fixture.id}: ${res.status}`);
          errors++;
          continue;
        }

        const json = await res.json();
        const apiFixture = json.response?.[0];
        
        if (!apiFixture || !apiFixture.teams) {
          console.warn(`[results-refresh] Incomplete data for fixture ${fixture.id}`);
          skipped++;
          continue;
        }

        // Get API status
        const apiStatus = apiFixture.fixture?.status?.short || "NS";
        
        // Check if the match is actually finished
        const isFinished = ["FT", "AET", "PEN", "AWD", "WO"].includes(apiStatus);
        
        if (!isFinished) {
          // Match not finished yet - update local status if different but don't fetch results
          if (fixture.status !== apiStatus) {
            console.log(`[results-refresh] Fixture ${fixture.id}: API status=${apiStatus}, updating from ${fixture.status}`);
            statusUpdates.push({ id: fixture.id, status: apiStatus });
          }
          skipped++;
          continue;
        }

        // ============================================================================
        // CRITICAL: Update fixtures.status to FT (or actual status)
        // This is the fix for the root cause bug
        // ============================================================================
        if (fixture.status !== apiStatus) {
          console.log(`[results-refresh] Fixture ${fixture.id}: Updating status from ${fixture.status} to ${apiStatus}`);
          statusUpdates.push({ id: fixture.id, status: apiStatus });
        }

        const goalsHome = apiFixture.goals?.home ?? apiFixture.score?.fulltime?.home ?? 0;
        const goalsAway = apiFixture.goals?.away ?? apiFixture.score?.fulltime?.away ?? 0;
        
        // Fetch detailed statistics separately (CRITICAL: /fixtures endpoint doesn't include stats)
        let cornersHome: number | null = null;
        let cornersAway: number | null = null;
        let cardsHome: number | null = null;
        let cardsAway: number | null = null;
        let foulsHome: number | null = null;
        let foulsAway: number | null = null;
        let offsidesHome: number | null = null;
        let offsidesAway: number | null = null;

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
            cardsHome = (yellowCards || 0) + (redCards || 0);
            
            const foulsStat = homeStats.statistics.find((st: any) => st.type === "Fouls");
            foulsHome = foulsStat?.value ?? null;
            
            const offsidesStat = homeStats.statistics.find((st: any) => st.type === "Offsides");
            offsidesHome = offsidesStat?.value ?? null;
          }
          
          if (awayStats?.statistics) {
            const cornersStat = awayStats.statistics.find((st: any) => 
              st.type === "Corner Kicks" || st.type === "Corners"
            );
            cornersAway = cornersStat?.value ?? null;
            
            const yellowCards = awayStats.statistics.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
            const redCards = awayStats.statistics.find((st: any) => st.type === "Red Cards")?.value ?? 0;
            cardsAway = (yellowCards || 0) + (redCards || 0);
            
            const foulsStat = awayStats.statistics.find((st: any) => st.type === "Fouls");
            foulsAway = foulsStat?.value ?? null;
            
            const offsidesStat = awayStats.statistics.find((st: any) => st.type === "Offsides");
            offsidesAway = offsidesStat?.value ?? null;
          }
        }
        
        console.log(`[results-refresh] Fixture ${fixture.id}: goals=${goalsHome}-${goalsAway}, corners=${cornersHome ?? 'null'}-${cornersAway ?? 'null'}, cards=${cardsHome ?? 'null'}-${cardsAway ?? 'null'}`);

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
          fouls_home: foulsHome ?? undefined,
          fouls_away: foulsAway ?? undefined,
          offsides_home: offsidesHome ?? undefined,
          offsides_away: offsidesAway ?? undefined,
          status: apiStatus,
          source: "api-football",
          fetched_at: new Date().toISOString(),
        };

        results.push(result);
      } catch (err) {
        console.error(`[results-refresh] Error processing fixture ${fixture.id}:`, err);
        errors++;
      }

      // Rate limiting: longer delay in backfill mode to respect API limits
      const delayMs = body.backfill_mode ? 1200 : 100; // ~50 RPM for backfill
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    // Batch upsert results
    if (results.length > 0) {
      const { error: upsertError } = await supabase
        .from("fixture_results")
        .upsert(results, { onConflict: "fixture_id" });

      if (upsertError) {
        console.error("[results-refresh] Upsert error:", upsertError);
        return errorResponse(`Failed to upsert results: ${upsertError.message}`, origin, 500, req);
      }

      inserted = results.length;
      console.log(`[results-refresh] Successfully upserted ${inserted} results`);
    }

    // ============================================================================
    // CRITICAL: Update fixtures.status for all processed fixtures
    // ============================================================================
    let statusUpdateCount = 0;
    if (statusUpdates.length > 0) {
      console.log(`[results-refresh] Updating status for ${statusUpdates.length} fixtures`);
      
      for (const update of statusUpdates) {
        const { error: updateError } = await supabase
          .from("fixtures")
          .update({ status: update.status })
          .eq("id", update.id);
        
        if (updateError) {
          console.warn(`[results-refresh] Failed to update status for fixture ${update.id}:`, updateError);
        } else {
          statusUpdateCount++;
        }
      }
      
      console.log(`[results-refresh] Successfully updated ${statusUpdateCount} fixture statuses`);
    }

    const duration = Date.now() - startTime;

    // Log to optimizer_run_logs
    await supabase.from("optimizer_run_logs").insert({
      run_type: body.backfill_mode ? "backfill-fixture-results" : "results-refresh",
      window_start: lookbackLimit.toISOString(),
      window_end: new Date().toISOString(),
      scanned: fixtures.length,
      upserted: inserted,
      skipped,
      failed: errors,
      duration_ms: duration,
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date().toISOString(),
      notes: `batch_size=${batchSize}, status_updates=${statusUpdateCount}${body.backfill_mode ? ', backfill_mode=true' : ''}`,
    });

    return jsonResponse({
      success: true,
      window_hours: windowHours,
      scanned: fixtures.length,
      inserted,
      skipped,
      errors,
      status_updates: statusUpdateCount,
      duration_ms: duration,
    }, origin, 200, req);

  } catch (error) {
    console.error("[results-refresh] Unexpected error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Internal server error",
      origin,
      500,
      req
    );
  }
});