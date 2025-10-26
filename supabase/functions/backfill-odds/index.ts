import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiHeaders, API_BASE } from "../_shared/api.ts";
import { DAILY_CALL_BUDGET, RPM_LIMIT, PREMATCH_TTL_MINUTES } from "../_shared/config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // No JWT verification - this function is called internally by warmup-odds (admin-gated)
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log(`[backfill-odds] Starting bulk odds backfill (internal call)`);

    // Parse window_hours from request body (default 48h)
    const { window_hours = 48 } = await req.json().catch(() => ({}));

    // Overlap guard: check if another backfill is currently running for this window
    const runKey = `backfill-odds-${window_hours}h`;
    const { data: recentRuns } = await supabaseClient
      .from("optimizer_run_logs")
      .select("id, started_at, finished_at")
      .eq("run_type", runKey)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentRuns && !recentRuns.finished_at) {
      const runningForMs = Date.now() - new Date(recentRuns.started_at).getTime();
      if (runningForMs < 300000) { // 5 min max runtime before we consider it stale
        console.log(`[backfill-odds] Another ${runKey} run is in progress (started ${Math.floor(runningForMs/1000)}s ago), skipping`);
        return new Response(
          JSON.stringify({ skipped: true, reason: "concurrent_run_in_progress" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    
    // Get window (default 48h, can be 6h or 1h from cron)
    const now = new Date();
    const startedAt = now;
    const nowTimestamp = Math.floor(now.getTime() / 1000);
    const endDate = new Date(now.getTime() + (window_hours * 60 * 60 * 1000));
    const endTimestamp = Math.floor(endDate.getTime() / 1000);

    console.log(`[backfill-odds] Window: ${now.toISOString()} to ${endDate.toISOString()} (${window_hours}h)`);

    // Fetch upcoming fixtures
    const { data: fixtures, error: fixturesError } = await supabaseClient
      .from("fixtures")
      .select("id, status")
      .gte("timestamp", nowTimestamp)
      .lte("timestamp", endTimestamp);

    if (fixturesError) {
      console.error("[backfill-odds] Error fetching fixtures:", fixturesError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch fixtures" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    if (!fixtures || fixtures.length === 0) {
      console.log("[backfill-odds] No upcoming fixtures in window");
      return new Response(
        JSON.stringify({ scanned: 0, fetched: 0, failed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[backfill-odds] Found ${fixtures.length} upcoming fixtures`);

    let scanned = 0;
    let fetched = 0;
    let failed = 0;
    let skipped = 0;

    // ULTRA plan: RPM limit and daily budget from config
    const MAX_RPM = RPM_LIMIT;
    const BASE_DELAY = Math.ceil(60000 / MAX_RPM);
    let currentDelay = BASE_DELAY;
    const MAX_BACKOFF_DELAY = 10000;
    const DAILY_BUDGET_LIMIT = DAILY_CALL_BUDGET;
    const PREMATCH_TTL_MIN = PREMATCH_TTL_MINUTES;

    // Daily budget guard: count today's backfill calls
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count: todayCallCount } = await supabaseClient
      .from("optimizer_run_logs")
      .select("*", { count: "exact", head: true })
      .gte("started_at", todayStart.toISOString())
      .like("run_type", "backfill-odds-%");

    if (todayCallCount && todayCallCount >= DAILY_BUDGET_LIMIT) {
      console.warn(`[backfill-odds] DAILY BUDGET EXCEEDED: ${todayCallCount}/${DAILY_BUDGET_LIMIT} calls today. Halting to protect quota.`);
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

    console.log(`[backfill-odds] Daily budget check: ${todayCallCount || 0}/${DAILY_BUDGET_LIMIT} calls used today (${MAX_RPM} RPM, ${PREMATCH_TTL_MIN}min TTL)`);

    for (const fixture of fixtures) {
      scanned++;
      
      try {
        // Check if we already have recent odds (within TTL window)
        const { data: existingOdds } = await supabaseClient
          .from("odds_cache")
          .select("captured_at")
          .eq("fixture_id", fixture.id)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingOdds) {
          const capturedAt = new Date(existingOdds.captured_at);
          const ttlAgo = new Date(Date.now() - PREMATCH_TTL_MIN * 60 * 1000);
          if (capturedAt > ttlAgo) {
            skipped++;
            continue;
          }
        }

        // Fetch odds from API
        const url = `${API_BASE}/odds?fixture=${fixture.id}`;
        console.log(`[backfill-odds] Fetching odds for fixture ${fixture.id}`);

        const response = await fetch(url, {
          headers: apiHeaders(),
        });

        // Handle 429 rate limit with exponential backoff
        if (response.status === 429) {
          console.warn(`[backfill-odds] Rate limit hit (429) for fixture ${fixture.id}, backing off...`);
          currentDelay = Math.min(currentDelay * 2, MAX_BACKOFF_DELAY);
          await new Promise(resolve => setTimeout(resolve, currentDelay));
          failed++;
          continue;
        }

        if (!response.ok) {
          console.error(`[backfill-odds] API error for fixture ${fixture.id}: ${response.status}`);
          failed++;
          continue;
        }

        // Reset delay on success
        currentDelay = BASE_DELAY;

        const data = await response.json();

        if (!data.response || data.response.length === 0) {
          console.log(`[backfill-odds] No odds available for fixture ${fixture.id}`);
          failed++;
          continue;
        }

        // Extract bookmakers array
        const bookmakers = data.response[0]?.bookmakers || [];
        
        // Upsert into odds_cache
        const { error: upsertError } = await supabaseClient
          .from("odds_cache")
          .upsert({
            fixture_id: fixture.id,
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
          console.error(`[backfill-odds] Failed to upsert odds for fixture ${fixture.id}:`, upsertError);
          failed++;
        } else {
          console.log(`[backfill-odds] Successfully cached odds for fixture ${fixture.id} (${bookmakers.length} bookmakers)`);
          fetched++;
        }

        // Adaptive rate limit delay
        if (scanned < fixtures.length) {
          await new Promise(resolve => setTimeout(resolve, currentDelay));
        }

      } catch (error) {
        console.error(`[backfill-odds] Error processing fixture ${fixture.id}:`, error);
        failed++;
      }
    }

    console.log(`[backfill-odds] Complete: scanned=${scanned}, fetched=${fetched}, skipped=${skipped}, failed=${failed}`);

    // Log run to optimizer_run_logs
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    
    await supabaseClient.from("optimizer_run_logs").insert({
      id: crypto.randomUUID(),
      run_type: `backfill-odds-${window_hours}h`,
      window_start: now.toISOString(),
      window_end: endDate.toISOString(),
      scope: {},
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
        scanned,
        fetched,
        skipped,
        failed,
        window: { start: now.toISOString(), end: endDate.toISOString() },
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
