// ============================================================================
// Fetch Predictions Edge Function
// ============================================================================
// Uses shared auth helper for consistent cron/admin authentication
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { apiHeaders, API_BASE } from "../_shared/api.ts";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface RequestBody {
  window_hours?: number;
  force?: boolean;
}

serve(async (req) => {
  const origin = req.headers.get("origin");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Use shared auth helper (NO .single() on scalar RPCs, case-insensitive headers)
    const authResult = await checkCronOrAdminAuth(req, supabase, SUPABASE_SERVICE_ROLE_KEY, "[fetch-predictions]");
    
    if (!authResult.authorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }

    let body: RequestBody = {};
    try {
      if (req.method === "POST") {
        body = await req.json();
      }
    } catch (e) {
      console.warn("[fetch-predictions] Failed to parse body:", e);
    }
    
    const windowHours = body.window_hours ?? 72;
    const force = body.force ?? false;

    console.log(`[fetch-predictions] Starting: window=${windowHours}h, force=${force}`);

    // Get fixtures in the time window
    const windowEnd = Date.now() / 1000 + windowHours * 3600;
    const { data: fixtures, error: fixturesError } = await supabase
      .from("fixtures")
      .select("id, league_id")
      .gte("timestamp", Math.floor(Date.now() / 1000))
      .lte("timestamp", Math.floor(windowEnd));

    if (fixturesError) {
      console.error("[fetch-predictions] Fixtures query error:", fixturesError);
      return errorResponse("Failed to fetch fixtures", origin, 500, req);
    }

    console.log(`[fetch-predictions] Found ${fixtures.length} fixtures in window`);

    let scanned = 0;
    let fetched = 0;
    let upserted = 0;
    let skipped = 0;
    let failed = 0;

    const headers = apiHeaders();
    const cacheTTL = 12 * 3600 * 1000; // 12 hours in ms

    for (const fixture of fixtures) {
      scanned++;

      // Check cache freshness unless force=true
      if (!force) {
        const { data: cached } = await supabase
          .from("predictions_cache")
          .select("cached_at")
          .eq("fixture_id", fixture.id)
          .single();

        if (cached && Date.now() - new Date(cached.cached_at).getTime() < cacheTTL) {
          skipped++;
          continue;
        }
      }

      // Fetch from API-Football /predictions
      const url = `${API_BASE}/predictions?fixture=${fixture.id}`;
      try {
        const response = await fetch(url, { headers });
        const json = await response.json();

        if (!response.ok || json.errors?.length > 0) {
          console.warn(`[fetch-predictions] API error for fixture ${fixture.id}:`, json.errors);
          failed++;
          continue;
        }

        fetched++;

        const predictions = json.response?.[0]?.predictions;
        if (!predictions) {
          console.warn(`[fetch-predictions] No predictions for fixture ${fixture.id}`);
          failed++;
          continue;
        }

        const percent = predictions.percent;
        const homeProb = percent?.home ? parseFloat(percent.home) / 100 : null;
        const drawProb = percent?.draw ? parseFloat(percent.draw) / 100 : null;
        const awayProb = percent?.away ? parseFloat(percent.away) / 100 : null;
        const advice = predictions.advice || null;

        // Upsert into cache
        const { error: upsertError } = await supabase
          .from("predictions_cache")
          .upsert({
            fixture_id: fixture.id,
            league_id: fixture.league_id,
            home_prob: homeProb,
            draw_prob: drawProb,
            away_prob: awayProb,
            advice,
            cached_at: new Date().toISOString(),
          }, { onConflict: "fixture_id" });

        if (upsertError) {
          console.error(`[fetch-predictions] Upsert error for fixture ${fixture.id}:`, upsertError);
          failed++;
        } else {
          upserted++;
        }

        // Rate limit: 50 req/min = ~1.2s per request
        await new Promise(resolve => setTimeout(resolve, 1200));
      } catch (err) {
        console.error(`[fetch-predictions] Fetch error for fixture ${fixture.id}:`, err);
        failed++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[fetch-predictions] Complete: scanned=${scanned}, fetched=${fetched}, upserted=${upserted}, skipped=${skipped}, failed=${failed}, duration=${duration}ms`);

    return jsonResponse({
      success: true,
      scanned,
      fetched,
      upserted,
      skipped,
      failed,
      duration_ms: duration,
    }, origin, 200, req);
  } catch (err) {
    console.error("[fetch-predictions] Unhandled error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, origin, 500, req);
  }
});
