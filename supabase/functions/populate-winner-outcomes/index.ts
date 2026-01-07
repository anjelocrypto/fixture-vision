// ============================================================================
// Populate Winner Outcomes Edge Function
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
  batch_size?: number;
  offset?: number;
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
    const authResult = await checkCronOrAdminAuth(req, supabase, SUPABASE_SERVICE_ROLE_KEY, "[populate-winner-outcomes]");
    
    if (!authResult.authorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }

    let body: RequestBody = {};
    try {
      if (req.method === "POST") {
        body = await req.json();
      }
    } catch (e) {
      console.warn("[populate-winner-outcomes] Failed to parse body:", e);
    }
    
    const windowHours = body.window_hours ?? 72;
    const batchSize = body.batch_size ?? 50; // Process max 50 fixtures per call
    const offset = body.offset ?? 0;

    console.log(`[populate-winner-outcomes] Starting: window=${windowHours}h, batch=${batchSize}, offset=${offset}`);

    // Get fixtures with predictions (with pagination)
    const windowEnd = Date.now() / 1000 + windowHours * 3600;
    
    // First get total count
    const { count: totalCount } = await supabase
      .from("fixtures")
      .select("id", { count: "exact", head: true })
      .gte("timestamp", Math.floor(Date.now() / 1000))
      .lte("timestamp", Math.floor(windowEnd));

    const { data: fixtures, error: fixturesError } = await supabase
      .from("fixtures")
      .select(`
        id,
        league_id,
        timestamp,
        predictions_cache!inner(home_prob, away_prob)
      `)
      .gte("timestamp", Math.floor(Date.now() / 1000))
      .lte("timestamp", Math.floor(windowEnd))
      .order("timestamp", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (fixturesError) {
      console.error("[populate-winner-outcomes] Fixtures query error:", fixturesError);
      return errorResponse("Failed to fetch fixtures", origin, 500, req);
    }

    const hasMore = (offset + batchSize) < (totalCount || 0);
    console.log(`[populate-winner-outcomes] Found ${fixtures.length} fixtures in batch (total: ${totalCount}, hasMore: ${hasMore})`);

    let scanned = 0;
    let withOdds = 0;
    let upserted = 0;
    let skipped = 0;
    let failed = 0;

    const headers = apiHeaders();

    for (const fixture of fixtures) {
      scanned++;

      // Fetch 1X2 odds (Bet ID 1)
      const url = `${API_BASE}/odds?fixture=${fixture.id}&bet=1`;
      try {
        const response = await fetch(url, { headers });
        const json = await response.json();

        if (!response.ok || json.errors?.length > 0) {
          console.warn(`[populate-winner-outcomes] API error for fixture ${fixture.id}:`, json.errors);
          failed++;
          continue;
        }

        const bookmakers = json.response?.[0]?.bookmakers || [];
        if (bookmakers.length === 0) {
          skipped++;
          continue;
        }

        withOdds++;

        const utcKickoff = new Date(fixture.timestamp * 1000).toISOString();
        const predictions = (fixture as any).predictions_cache;
        const homeProb = predictions.home_prob;
        const awayProb = predictions.away_prob;

        const rows: any[] = [];

        for (const bookmaker of bookmakers) {
          const bookmakerName = bookmaker.name || "unknown";
          const bets = bookmaker.bets || [];
          const bet1x2 = bets.find((b: any) => b.name === "Match Winner");
          if (!bet1x2) continue;

          const values = bet1x2.values || [];
          const homeOdds = values.find((v: any) => v.value === "Home")?.odd;
          const awayOdds = values.find((v: any) => v.value === "Away")?.odd;

          if (homeOdds && homeProb !== null) {
            const oddsNum = parseFloat(homeOdds);
            const edgePct = homeProb - (1 / oddsNum);
            rows.push({
              fixture_id: fixture.id,
              league_id: fixture.league_id,
              market_type: "1x2",
              outcome: "home",
              bookmaker: bookmakerName,
              odds: oddsNum,
              model_prob: homeProb,
              edge_pct: edgePct,
              utc_kickoff: utcKickoff,
            });
          }

          if (awayOdds && awayProb !== null) {
            const oddsNum = parseFloat(awayOdds);
            const edgePct = awayProb - (1 / oddsNum);
            rows.push({
              fixture_id: fixture.id,
              league_id: fixture.league_id,
              market_type: "1x2",
              outcome: "away",
              bookmaker: bookmakerName,
              odds: oddsNum,
              model_prob: awayProb,
              edge_pct: edgePct,
              utc_kickoff: utcKickoff,
            });
          }
        }

        if (rows.length > 0) {
          const { error: upsertError } = await supabase
            .from("outcome_selections")
            .upsert(rows, { onConflict: "fixture_id,market_type,outcome,bookmaker" });

          if (upsertError) {
            console.error(`[populate-winner-outcomes] Upsert error for fixture ${fixture.id}:`, upsertError);
            failed++;
          } else {
            upserted += rows.length;
          }
        }

        // Rate limit: 50 req/min = ~1.2s per request
        await new Promise(resolve => setTimeout(resolve, 1200));
      } catch (err) {
        console.error(`[populate-winner-outcomes] Fetch error for fixture ${fixture.id}:`, err);
        failed++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[populate-winner-outcomes] Complete: scanned=${scanned}, withOdds=${withOdds}, upserted=${upserted}, skipped=${skipped}, failed=${failed}, duration=${duration}ms`);

    return jsonResponse({
      success: true,
      scanned,
      withOdds,
      upserted,
      skipped,
      failed,
      duration_ms: duration,
      total_fixtures: totalCount || 0,
      has_more: hasMore,
      next_offset: hasMore ? offset + batchSize : null,
    }, origin, 200, req);
  } catch (err) {
    console.error("[populate-winner-outcomes] Unhandled error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, origin, 500, req);
  }
});
