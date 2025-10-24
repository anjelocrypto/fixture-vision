import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pickFromCombined, RULES, StatMarket } from "../_shared/rules.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const RULES_VERSION = "v1.0-sheet";

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

    console.log(`[optimize-selections-refresh] Starting refresh${user ? ` for user ${user.id}` : ' (service role)'}`);

    // Parse window_hours from request body (default 48h)
    const { window_hours = 48 } = await req.json().catch(() => ({}));

    // Overlap guard: check if another optimize run is currently running for this window
    const runKey = `optimize-selections-${window_hours}h`;
    const { data: recentRuns } = await supabaseClient
      .from("optimizer_run_logs")
      .select("id, started_at, finished_at")
      .eq("run_type", runKey)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentRuns && !recentRuns.finished_at) {
      const runningForMs = Date.now() - new Date(recentRuns.started_at).getTime();
      if (runningForMs < 180000) { // 3 min max runtime before we consider it stale
        console.log(`[optimize-selections-refresh] Another ${runKey} run is in progress (started ${Math.floor(runningForMs/1000)}s ago), skipping`);
        return new Response(
          JSON.stringify({ skipped: true, reason: "concurrent_run_in_progress" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    
    // Get window (default 48h, can be 6h or 1h from cron)
    const now = new Date();
    const nowTimestamp = Math.floor(now.getTime() / 1000);
    const endDate = new Date(now.getTime() + (window_hours * 60 * 60 * 1000));
    const endTimestamp = Math.floor(endDate.getTime() / 1000);

    console.log(`[optimize-selections-refresh] Window: ${now.toISOString()} to ${endDate.toISOString()} (${window_hours}h)`);

    // Fetch upcoming fixtures in window
    const { data: fixtures, error: fixturesError } = await supabaseClient
      .from("fixtures")
      .select("*")
      .gte("timestamp", nowTimestamp)
      .lte("timestamp", endTimestamp);

    if (fixturesError) {
      console.error("[optimize-selections-refresh] Error fetching fixtures:", fixturesError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch fixtures" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    if (!fixtures || fixtures.length === 0) {
      console.log("[optimize-selections-refresh] No upcoming fixtures in window");
      return new Response(
        JSON.stringify({ scanned: 0, inserted: 0, updated: 0, skipped: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[optimize-selections-refresh] Found ${fixtures.length} fixtures`);

    // Batch fetch stats
    const allTeamIds = fixtures.flatMap((f: any) => [f.teams_home?.id, f.teams_away?.id]).filter(Boolean);
    const uniqueTeamIds = [...new Set(allTeamIds)];

    const { data: allStats } = await supabaseClient
      .from("stats_cache")
      .select("*")
      .in("team_id", uniqueTeamIds);

    const statsMap = new Map();
    if (allStats) {
      for (const stat of allStats) {
        statsMap.set(stat.team_id, stat);
      }
    }

    console.log(`[optimize-selections-refresh] Loaded stats for ${statsMap.size} teams`);

    // Batch fetch odds
    const fixtureIds = fixtures.map((f: any) => f.id);
    const { data: allOdds } = await supabaseClient
      .from("odds_cache")
      .select("fixture_id, payload, captured_at")
      .in("fixture_id", fixtureIds);

    const oddsMap = new Map();
    if (allOdds) {
      for (const odds of allOdds) {
        oddsMap.set(odds.fixture_id, odds);
      }
    }

    console.log(`[optimize-selections-refresh] Loaded odds for ${oddsMap.size} fixtures`);

    // Batch fetch leagues for country_code
    const leagueIds = [...new Set(fixtures.map((f: any) => f.league_id).filter(Boolean))];
    const { data: allLeagues } = await supabaseClient
      .from("leagues")
      .select("id, country_id")
      .in("id", leagueIds);

    const leagueToCountryMap = new Map();
    if (allLeagues) {
      for (const league of allLeagues) {
        leagueToCountryMap.set(league.id, league.country_id);
      }
    }

    // Batch fetch countries for country_code
    const countryIds = [...new Set(allLeagues?.map((l: any) => l.country_id).filter(Boolean) || [])];
    const { data: allCountries } = await supabaseClient
      .from("countries")
      .select("id, code")
      .in("id", countryIds);

    const countryCodeMap = new Map();
    if (allCountries) {
      for (const country of allCountries) {
        countryCodeMap.set(country.id, country.code);
      }
    }

    console.log(`[optimize-selections-refresh] Loaded ${leagueToCountryMap.size} leagues and ${countryCodeMap.size} countries`);

    // Process each fixture
    let scanned = 0;
    let inserted = 0;
    let skipped = 0;
    const selections: any[] = [];
    const started_at = new Date();

    for (const fixture of fixtures) {
      scanned++;
      const homeTeamId = fixture.teams_home?.id;
      const awayTeamId = fixture.teams_away?.id;

      if (!homeTeamId || !awayTeamId) {
        skipped++;
        continue;
      }

      const homeStats = statsMap.get(homeTeamId);
      const awayStats = statsMap.get(awayTeamId);

      if (!homeStats || !awayStats) {
        skipped++;
        continue;
      }

      // Compute combined totals (SUM, not average)
      const combined = {
        goals: Number(homeStats.goals) + Number(awayStats.goals),
        corners: Number(homeStats.corners) + Number(awayStats.corners),
        cards: Number(homeStats.cards) + Number(awayStats.cards),
        fouls: Number(homeStats.fouls) + Number(awayStats.fouls),
        offsides: Number(homeStats.offsides) + Number(awayStats.offsides),
      };

      const sampleSize = Math.min(homeStats.sample_size || 0, awayStats.sample_size || 0);

      // Get odds
      const oddsData = oddsMap.get(fixture.id);
      if (!oddsData) {
        skipped++;
        continue;
      }

      const bookmakers = oddsData.payload?.bookmakers || [];

      // For each market, apply rules
      const markets: StatMarket[] = ["goals", "corners", "cards", "fouls", "offsides"];

      for (const market of markets) {
        const combinedValue = combined[market];
        const pick = pickFromCombined(market, combinedValue);

        if (!pick) continue;

        // Find best odds across bookmakers for this market+line
        let bestOdds = 0;
        let bestBookmaker = "";

        for (const bookmaker of bookmakers) {
          const betsData = bookmaker.bets || [];
          
          // Match market type by EXACT bet ID only (API-Football uses bets[].id)
          // CRITICAL: We must use exact ID matching to avoid matching wrong bet types
          // API-Football Official Bet IDs:
          // - ID 5: "Goals Over/Under" (full match)
          // - ID 45: "Corners Over Under" (full match)
          // - ID 80: "Cards Over/Under" (full match)
          let targetBet = null;
          if (market === "goals") {
            targetBet = betsData.find((b: any) => b.id === 5);
          } else if (market === "corners") {
            targetBet = betsData.find((b: any) => b.id === 45);
          } else if (market === "cards") {
            targetBet = betsData.find((b: any) => b.id === 80);
          } else if (market === "fouls") {
            // API-Football does not provide fouls betting markets
            continue;
          } else if (market === "offsides") {
            // API-Football does not provide offsides betting markets
            continue;
          }

          if (!targetBet?.values) continue;

          // Find the specific line in values array with EXACT format matching
          const selection = targetBet.values.find((v: any) => {
            const value = v.value || "";
            const valueLower = value.toLowerCase().trim();
            
            // Build exact target string: "over 2.5" or "under 2.5"
            const targetString = `${pick.side.toLowerCase()} ${pick.line}`;
            
            // EXACT match only - must be exactly "over 2.5" format
            // This prevents matching "Over 1.5" when looking for "over 2.5"
            return valueLower === targetString;
          });

          if (selection?.odd) {
            const odds = parseFloat(selection.odd);
            if (odds > bestOdds) {
              bestOdds = odds;
              bestBookmaker = bookmaker.name || "Unknown";
            }
          }
        }

        if (bestOdds === 0) continue;

        // Calculate edge
        const impliedProb = 1 / bestOdds;
        // Simple model probability based on combined value relative to line
        const modelProb = Math.min(0.95, Math.max(0.05, combinedValue / (pick.line * 2)));
        const edgePct = ((modelProb - impliedProb) / impliedProb) * 100;

        // Prepare selection
        const utcKickoff = new Date(fixture.timestamp * 1000).toISOString();
        const countryId = leagueToCountryMap.get(fixture.league_id);
        const countryCode = countryId ? countryCodeMap.get(countryId) : null;

        selections.push({
          fixture_id: fixture.id,
          league_id: fixture.league_id,
          country_code: countryCode,
          utc_kickoff: utcKickoff,
          market,
          side: pick.side,
          line: pick.line,
          bookmaker: bestBookmaker,
          odds: bestOdds,
          is_live: false,
          edge_pct: edgePct,
          model_prob: modelProb,
          sample_size: sampleSize,
          combined_snapshot: combined,
          rules_version: RULES_VERSION,
          source: "api-football",
          computed_at: new Date().toISOString(),
        });
      }
    }

    const with_odds = fixtures.filter(f => oddsMap.has(f.id)).length;
    const coveragePct = fixtures.length > 0 ? Math.round((with_odds / fixtures.length) * 100) : 0;
    console.log(`[optimize-selections-refresh] Generated ${selections.length} selections from ${scanned} fixtures (with_odds: ${with_odds}/${fixtures.length} = ${coveragePct}%, skipped: ${skipped})`);

    // Alert on low coverage
    if (coveragePct < 90 && fixtures.length >= 5) {
      console.warn(`[optimize-selections-refresh] ⚠️ LOW COVERAGE: Only ${coveragePct}% of fixtures have odds (${with_odds}/${fixtures.length})`);
    }
    if (with_odds > 0 && selections.length < with_odds * 2) {
      console.warn(`[optimize-selections-refresh] ⚠️ LOW SELECTIONS: Only ${selections.length} selections from ${with_odds} fixtures with odds (expected ~${with_odds * 4}+)`);
    }

    // Upsert selections (batch)
    if (selections.length > 0) {
      const { error: upsertError } = await supabaseClient
        .from("optimized_selections")
        .upsert(selections, {
          onConflict: "fixture_id,market,side,line,bookmaker,is_live",
          ignoreDuplicates: false,
        });

      if (upsertError) {
        console.error("[optimize-selections-refresh] Upsert error:", upsertError);
        return new Response(
          JSON.stringify({ error: "Failed to upsert selections", details: upsertError.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
        );
      }

      inserted = selections.length;
    }

    console.log(`[optimize-selections-refresh] Successfully upserted ${inserted} selections`);

    // Record run log
    const finished_at = new Date();
    const duration_ms = finished_at.getTime() - started_at.getTime();
    const runLogId = crypto.randomUUID();
    
    await supabaseClient.from("optimizer_run_logs").insert({
      id: runLogId,
      run_type: `optimize-selections-${window_hours}h`,
      window_start: now.toISOString(),
      window_end: endDate.toISOString(),
      scope: {},
      scanned,
      with_odds,
      upserted: inserted,
      skipped,
      failed: 0,
      started_at: started_at.toISOString(),
      finished_at: finished_at.toISOString(),
      duration_ms,
    });

    return new Response(
      JSON.stringify({
        scanned,
        with_odds,
        inserted,
        skipped,
        failed: 0,
        window: { start: now.toISOString(), end: endDate.toISOString() },
        rules_version: RULES_VERSION,
        duration_ms,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[optimize-selections-refresh] Internal error:", {
      message: error instanceof Error ? error.message : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
