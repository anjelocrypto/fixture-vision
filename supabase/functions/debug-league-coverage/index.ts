import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
    const { league_id } = await req.json();

    if (!league_id) {
      return new Response(
        JSON.stringify({ error: "league_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get coverage for this league
    const { data: coverage, error: coverageError } = await supabase
      .from("league_stats_coverage")
      .select("*")
      .eq("league_id", league_id)
      .single();

    if (coverageError || !coverage) {
      return new Response(
        JSON.stringify({ error: "League not found in coverage table" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get sample fixtures from this league
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    
    const { data: sampleFixtures, error: fixturesError } = await supabase
      .from("fixtures")
      .select("id, date, teams_home, teams_away, status")
      .eq("league_id", league_id)
      .eq("status", "FT")
      .gte("date", twelveMonthsAgo.toISOString().split("T")[0])
      .order("date", { ascending: false })
      .limit(10);

    // Get results for sample fixtures
    let sampleResults = [];
    if (sampleFixtures && sampleFixtures.length > 0) {
      const { data: results } = await supabase
        .from("fixture_results")
        .select("*")
        .in("fixture_id", sampleFixtures.map(f => f.id));
      
      sampleResults = results || [];
    }

    return new Response(
      JSON.stringify({
        coverage,
        sample_fixtures: sampleFixtures?.map(f => ({
          fixture_id: f.id,
          date: f.date,
          home_team: f.teams_home?.name,
          away_team: f.teams_away?.name,
          result: sampleResults.find(r => r.fixture_id === f.id),
        })) || [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[debug-league-coverage] Error:", error);
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
