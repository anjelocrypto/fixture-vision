import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiHeaders, API_BASE } from "../_shared/api.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BetType {
  id: number;
  name: string;
}

interface FixtureCoverage {
  fixture_id: number;
  league_id: number;
  league_name: string;
  home_team: string;
  away_team: string;
  has_home_o15: boolean;
  has_away_o15: boolean;
  sample_bookmaker?: string;
  sample_home_o15_odd?: number;
  sample_away_o15_odd?: number;
}

interface LeagueCoverage {
  league_name: string;
  league_id: number;
  fixtures_total: number;
  fixtures_with_home_o15: number;
  fixtures_with_away_o15: number;
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

serve(async (req) => {
  console.log("[verify-team-totals] Request received, method:", req.method);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[verify-team-totals] Starting verification...");
    
    // Auth check
    const authHeader = req.headers.get("authorization");
    console.log("[verify-team-totals] Auth header present:", !!authHeader);
    
    if (!authHeader) {
      console.error("[verify-team-totals] No auth header");
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

    // Client bound to the caller's JWT so RPCs using auth.uid() work
    const supabaseUserClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: `Bearer ${token}` },
        },
      }
    );

    console.log("[verify-team-totals] Getting user from token...");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    console.log("[verify-team-totals] User fetch result:", { userId: user?.id, error: authError?.message });
    
    if (authError || !user) {
      console.error("[verify-team-totals] Auth error:", authError);
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    // Check if admin using user-bound client so auth.uid() is set
    console.log("[verify-team-totals] Checking admin status via RPC is_user_whitelisted...");
    const { data: isAdmin, error: adminError } = await supabaseUserClient.rpc("is_user_whitelisted");
    console.log("[verify-team-totals] Admin check result:", { isAdmin, error: adminError?.message });
    
    if (adminError) {
      console.error("[verify-team-totals] Admin RPC error:", adminError);
    }

    if (!isAdmin) {
      console.error("[verify-team-totals] User is not admin");
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
      );
    }

    console.log("[verify-team-totals] Starting verification...");

    // STEP 1: Fetch all bet types
    console.log("[verify-team-totals] Fetching /odds/bets...");
    const betsResponse = await fetch(`${API_BASE}/odds/bets`, {
      headers: apiHeaders()
    });

    if (!betsResponse.ok) {
      throw new Error(`Failed to fetch bet types: ${betsResponse.status}`);
    }

    const betsData = await betsResponse.json();
    const allBets: BetType[] = betsData.response || [];

    // Filter for team-total related bets
    const teamTotalBets = allBets.filter(bet => {
      const name = bet.name.toLowerCase();
      return (
        name.includes("team") &&
        (name.includes("total") || name.includes("goals")) &&
        (name.includes("home") || name.includes("away") || name.includes("over") || name.includes("under"))
      );
    });

    console.log(`[verify-team-totals] Found ${teamTotalBets.length} potential team-total bets:`, 
      teamTotalBets.map(b => `${b.id}: ${b.name}`));

    // STEP 2: Get upcoming fixtures (next 120h)
    const now = Math.floor(Date.now() / 1000);
    const end120h = now + (120 * 3600);

    const { data: fixtures, error: fixturesError } = await supabaseClient
      .from("fixtures")
      .select("id, league_id, timestamp, teams_home, teams_away, leagues(name)")
      .gte("timestamp", now)
      .lte("timestamp", end120h)
      .eq("status", "NS")
      .order("timestamp");

    if (fixturesError) {
      throw new Error(`Failed to fetch fixtures: ${fixturesError.message}`);
    }

    console.log(`[verify-team-totals] Found ${fixtures?.length || 0} fixtures in next 120h`);

    // STEP 3: Sample fixtures from major leagues for detailed inspection
    const sampleLeagues = [39, 140, 135, 78, 61, 253, 119, 203]; // EPL, La Liga, Serie A, Bundesliga, Ligue 1, MLS, Denmark, Turkey
    const sampleFixtures = fixtures?.filter(f => sampleLeagues.includes(f.league_id)).slice(0, 10) || [];
    
    const detailedSamples: any[] = [];

    for (const fixture of sampleFixtures) {
      console.log(`[verify-team-totals] Sampling fixture ${fixture.id}...`);
      
      await delay(1200); // Rate limit: ~50 req/min
      
      const oddsResponse = await fetch(
        `${API_BASE}/odds?fixture=${fixture.id}`,
        { headers: apiHeaders() }
      );

      if (oddsResponse.ok) {
        const oddsData = await oddsResponse.json();
        const bookmakers = oddsData.response || [];
        
        // Look for team-total markets in the response
        const leagueName = Array.isArray((fixture as any).leagues) 
          ? (fixture as any).leagues[0]?.name 
          : (fixture as any).leagues?.name;
        
        const sample = {
          fixture_id: fixture.id,
          league: leagueName || "Unknown",
          home: (fixture as any).teams_home?.name,
          away: (fixture as any).teams_away?.name,
          bookmakers_count: bookmakers.length,
          markets_found: [] as any[]
        };

        for (const bookmaker of bookmakers) {
          for (const bet of bookmaker.bets || []) {
            if (teamTotalBets.some(ttb => ttb.id === bet.id)) {
              sample.markets_found.push({
                bet_id: bet.id,
                bet_name: bet.name,
                bookmaker: bookmaker.name,
                values: bet.values?.slice(0, 3) // Sample first 3 values
              });
            }
          }
        }

        detailedSamples.push(sample);
      }
    }

    // STEP 4: Coverage scan across all fixtures
    const coverageData: FixtureCoverage[] = [];
    let scanned = 0;
    const maxScan = 200; // Limit to avoid timeout

    for (const fixture of (fixtures || []).slice(0, maxScan)) {
      if (scanned > 0 && scanned % 10 === 0) {
        console.log(`[verify-team-totals] Scanned ${scanned}/${Math.min(fixtures?.length || 0, maxScan)} fixtures...`);
      }

      await delay(1200); // Rate limit

      const oddsResponse = await fetch(
        `${API_BASE}/odds?fixture=${fixture.id}`,
        { headers: apiHeaders() }
      );

      const leagueName = Array.isArray((fixture as any).leagues) 
        ? (fixture as any).leagues[0]?.name 
        : (fixture as any).leagues?.name;
      
      const coverage: FixtureCoverage = {
        fixture_id: fixture.id,
        league_id: fixture.league_id,
        league_name: leagueName || "Unknown",
        home_team: (fixture as any).teams_home?.name || "Unknown",
        away_team: (fixture as any).teams_away?.name || "Unknown",
        has_home_o15: false,
        has_away_o15: false
      };

      if (oddsResponse.ok) {
        const oddsData = await oddsResponse.json();
        const bookmakers = oddsData.response || [];

        for (const bookmaker of bookmakers) {
          for (const bet of bookmaker.bets || []) {
            if (teamTotalBets.some(ttb => ttb.id === bet.id)) {
              const betName = bet.name.toLowerCase();
              
              // Check for Over 1.5 in values
              for (const value of bet.values || []) {
                if (value.value === "Over 1.5" || value.value === "Over (1.5)") {
                  if (betName.includes("home")) {
                    coverage.has_home_o15 = true;
                    if (!coverage.sample_home_o15_odd) {
                      coverage.sample_bookmaker = bookmaker.name;
                      coverage.sample_home_o15_odd = parseFloat(value.odd);
                    }
                  } else if (betName.includes("away")) {
                    coverage.has_away_o15 = true;
                    if (!coverage.sample_away_o15_odd) {
                      coverage.sample_bookmaker = bookmaker.name;
                      coverage.sample_away_o15_odd = parseFloat(value.odd);
                    }
                  }
                }
              }
            }
          }
        }
      }

      coverageData.push(coverage);
      scanned++;
    }

    // STEP 5: Aggregate by league
    const leagueMap = new Map<number, LeagueCoverage>();
    
    for (const cov of coverageData) {
      if (!leagueMap.has(cov.league_id)) {
        leagueMap.set(cov.league_id, {
          league_id: cov.league_id,
          league_name: cov.league_name,
          fixtures_total: 0,
          fixtures_with_home_o15: 0,
          fixtures_with_away_o15: 0
        });
      }
      
      const league = leagueMap.get(cov.league_id)!;
      league.fixtures_total++;
      if (cov.has_home_o15) league.fixtures_with_home_o15++;
      if (cov.has_away_o15) league.fixtures_with_away_o15++;
    }

    const leagueCoverage = Array.from(leagueMap.values())
      .sort((a, b) => b.fixtures_total - a.fixtures_total);

    // Calculate overall percentages
    const totalFixtures = coverageData.length;
    const totalWithHomeO15 = coverageData.filter(c => c.has_home_o15).length;
    const totalWithAwayO15 = coverageData.filter(c => c.has_away_o15).length;

    const report = {
      summary: {
        total_bet_types: allBets.length,
        team_total_bet_types: teamTotalBets.length,
        fixtures_scanned: scanned,
        total_fixtures_next_120h: fixtures?.length || 0,
        home_o15_coverage_pct: totalFixtures > 0 ? ((totalWithHomeO15 / totalFixtures) * 100).toFixed(1) : "0.0",
        away_o15_coverage_pct: totalFixtures > 0 ? ((totalWithAwayO15 / totalFixtures) * 100).toFixed(1) : "0.0",
        fixtures_with_home_o15: totalWithHomeO15,
        fixtures_with_away_o15: totalWithAwayO15
      },
      team_total_bets: teamTotalBets,
      detailed_samples: detailedSamples,
      league_coverage: leagueCoverage,
      fixture_samples: coverageData.slice(0, 20) // First 20 for review
    };

    console.log("[verify-team-totals] Verification complete!");

    return new Response(
      JSON.stringify(report),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[verify-team-totals] Caught error:", {
      message: error instanceof Error ? error.message : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
      error: error
    });
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        details: "Check edge function logs for more information"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
