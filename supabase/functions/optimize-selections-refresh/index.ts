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

    // Get 7-day window (now → +7 days)
    const now = new Date();
    const nowTimestamp = Math.floor(now.getTime() / 1000);
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 7);
    const endTimestamp = Math.floor(endDate.getTime() / 1000);

    console.log(`[optimize-selections-refresh] Window: ${now.toISOString()} to ${endDate.toISOString()}`);

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

    // Process each fixture
    let scanned = 0;
    let inserted = 0;
    let skipped = 0;
    const selections: any[] = [];

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

      const bookmakers = oddsData.payload?.response?.[0]?.bookmakers || [];

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
          const bets = bookmaker.bets || [];
          
          // Match market type
          let targetBet = null;
          if (market === "goals") {
            targetBet = bets.find((b: any) => 
              b.name?.toLowerCase().includes("goals") && 
              (b.name?.toLowerCase().includes("over/under") || b.name?.toLowerCase().includes("total"))
            );
          } else if (market === "corners") {
            targetBet = bets.find((b: any) => b.name?.toLowerCase().includes("corners"));
          } else if (market === "cards") {
            targetBet = bets.find((b: any) => b.name?.toLowerCase().includes("cards") || b.name?.toLowerCase().includes("bookings"));
          } else if (market === "fouls") {
            targetBet = bets.find((b: any) => b.name?.toLowerCase().includes("fouls"));
          } else if (market === "offsides") {
            targetBet = bets.find((b: any) => b.name?.toLowerCase().includes("offsides"));
          }

          if (!targetBet?.values) continue;

          // Find the specific line
          const selection = targetBet.values.find((v: any) => {
            const value = v.value?.toLowerCase() || "";
            const lineMatch = value.match(/(\d+\.?\d*)/);
            if (!lineMatch) return false;
            const oddsLine = parseFloat(lineMatch[1]);
            return (
              value.includes(pick.side) &&
              Math.abs(oddsLine - pick.line) < 0.01
            );
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

        selections.push({
          fixture_id: fixture.id,
          league_id: fixture.league_id,
          country_code: null, // TODO: join from leagues if needed
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

    console.log(`[optimize-selections-refresh] Generated ${selections.length} selections from ${scanned} fixtures (skipped: ${skipped})`);

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

    return new Response(
      JSON.stringify({
        scanned,
        inserted,
        skipped,
        window: { start: now.toISOString(), end: endDate.toISOString() },
        rules_version: RULES_VERSION,
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
