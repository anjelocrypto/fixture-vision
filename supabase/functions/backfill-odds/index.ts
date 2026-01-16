// ============================================================================
// backfill-odds: Batch-processed odds refresh for upcoming fixtures
// ============================================================================
// Redesigned 2025-11-22: Batch processing to avoid Edge function timeouts
// Deployment trigger: 2025-11-22 16:24:45 UTC
// FIX 2026-01-16: Added league prioritization - major leagues processed FIRST
//
// Processes BATCH_SIZE fixtures per invocation (default: 30 fixtures).
// Selects fixtures with missing or stale odds (>45 min old).
// Cron calls this every 30 minutes to maintain fresh odds coverage.
// 
// PRIORITY ORDER:
// 1. Major leagues (EPL, La Liga, Bundesliga, Serie A, Ligue 1, Championship)
// 2. UEFA competitions (Champions League, Europa League, Conference League)
// 3. Domestic cups (FA Cup, Copa del Rey, etc.)
// 4. Other supported leagues
// 5. Everything else (friendlies last)
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { apiHeaders, API_BASE } from "../_shared/api.ts";
import { DAILY_CALL_BUDGET, RPM_LIMIT, PREMATCH_TTL_MINUTES, UPCOMING_WINDOW_HOURS } from "../_shared/config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// Tuned to complete under 60-second Edge Function timeout
// ~30 fixtures × 1.2s per fixture (API call + processing) = ~36 seconds
const BATCH_SIZE = 30;

// Odds TTL: fixtures need odds refresh after this many minutes
const ODDS_STALE_MINUTES = 45;

// League priority tiers for odds backfill
// Priority 1: Major European leagues (most valuable for users)
const TIER_1_LEAGUES = [39, 40, 78, 140, 135, 61]; // EPL, Championship, Bundesliga, La Liga, Serie A, Ligue 1
// Priority 2: UEFA competitions
const TIER_2_LEAGUES = [2, 3, 848]; // Champions League, Europa League, Conference League
// Priority 3: Domestic cups
const TIER_3_LEAGUES = [45, 48, 66, 81, 137, 143]; // FA Cup, League Cup, Coupe de France, DFB-Pokal, Coppa Italia, Copa del Rey
// Priority 4: Other supported leagues (will be processed after tiers 1-3)

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log(`[backfill-odds] Starting batch odds backfill (batch_size=${BATCH_SIZE})`);

    // Parse window_hours from request body (default to UPCOMING_WINDOW_HOURS constant)
    const { window_hours = UPCOMING_WINDOW_HOURS } = await req.json().catch(() => ({}));

    const now = new Date();
    const startedAt = now;
    const endDate = new Date(now.getTime() + (window_hours * 60 * 60 * 1000));

    console.log(`[backfill-odds] Window: ${now.toISOString()} to ${endDate.toISOString()} (${window_hours}h)`);

    // Daily budget guard: count today's API calls
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0); // P0 FIX: Use UTC midnight for consistent daily budget tracking
    const { count: todayCallCount } = await supabaseClient
      .from("optimizer_run_logs")
      .select("*", { count: "exact", head: true })
      .gte("started_at", todayStart.toISOString())
      .like("run_type", "backfill-odds-batch%");

    const DAILY_BUDGET_LIMIT = DAILY_CALL_BUDGET;
    const MAX_RPM = RPM_LIMIT;

    if (todayCallCount && todayCallCount >= DAILY_BUDGET_LIMIT) {
      console.warn(`[backfill-odds] DAILY BUDGET EXCEEDED: ${todayCallCount}/${DAILY_BUDGET_LIMIT} calls today. Halting to protect quota.`);
      
      await supabaseClient.from("optimizer_run_logs").insert({
        id: crypto.randomUUID(),
        run_type: 'backfill-odds-batch',
        window_start: now.toISOString(),
        window_end: endDate.toISOString(),
        scope: { window_hours, batch_size: BATCH_SIZE, budget_exceeded: true },
        scanned: 0,
        with_odds: 0,
        upserted: 0,
        skipped: 0,
        failed: 0,
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      });

      return new Response(
        JSON.stringify({ 
          scanned: 0, 
          fetched: 0, 
          failed: 0, 
          budget_exceeded: true,
          daily_calls: todayCallCount,
          budget: DAILY_BUDGET_LIMIT 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[backfill-odds] Daily budget check: ${todayCallCount || 0}/${DAILY_BUDGET_LIMIT} calls used today (${MAX_RPM} RPM)`);

    // ========================================================================
    // BATCH SELECTION: Get fixtures with missing or stale odds
    // PRIORITY: Major leagues → UEFA → Cups → Other (friendlies last)
    // ========================================================================
    const nowTimestamp = Math.floor(now.getTime() / 1000);
    const endTimestamp = Math.floor(endDate.getTime() / 1000);
    const staleThreshold = new Date(Date.now() - ODDS_STALE_MINUTES * 60 * 1000).toISOString();
    
    // Get all upcoming fixtures WITH league_id for prioritization
    const { data: upcomingFixtures, error: fixturesError } = await supabaseClient
      .from("fixtures")
      .select("id, league_id")
      .gte("timestamp", nowTimestamp)
      .lte("timestamp", endTimestamp)
      .in("status", ["NS", "TBD"]);
    
    if (fixturesError) {
      console.error("[backfill-odds] Error fetching fixtures:", fixturesError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch fixtures" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }
    
    if (!upcomingFixtures || upcomingFixtures.length === 0) {
      console.log("[backfill-odds] No upcoming fixtures in window");
      
      const finishedAt = new Date();
      await supabaseClient.from("optimizer_run_logs").insert({
        id: crypto.randomUUID(),
        run_type: 'backfill-odds-batch',
        window_start: now.toISOString(),
        window_end: endDate.toISOString(),
        scope: { window_hours, batch_size: BATCH_SIZE, no_fixtures: true },
        scanned: 0,
        with_odds: 0,
        upserted: 0,
        skipped: 0,
        failed: 0,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
      });

      return new Response(
        JSON.stringify({ scanned: 0, fetched: 0, skipped: 0, failed: 0, no_fixtures: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Check which fixtures need odds refresh
    const fixtureIds = upcomingFixtures.map((f: any) => f.id);
    const { data: existingOdds } = await supabaseClient
      .from("odds_cache")
      .select("fixture_id, captured_at")
      .in("fixture_id", fixtureIds);
    
    // Build set of fixtures that need refresh (missing or stale)
    const oddsMap = new Map();
    (existingOdds || []).forEach((o: any) => {
      oddsMap.set(o.fixture_id, o.captured_at);
    });
    
    // Helper function to get league priority tier (lower = higher priority)
    const getLeaguePriority = (leagueId: number | null): number => {
      if (!leagueId) return 999; // No league = lowest priority
      if (TIER_1_LEAGUES.includes(leagueId)) return 1;
      if (TIER_2_LEAGUES.includes(leagueId)) return 2;
      if (TIER_3_LEAGUES.includes(leagueId)) return 3;
      // Skip friendlies entirely (league_id 667) - they rarely have odds
      if (leagueId === 667) return 1000;
      return 4; // Other supported leagues
    };
    
    const batchFixtures = upcomingFixtures
      .filter((f: any) => {
        const capturedAt = oddsMap.get(f.id);
        if (!capturedAt) return true; // Missing odds
        return new Date(capturedAt) < new Date(staleThreshold); // Stale odds
      })
      .sort((a: any, b: any) => {
        // PRIMARY: Sort by league priority (major leagues first)
        const aPriority = getLeaguePriority(a.league_id);
        const bPriority = getLeaguePriority(b.league_id);
        if (aPriority !== bPriority) return aPriority - bPriority;
        
        // SECONDARY: Within same priority, prefer older/missing odds
        const aDate = oddsMap.get(a.id) ? new Date(oddsMap.get(a.id)).getTime() : 0;
        const bDate = oddsMap.get(b.id) ? new Date(oddsMap.get(b.id)).getTime() : 0;
        return aDate - bDate;
      })
      .slice(0, BATCH_SIZE)
      .map((f: any) => ({ fixture_id: f.id, league_id: f.league_id }));
    
    // Log priority distribution for debugging
    const priorityDist: Record<number, number> = {};
    batchFixtures.forEach((f: any) => {
      const p = getLeaguePriority(f.league_id);
      priorityDist[p] = (priorityDist[p] || 0) + 1;
    });
    console.log(`[backfill-odds] Batch priority distribution: ${JSON.stringify(priorityDist)}`);
    console.log(`[backfill-odds] First 5 fixtures: ${batchFixtures.slice(0, 5).map((f: any) => `${f.fixture_id}(L${f.league_id})`).join(", ")}`);
    
    const batchError = null;

    if (batchError) {
      console.error("[backfill-odds] Error selecting batch:", batchError);
      return new Response(
        JSON.stringify({ error: "Failed to select fixtures batch" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    if (!batchFixtures || batchFixtures.length === 0) {
      console.log("[backfill-odds] No fixtures need odds refresh in this batch");
      
      const finishedAt = new Date();
      await supabaseClient.from("optimizer_run_logs").insert({
        id: crypto.randomUUID(),
        run_type: 'backfill-odds-batch',
        window_start: now.toISOString(),
        window_end: endDate.toISOString(),
        scope: { window_hours, batch_size: BATCH_SIZE, all_fresh: true },
        scanned: 0,
        with_odds: 0,
        upserted: 0,
        skipped: 0,
        failed: 0,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
      });

      return new Response(
        JSON.stringify({ scanned: 0, fetched: 0, skipped: 0, failed: 0, all_fresh: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[backfill-odds] Processing ${batchFixtures.length} fixtures (batch_size=${BATCH_SIZE})`);

    // ========================================================================
    // PROCESS BATCH: Fetch odds from API-Football with rate limiting
    // ========================================================================
    let scanned = 0;
    let fetched = 0;
    let failed = 0;
    let skipped = 0;

    const BASE_DELAY = Math.ceil(60000 / MAX_RPM); // e.g., 1200ms for 50 RPM
    let currentDelay = BASE_DELAY;
    const MAX_BACKOFF_DELAY = 10000;

    for (const fixture of batchFixtures) {
      const fixtureId = fixture.fixture_id;
      scanned++;
      
      try {
        // Fetch odds from API
        const url = `${API_BASE}/odds?fixture=${fixtureId}`;
        console.log(`[backfill-odds] [${scanned}/${batchFixtures.length}] Fetching odds for fixture ${fixtureId}`);

        const response = await fetch(url, {
          headers: apiHeaders(),
        });

        // Handle 429 rate limit with exponential backoff
        if (response.status === 429) {
          console.warn(`[backfill-odds] Rate limit hit (429) for fixture ${fixtureId}, backing off...`);
          currentDelay = Math.min(currentDelay * 2, MAX_BACKOFF_DELAY);
          await new Promise(resolve => setTimeout(resolve, currentDelay));
          failed++;
          continue;
        }

        if (!response.ok) {
          console.error(`[backfill-odds] API error for fixture ${fixtureId}: ${response.status}`);
          failed++;
          continue;
        }

        // Reset delay on success
        currentDelay = BASE_DELAY;

        const data = await response.json();

        if (!data.response || data.response.length === 0) {
          console.log(`[backfill-odds] No odds available for fixture ${fixtureId}`);
          skipped++;
          continue;
        }

        // Extract bookmakers array
        const bookmakers = data.response[0]?.bookmakers || [];
        
        if (bookmakers.length === 0) {
          console.log(`[backfill-odds] Empty bookmakers for fixture ${fixtureId}`);
          skipped++;
          continue;
        }

        // Upsert into odds_cache
        const { error: upsertError } = await supabaseClient
          .from("odds_cache")
          .upsert({
            fixture_id: fixtureId,
            payload: { bookmakers, available: bookmakers.length > 0 },
            captured_at: new Date().toISOString(),
            bookmakers: bookmakers.map((b: any) => b.name),
            markets: [...new Set(bookmakers.flatMap((b: any) => 
              (b.markets || []).map((m: any) => m.name)
            ))],
          }, {
            onConflict: "fixture_id",
          });

        if (upsertError) {
          console.error(`[backfill-odds] Failed to upsert odds for fixture ${fixtureId}:`, upsertError);
          failed++;
        } else {
          console.log(`[backfill-odds] ✓ Cached odds for fixture ${fixtureId} (${bookmakers.length} bookmakers)`);
          fetched++;
        }

        // Adaptive rate limit delay
        if (scanned < batchFixtures.length) {
          await new Promise(resolve => setTimeout(resolve, currentDelay));
        }

      } catch (error) {
        console.error(`[backfill-odds] Error processing fixture ${fixtureId}:`, error);
        failed++;
      }
    }

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    console.log(`[backfill-odds] Batch complete in ${durationMs}ms: scanned=${scanned}, fetched=${fetched}, skipped=${skipped}, failed=${failed}`);

    // Log run to optimizer_run_logs
    await supabaseClient.from("optimizer_run_logs").insert({
      id: crypto.randomUUID(),
      run_type: 'backfill-odds-batch',
      window_start: now.toISOString(),
      window_end: endDate.toISOString(),
      scope: { 
        window_hours, 
        batch_size: BATCH_SIZE,
        stale_minutes: ODDS_STALE_MINUTES,
        daily_calls_used: (todayCallCount || 0) + scanned
      },
      scanned,
      with_odds: fetched,
      upserted: fetched,
      skipped,
      failed,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: durationMs,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        scanned,
        fetched,
        skipped,
        failed,
        batch_size: BATCH_SIZE,
        window_hours,
        duration_ms: durationMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[backfill-odds] Internal error:", {
      message: error instanceof Error ? error.message : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
