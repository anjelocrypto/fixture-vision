// Fetch final match results and upsert into fixture_results
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { API_BASE, apiHeaders } from "../_shared/api.ts";

interface RequestBody {
  window_hours?: number;
  retention_months?: number;
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

    // Authentication: X-CRON-KEY or user must be whitelisted
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    
    let isAuthorized = false;

    if (cronKeyHeader) {
      // Validate cron key
      const { data: dbKey, error: keyError } = await supabase
        .rpc("get_cron_internal_key")
        .single();
      
      if (keyError || !dbKey) {
        console.error("[results-refresh] Failed to fetch cron key:", keyError);
        return errorResponse("Invalid cron key", origin, 401, req);
      }
      
      if (cronKeyHeader === dbKey) {
        isAuthorized = true;
        console.log("[results-refresh] Authorized via X-CRON-KEY");
      }
    } else if (authHeader) {
      // Check if user is whitelisted
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "");
      userClient.auth.setSession({
        access_token: authHeader.replace("Bearer ", ""),
        refresh_token: "",
      });
      
      const { data: isWhitelisted, error: wlError } = await userClient
        .rpc("is_user_whitelisted")
        .single();
      
      if (!wlError && isWhitelisted) {
        isAuthorized = true;
        console.log("[results-refresh] Authorized via user whitelist");
      }
    }

    if (!isAuthorized) {
      return errorResponse("Unauthorized: missing or invalid X-CRON-KEY or user not whitelisted", origin, 401, req);
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

    // Fetch mode: get finished fixtures
    const startTime = Date.now();
    const windowStart = new Date(Date.now() - windowHours * 3600 * 1000);
    const lookbackLimit = new Date(Date.now() - 14 * 24 * 3600 * 1000); // 14 days max

    console.log(`[results-refresh] Fetching finished fixtures from last ${windowHours}h`);

    // Find fixtures that are finished but not yet in fixture_results
    const { data: fixtures, error: fixturesError } = await supabase
      .from("fixtures")
      .select("id, league_id, timestamp, status")
      .in("status", ["FT", "AET", "PEN"])
      .gte("timestamp", Math.floor(lookbackLimit.getTime() / 1000))
      .is("fixture_results.fixture_id", null);

    if (fixturesError) {
      console.error("[results-refresh] Error fetching fixtures:", fixturesError);
      return errorResponse(`Failed to fetch fixtures: ${fixturesError.message}`, origin, 500, req);
    }

    if (!fixtures || fixtures.length === 0) {
      console.log("[results-refresh] No new finished fixtures to process");
      return jsonResponse({ 
        success: true, 
        window_hours: windowHours,
        scanned: 0, 
        inserted: 0, 
        skipped: 0,
        errors: 0
      }, origin, 200, req);
    }

    console.log(`[results-refresh] Found ${fixtures.length} finished fixtures to process`);

    // Fetch results from API for each fixture
    const results: FixtureResultRow[] = [];
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
        
        if (!apiFixture || !apiFixture.score || !apiFixture.teams) {
          console.warn(`[results-refresh] Incomplete data for fixture ${fixture.id}`);
          skipped++;
          continue;
        }

        const goalsHome = apiFixture.goals?.home ?? apiFixture.score?.fulltime?.home ?? 0;
        const goalsAway = apiFixture.goals?.away ?? apiFixture.score?.fulltime?.away ?? 0;
        
        // Get corners and cards if available (from statistics endpoint or fixture data)
        let cornersHome: number | null = null;
        let cornersAway: number | null = null;
        let cardsHome: number | null = null;
        let cardsAway: number | null = null;

        // Try to get statistics (this might be a separate API call in production)
        if (apiFixture.statistics) {
          const homeStats = apiFixture.statistics.find((s: any) => s.team.id === apiFixture.teams.home.id);
          const awayStats = apiFixture.statistics.find((s: any) => s.team.id === apiFixture.teams.away.id);
          
          if (homeStats) {
            cornersHome = homeStats.statistics?.find((st: any) => st.type === "Corner Kicks")?.value ?? null;
            const yellowCards = homeStats.statistics?.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
            const redCards = homeStats.statistics?.find((st: any) => st.type === "Red Cards")?.value ?? 0;
            cardsHome = yellowCards + redCards;
          }
          
          if (awayStats) {
            cornersAway = awayStats.statistics?.find((st: any) => st.type === "Corner Kicks")?.value ?? null;
            const yellowCards = awayStats.statistics?.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
            const redCards = awayStats.statistics?.find((st: any) => st.type === "Red Cards")?.value ?? 0;
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
          corners_home: cornersHome,
          corners_away: cornersAway,
          cards_home: cardsHome,
          cards_away: cardsAway,
          status: apiFixture.fixture?.status?.short || "FT",
          source: "api-football",
          fetched_at: new Date().toISOString(),
        };

        results.push(result);
      } catch (err) {
        console.error(`[results-refresh] Error processing fixture ${fixture.id}:`, err);
        errors++;
      }

      // Rate limiting: small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
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

    const duration = Date.now() - startTime;

    // Log to optimizer_run_logs
    await supabase.from("optimizer_run_logs").insert({
      run_type: "results-refresh",
      window_start: windowStart.toISOString(),
      window_end: new Date().toISOString(),
      scanned: fixtures.length,
      upserted: inserted,
      skipped,
      failed: errors,
      duration_ms: duration,
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date().toISOString(),
      notes: `window_hours=${windowHours}`,
    });

    return jsonResponse({
      success: true,
      window_hours: windowHours,
      scanned: fixtures.length,
      inserted,
      skipped,
      errors,
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
