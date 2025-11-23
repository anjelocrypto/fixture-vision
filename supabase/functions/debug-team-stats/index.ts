// ============================================================================
// Debug Team Stats - Diagnostic Tool for Last-5 Stats Verification
// ============================================================================
// This function provides detailed diagnostics for a team's last-5 stats,
// comparing API-Football raw data against what's stored in stats_cache.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { API_BASE, apiHeaders } from "../_shared/api.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Parse request
    const body = await req.json();
    const { teamId, forceRecompute } = body;
    
    if (!teamId || typeof teamId !== 'number') {
      return new Response(
        JSON.stringify({ error: "teamId is required and must be a number" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    console.log(`[debug-team-stats] 🔍 Diagnosing team ${teamId}, forceRecompute: ${!!forceRecompute}`);

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // ========================================================================
    // STEP 1: Determine current season
    // ========================================================================
    // Football seasons start in August (month 7):
    // - Aug-Dec of year Y: season Y
    // - Jan-Jul of year Y: season Y-1
    const now = new Date();
    const month = now.getMonth(); // 0-11
    const year = now.getFullYear();
    const season = (month >= 7) ? year : year - 1;
    
    console.log(`[debug-team-stats] Current season: ${season} (month: ${month}, year: ${year})`);

    // ========================================================================
    // STEP 2: Fetch fixtures from API-Football
    // ========================================================================
    const fixturesUrl = `${API_BASE}/fixtures?team=${teamId}&season=${season}&status=FT`;
    console.log(`[debug-team-stats] Fetching fixtures: ${fixturesUrl}`);
    
    const fixturesRes = await fetch(fixturesUrl, { headers: apiHeaders() });
    
    if (!fixturesRes.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch fixtures: ${fixturesRes.status}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const fixturesJson = await fixturesRes.json();
    const allFixtures = fixturesJson?.response ?? [];
    
    console.log(`[debug-team-stats] Found ${allFixtures.length} FT fixtures for team ${teamId} in season ${season}`);

    // Sort by timestamp descending and take first 5
    const last5Fixtures = allFixtures
      .filter((f: any) => f?.fixture?.id && f?.fixture?.timestamp)
      .sort((a: any, b: any) => b.fixture.timestamp - a.fixture.timestamp)
      .slice(0, 5);

    console.log(`[debug-team-stats] Last 5 fixtures (sorted by date DESC):`);
    last5Fixtures.forEach((f: any, idx: number) => {
      const date = new Date(f.fixture.timestamp * 1000).toISOString().split('T')[0];
      const homeTeam = f.teams.home.name;
      const awayTeam = f.teams.away.name;
      const score = `${f.goals.home}-${f.goals.away}`;
      console.log(`[debug-team-stats]   ${idx + 1}. Fixture ${f.fixture.id} (${date}): ${homeTeam} ${score} ${awayTeam}`);
    });

    // ========================================================================
    // STEP 3: Fetch detailed stats for each fixture
    // ========================================================================
    const fixtureDetails: any[] = [];

    for (const fixture of last5Fixtures) {
      const fixtureId = fixture.fixture.id;
      const homeId = fixture.teams.home.id;
      const awayId = fixture.teams.away.id;
      const isHome = teamId === homeId;
      const isAway = teamId === awayId;
      
      if (!isHome && !isAway) {
        console.warn(`[debug-team-stats] ⚠️ Team ${teamId} not found in fixture ${fixtureId}`);
        continue;
      }

      const teamSide = isHome ? 'home' : 'away';
      const opponentId = isHome ? awayId : homeId;
      const opponentName = isHome ? fixture.teams.away.name : fixture.teams.home.name;
      const teamGoals = isHome ? fixture.goals.home : fixture.goals.away;

      // Fetch detailed statistics
      const statsUrl = `${API_BASE}/fixtures/statistics?fixture=${fixtureId}`;
      const statsRes = await fetch(statsUrl, { headers: apiHeaders() });

      let corners = 0;
      let fouls = 0;
      let offsides = 0;
      let yellowCards = 0;
      let redCards = 0;

      if (statsRes.ok) {
        const statsJson = await statsRes.json();
        const teamStatsObj = (statsJson?.response ?? []).find((r: any) => {
          return Number(r?.team?.id) === Number(teamId);
        });

        if (teamStatsObj) {
          const statsArr = teamStatsObj.statistics ?? [];
          
          // Helper to extract numeric value
          const getStatValue = (...types: string[]) => {
            for (const type of types) {
              const stat = statsArr.find((s: any) => 
                (s?.type || "").toLowerCase() === type.toLowerCase()
              );
              if (stat) {
                const v = stat.value;
                if (typeof v === "number") return v;
                if (typeof v === "string") {
                  const num = parseFloat(String(v).replace(/[^0-9.]/g, ""));
                  if (!isNaN(num)) return num;
                }
              }
            }
            return 0;
          };

          corners = getStatValue("Corner Kicks", "Corners");
          fouls = getStatValue("Fouls");
          offsides = getStatValue("Offsides");
          yellowCards = getStatValue("Yellow Cards");
          redCards = getStatValue("Red Cards");
        } else {
          console.warn(`[debug-team-stats] ⚠️ No stats found for team ${teamId} in fixture ${fixtureId}`);
        }
      } else {
        console.warn(`[debug-team-stats] ⚠️ Failed to fetch stats for fixture ${fixtureId}: ${statsRes.status}`);
      }

      fixtureDetails.push({
        fixture_id: fixtureId,
        date: new Date(fixture.fixture.timestamp * 1000).toISOString().split('T')[0],
        team_side: teamSide,
        opponent_name: opponentName,
        opponent_id: opponentId,
        goals: teamGoals,
        corners,
        fouls,
        offsides,
        yellow_cards: yellowCards,
        red_cards: redCards,
        total_cards: yellowCards + redCards,
      });

      console.log(`[debug-team-stats] Fixture ${fixtureId}: G=${teamGoals}, C=${corners}, F=${fouls}, O=${offsides}, Cards=${yellowCards + redCards}`);
    }

    // ========================================================================
    // STEP 4: Compute TRUE averages from API data
    // ========================================================================
    const n = fixtureDetails.length;
    const sum = (key: string) => fixtureDetails.reduce((acc, f) => acc + (f[key] || 0), 0);

    const trueAverages = {
      sample_size: n,
      goals: n > 0 ? sum('goals') / n : 0,
      corners: n > 0 ? sum('corners') / n : 0,
      fouls: n > 0 ? sum('fouls') / n : 0,
      offsides: n > 0 ? sum('offsides') / n : 0,
      cards: n > 0 ? sum('total_cards') / n : 0,
    };

    console.log(`[debug-team-stats] TRUE AVERAGES (from API):`);
    console.log(`[debug-team-stats]   Goals: ${trueAverages.goals.toFixed(2)} (total: ${sum('goals')})`);
    console.log(`[debug-team-stats]   Corners: ${trueAverages.corners.toFixed(2)} (total: ${sum('corners')})`);
    console.log(`[debug-team-stats]   Fouls: ${trueAverages.fouls.toFixed(2)} (total: ${sum('fouls')})`);
    console.log(`[debug-team-stats]   Offsides: ${trueAverages.offsides.toFixed(2)} (total: ${sum('offsides')})`);
    console.log(`[debug-team-stats]   Cards: ${trueAverages.cards.toFixed(2)} (total: ${sum('total_cards')})`);

    // ========================================================================
    // STEP 5: Fetch cached stats from stats_cache
    // ========================================================================
    const { data: cachedStats, error: cacheError } = await supabaseClient
      .from('stats_cache')
      .select('*')
      .eq('team_id', teamId)
      .single();

    let cacheComparison: any = null;

    if (cacheError || !cachedStats) {
      console.log(`[debug-team-stats] ❌ No cached stats found for team ${teamId}`);
    } else {
      console.log(`[debug-team-stats] CACHED STATS (from stats_cache):`);
      console.log(`[debug-team-stats]   Goals: ${cachedStats.goals}`);
      console.log(`[debug-team-stats]   Corners: ${cachedStats.corners}`);
      console.log(`[debug-team-stats]   Fouls: ${cachedStats.fouls}`);
      console.log(`[debug-team-stats]   Offsides: ${cachedStats.offsides}`);
      console.log(`[debug-team-stats]   Cards: ${cachedStats.cards}`);
      console.log(`[debug-team-stats]   Sample size: ${cachedStats.sample_size}`);
      console.log(`[debug-team-stats]   Computed at: ${cachedStats.computed_at}`);
      console.log(`[debug-team-stats]   Last 5 fixture IDs: [${cachedStats.last_five_fixture_ids?.join(', ') || 'none'}]`);

      // Compare
      const diff = (metric: string, cached: number, truth: number) => {
        const delta = cached - truth;
        const pct = truth > 0 ? ((delta / truth) * 100).toFixed(1) : 'N/A';
        return {
          cached,
          truth,
          difference: delta,
          percent_diff: pct,
          status: Math.abs(delta) < 0.01 ? 'OK' : 'MISMATCH'
        };
      };

      cacheComparison = {
        goals: diff('goals', cachedStats.goals, trueAverages.goals),
        corners: diff('corners', cachedStats.corners, trueAverages.corners),
        fouls: diff('fouls', cachedStats.fouls, trueAverages.fouls),
        offsides: diff('offsides', cachedStats.offsides, trueAverages.offsides),
        cards: diff('cards', cachedStats.cards, trueAverages.cards),
        sample_size: diff('sample_size', cachedStats.sample_size, trueAverages.sample_size),
      };

      console.log(`[debug-team-stats] COMPARISON:`);
      for (const [metric, comparison] of Object.entries(cacheComparison)) {
        const comp = comparison as any;
        console.log(`[debug-team-stats]   ${metric}: ${comp.status} (cached: ${comp.cached.toFixed(2)}, truth: ${comp.truth.toFixed(2)}, diff: ${comp.difference.toFixed(2)})`);
      }
    }

    // ========================================================================
    // STEP 6: Force recomputation if requested
    // ========================================================================
    let recomputedStats: any = null;
    
    if (forceRecompute) {
      console.log(`[debug-team-stats] 🔄 Force recomputing stats for team ${teamId}`);
      
      try {
        // Import computeLastFiveAverages
        const { computeLastFiveAverages } = await import("../_shared/stats.ts");
        
        // Compute fresh stats - CRITICAL: pass supabase client for league coverage
        const freshStats = await computeLastFiveAverages(teamId, supabaseClient);
        
        // Upsert to stats_cache
        await supabaseClient.from("stats_cache").upsert({
          team_id: freshStats.team_id,
          goals: freshStats.goals,
          cards: freshStats.cards,
          offsides: freshStats.offsides,
          corners: freshStats.corners,
          fouls: freshStats.fouls,
          sample_size: freshStats.sample_size,
          last_five_fixture_ids: freshStats.last_five_fixture_ids,
          last_final_fixture: freshStats.last_final_fixture,
          computed_at: new Date().toISOString(),
          source: 'api-football'
        });
        
        console.log(`[debug-team-stats] ✅ Recomputed and stored stats for team ${teamId}`);
        console.log(`[debug-team-stats]    New corners: ${freshStats.corners}`);
        console.log(`[debug-team-stats]    New fouls: ${freshStats.fouls}`);
        console.log(`[debug-team-stats]    New cards: ${freshStats.cards}`);
        
        recomputedStats = freshStats;
      } catch (error) {
        console.error(`[debug-team-stats] ❌ Failed to recompute stats:`, error);
        recomputedStats = { error: String(error) };
      }
    }

    // ========================================================================
    // STEP 7: Return diagnostic report
    // ========================================================================
    return new Response(
      JSON.stringify({
        team_id: teamId,
        season,
        fixtures: fixtureDetails,
        true_averages: trueAverages,
        cached_stats: cachedStats || null,
        recomputed_stats: recomputedStats,
        comparison: cacheComparison,
        summary: {
          total_fixtures_in_season: allFixtures.length,
          last_5_count: fixtureDetails.length,
          cache_exists: !!cachedStats,
          recomputed: !!recomputedStats,
          all_metrics_match: cacheComparison
            ? Object.values(cacheComparison).every((c: any) => c.status === 'OK')
            : false,
        }
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[debug-team-stats] Error:", error);
    return new Response(
      JSON.stringify({ 
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error)
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
