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

    console.log("[cup-coverage-report] Generating comprehensive coverage report...");

    // 1. Summary stats
    const { data: allCups, error: cupsError } = await supabase
      .from("league_stats_coverage")
      .select("*")
      .eq("is_cup", true)
      .order("corners_coverage_pct");

    if (cupsError) throw cupsError;

    // 2. Problematic cups (those being skipped)
    const { data: problematic, error: problemError } = await supabase
      .from("v_problematic_cups")
      .select("*");

    if (problemError) throw problemError;

    // 3. Coverage distribution
    const coverageRanges = {
      excellent: allCups?.filter(c => 
        c.corners_coverage_pct >= 80 && c.cards_coverage_pct >= 80
      ).length || 0,
      good: allCups?.filter(c => 
        c.corners_coverage_pct >= 50 && c.corners_coverage_pct < 80 &&
        c.cards_coverage_pct >= 50 && c.cards_coverage_pct < 80
      ).length || 0,
      fair: allCups?.filter(c => 
        c.corners_coverage_pct >= 30 && c.corners_coverage_pct < 50 &&
        c.cards_coverage_pct >= 30 && c.cards_coverage_pct < 50
      ).length || 0,
      poor: allCups?.filter(c => 
        c.corners_coverage_pct < 30 || c.cards_coverage_pct < 30
      ).length || 0,
    };

    // 4. Metrics being skipped summary
    const skipSummary = {
      skip_goals: problematic?.filter(c => c.skip_goals).length || 0,
      skip_corners: problematic?.filter(c => c.skip_corners).length || 0,
      skip_cards: problematic?.filter(c => c.skip_cards).length || 0,
      skip_fouls: problematic?.filter(c => c.skip_fouls).length || 0,
      skip_offsides: problematic?.filter(c => c.skip_offsides).length || 0,
    };

    // 5. Example improvements: sample teams that benefit from cup filtering
    // Get a few teams that play in known bad cups (EFL Trophy, etc.)
    const badCupIds = problematic?.filter(c => c.skip_corners).map(c => c.league_id) || [];
    
    let exampleImprovements: any[] = [];
    
    if (badCupIds.length > 0) {
      // Find fixtures from bad cups
      const { data: badCupFixtures } = await supabase
        .from("fixtures")
        .select("id, teams_home, teams_away, league_id")
        .in("league_id", badCupIds.slice(0, 3)) // Sample 3 bad cups
        .eq("status", "FT")
        .limit(10);

      if (badCupFixtures && badCupFixtures.length > 0) {
        for (const fixture of badCupFixtures.slice(0, 3)) {
          const homeTeamId = (fixture.teams_home as any)?.id;
          const awayTeamId = (fixture.teams_away as any)?.id;
          const homeName = (fixture.teams_home as any)?.name;
          const awayName = (fixture.teams_away as any)?.name;

          if (homeTeamId) {
            exampleImprovements.push({
              team_id: homeTeamId,
              team_name: homeName,
              affected_cup: problematic?.find(c => c.league_id === fixture.league_id)?.league_name,
              improvement: "Corners/cards from this cup will now be excluded from last-5 averages",
            });
          }
        }
      }
    }

    // 6. Console-friendly report
    const report = {
      summary: {
        total_cups_analyzed: allCups?.length || 0,
        cups_with_issues: problematic?.length || 0,
        healthy_cups: (allCups?.length || 0) - (problematic?.length || 0),
      },
      coverage_distribution: coverageRanges,
      skip_flags_summary: skipSummary,
      problematic_cups: problematic?.map(c => ({
        league_id: c.league_id,
        name: c.league_name,
        country: c.country,
        fixtures_analyzed: c.total_fixtures,
        corners_coverage: `${c.corners_coverage_pct?.toFixed(1)}%`,
        cards_coverage: `${c.cards_coverage_pct?.toFixed(1)}%`,
        fouls_coverage: `${c.fouls_coverage_pct?.toFixed(1)}%`,
        skip_flags: {
          goals: c.skip_goals,
          corners: c.skip_corners,
          cards: c.skip_cards,
          fouls: c.skip_fouls,
          offsides: c.skip_offsides,
        },
      })),
      example_improvements: exampleImprovements,
      recommendations: [
        "✅ System is now automatically skipping broken cups per metric",
        "✅ Goals are preserved from all cups (unless <80% coverage)",
        "✅ Corners/cards/fouls/offsides skip only when coverage <30%",
        `⚠️ ${problematic?.length || 0} cups identified with poor stats`,
        "💡 Run analyze-cup-coverage monthly to refresh coverage data",
      ],
    };

    console.log("\n" + "=".repeat(80));
    console.log("CUP COVERAGE ANALYSIS REPORT");
    console.log("=".repeat(80));
    console.log(`Total cups analyzed: ${report.summary.total_cups_analyzed}`);
    console.log(`Healthy cups: ${report.summary.healthy_cups}`);
    console.log(`Problematic cups: ${report.summary.cups_with_issues}`);
    console.log("\nCoverage Distribution:");
    console.log(`  Excellent (≥80%): ${coverageRanges.excellent} cups`);
    console.log(`  Good (50-79%): ${coverageRanges.good} cups`);
    console.log(`  Fair (30-49%): ${coverageRanges.fair} cups`);
    console.log(`  Poor (<30%): ${coverageRanges.poor} cups`);
    console.log("\nMetrics Being Skipped:");
    console.log(`  Goals: ${skipSummary.skip_goals} cups`);
    console.log(`  Corners: ${skipSummary.skip_corners} cups`);
    console.log(`  Cards: ${skipSummary.skip_cards} cups`);
    console.log(`  Fouls: ${skipSummary.skip_fouls} cups`);
    console.log(`  Offsides: ${skipSummary.skip_offsides} cups`);
    console.log("=".repeat(80) + "\n");

    return new Response(
      JSON.stringify(report, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[cup-coverage-report] Error:", error);
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
