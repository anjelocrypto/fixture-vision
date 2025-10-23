import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiHeaders, API_BASE } from "../_shared/api.ts";

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
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Allow both authenticated users and service role calls (from cron)
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    const isServiceRole = token === Deno.env.get("SUPABASE_ANON_KEY");
    
    if (authError && !isServiceRole) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    console.log(`[backfill-odds] Starting bulk odds backfill${user ? ` for user ${user.id}` : ' (service role)'}`);

    // Get 7-day window
    const now = new Date();
    const nowTimestamp = Math.floor(now.getTime() / 1000);
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 7);
    const endTimestamp = Math.floor(endDate.getTime() / 1000);

    console.log(`[backfill-odds] Window: ${now.toISOString()} to ${endDate.toISOString()}`);

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

    // Rate limiting: 30 requests per minute
    const RATE_LIMIT_DELAY = 2100; // ms between requests (slightly over 2s for safety)

    for (const fixture of fixtures) {
      scanned++;
      
      try {
        // Check if we already have recent odds (within last hour)
        const { data: existingOdds } = await supabaseClient
          .from("odds_cache")
          .select("captured_at")
          .eq("fixture_id", fixture.id)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingOdds) {
          const capturedAt = new Date(existingOdds.captured_at);
          const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
          if (capturedAt > hourAgo) {
            console.log(`[backfill-odds] Fixture ${fixture.id} has recent odds, skipping`);
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

        if (!response.ok) {
          console.error(`[backfill-odds] API error for fixture ${fixture.id}: ${response.status}`);
          failed++;
          continue;
        }

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

        // Rate limit delay
        if (scanned < fixtures.length) {
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
        }

      } catch (error) {
        console.error(`[backfill-odds] Error processing fixture ${fixture.id}:`, error);
        failed++;
      }
    }

    console.log(`[backfill-odds] Complete: scanned=${scanned}, fetched=${fetched}, skipped=${skipped}, failed=${failed}`);

    return new Response(
      JSON.stringify({
        scanned,
        fetched,
        skipped,
        failed,
        window: { start: now.toISOString(), end: endDate.toISOString() },
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
