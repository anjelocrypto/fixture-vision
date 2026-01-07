import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"), req);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("[analyze-cup-coverage] Starting cup coverage analysis...");

    // Step 1: Discover all leagues from our fixtures
    const { data: leaguesData, error: leaguesError } = await supabase
      .from("leagues")
      .select("id, name, country_id, countries(name, code)")
      .order("id");

    if (leaguesError) throw leaguesError;

    console.log(`[analyze-cup-coverage] Found ${leaguesData.length} leagues to analyze`);

    // Step 2: Analyze each league's fixture coverage
    const results = [];
    
    for (const league of leaguesData) {
      console.log(`[analyze-cup-coverage] Analyzing league ${league.id}: ${league.name}`);
      
      // Get all FT fixtures from last 12 months for this league
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      
      const { data: fixtures, error: fixturesError } = await supabase
        .from("fixtures")
        .select("id, league_id, status")
        .eq("league_id", league.id)
        .eq("status", "FT")
        .gte("date", twelveMonthsAgo.toISOString().split("T")[0]);

      if (fixturesError) {
        console.error(`[analyze-cup-coverage] Error fetching fixtures for league ${league.id}:`, fixturesError);
        continue;
      }

      if (!fixtures || fixtures.length === 0) {
        console.log(`[analyze-cup-coverage] No FT fixtures found for league ${league.id}`);
        continue;
      }

      console.log(`[analyze-cup-coverage] Found ${fixtures.length} FT fixtures for league ${league.id}`);

      // Step 3: Check coverage per metric by sampling fixture_results
      const fixtureIds = fixtures.map(f => f.id);
      
      console.log(`[analyze-cup-coverage] Querying fixture_results for ${fixtureIds.length} fixture IDs...`);
      
      const { data: results_data, error: resultsError } = await supabase
        .from("fixture_results")
        .select("fixture_id, goals_home, goals_away, corners_home, corners_away, cards_home, cards_away, fouls, offsides")
        .in("fixture_id", fixtureIds);

      if (resultsError) {
        console.error(`[analyze-cup-coverage] Error fetching fixture_results for league ${league.id}:`, resultsError);
      }

      console.log(`[analyze-cup-coverage] Got ${results_data?.length || 0} results from fixture_results`);

      // Count coverage per metric
      let fixturesWithGoals = 0;
      let fixturesWithCorners = 0;
      let fixturesWithCards = 0;
      let fixturesWithFouls = 0;
      let fixturesWithOffsides = 0;

      if (results_data && results_data.length > 0) {
        for (const result of results_data) {
          // Goals: if both home and away are present (not null)
          if (result.goals_home !== null && result.goals_away !== null) {
            fixturesWithGoals++;
          }
          
          // Corners: if both home and away are present (including 0 corners)
          if (result.corners_home !== null && result.corners_away !== null) {
            fixturesWithCorners++;
          }
          
          // Cards: if both home and away are present (including 0 cards)
          if (result.cards_home !== null && result.cards_away !== null) {
            fixturesWithCards++;
          }
          
          // Fouls: if present (stored as single value, not split by team in some schemas)
          if (result.fouls !== null && result.fouls !== undefined) {
            fixturesWithFouls++;
          }
          
          // Offsides: if present
          if (result.offsides !== null && result.offsides !== undefined) {
            fixturesWithOffsides++;
          }
        }
        
        console.log(`[analyze-cup-coverage] League ${league.id} coverage: goals=${fixturesWithGoals}, corners=${fixturesWithCorners}, cards=${fixturesWithCards}, fouls=${fixturesWithFouls}, offsides=${fixturesWithOffsides}`);
      } else {
        console.log(`[analyze-cup-coverage] ⚠️ No fixture_results data found for league ${league.id}`);
      }

      // Determine if this is a cup (heuristic: name contains "cup", "trophy", "fa ", "efl", etc.)
      const name_lower = league.name.toLowerCase();
      const isCup = 
        name_lower.includes("cup") ||
        name_lower.includes("trophy") ||
        name_lower.includes("fa ") ||
        name_lower.includes("efl") ||
        name_lower.includes("carabao") ||
        name_lower.includes("league cup") ||
        name_lower.includes("coppa") ||
        name_lower.includes("pokal") ||
        name_lower.includes("coupe");

      const countryName = (league.countries as any)?.name || "Unknown";

      // Upsert into league_stats_coverage
      const { error: upsertError } = await supabase
        .from("league_stats_coverage")
        .upsert({
          league_id: league.id,
          league_name: league.name,
          country: countryName,
          is_cup: isCup,
          total_fixtures: fixtures.length,
          fixtures_with_goals: fixturesWithGoals,
          fixtures_with_corners: fixturesWithCorners,
          fixtures_with_cards: fixturesWithCards,
          fixtures_with_fouls: fixturesWithFouls,
          fixtures_with_offsides: fixturesWithOffsides,
          last_checked_at: new Date().toISOString(),
        });

      if (upsertError) {
        console.error(`[analyze-cup-coverage] Error upserting coverage for league ${league.id}:`, upsertError);
        continue;
      }

      results.push({
        league_id: league.id,
        league_name: league.name,
        country: countryName,
        is_cup: isCup,
        total_fixtures: fixtures.length,
        goals_coverage: `${fixturesWithGoals}/${fixtures.length} (${((fixturesWithGoals/fixtures.length)*100).toFixed(1)}%)`,
        corners_coverage: `${fixturesWithCorners}/${fixtures.length} (${((fixturesWithCorners/fixtures.length)*100).toFixed(1)}%)`,
        cards_coverage: `${fixturesWithCards}/${fixtures.length} (${((fixturesWithCards/fixtures.length)*100).toFixed(1)}%)`,
        fouls_coverage: `${fixturesWithFouls}/${fixtures.length} (${((fixturesWithFouls/fixtures.length)*100).toFixed(1)}%)`,
        offsides_coverage: `${fixturesWithOffsides}/${fixtures.length} (${((fixturesWithOffsides/fixtures.length)*100).toFixed(1)}%)`,
      });

      console.log(`[analyze-cup-coverage] ✅ Analyzed league ${league.id}: ${league.name} (${fixtures.length} fixtures)`);
    }

    // Fetch problematic cups summary
    const { data: problematicCups, error: problematicError } = await supabase
      .from("v_problematic_cups")
      .select("*")
      .order("corners_coverage_pct");

    console.log(`[analyze-cup-coverage] ✅ Analysis complete. Found ${problematicCups?.length || 0} problematic cups.`);

    return new Response(
      JSON.stringify({
        success: true,
        analyzed_leagues: results.length,
        problematic_cups: problematicCups || [],
        summary: results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[analyze-cup-coverage] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
