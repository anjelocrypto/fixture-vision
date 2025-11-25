// Test UEFA competitions availability in API-Football
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { API_BASE, apiHeaders } from "../_shared/api.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[test-uefa] Testing UEFA Champions League, Europa League, and Conference League");

    // UEFA Competition League IDs in API-Football:
    // 2 = UEFA Champions League
    // 3 = UEFA Europa League  
    // 848 = UEFA Europa Conference League

    const competitions = [
      { id: 2, name: "UEFA Champions League" },
      { id: 3, name: "UEFA Europa League" },
      { id: 848, name: "UEFA Europa Conference League" }
    ];

    const results = [];

    for (const comp of competitions) {
      console.log(`[test-uefa] Checking ${comp.name} (ID: ${comp.id})`);

      // Test 1: Check if fixtures exist for current season (2024-2025)
      const fixturesUrl = `${API_BASE}/fixtures?league=${comp.id}&season=2024`;
      const fixturesResp = await fetch(fixturesUrl, { headers: apiHeaders() });
      
      if (!fixturesResp.ok) {
        results.push({
          competition: comp.name,
          league_id: comp.id,
          fixtures_available: false,
          error: `API returned ${fixturesResp.status}`
        });
        continue;
      }

      const fixturesData = await fixturesResp.json();
      const fixtures = fixturesData.response || [];
      
      console.log(`[test-uefa] ${comp.name}: Found ${fixtures.length} fixtures for 2024 season`);

      // Test 2: Check H2H stats for a sample fixture (if available)
      let h2hTest: {
        available: boolean;
        sample_fixture: {
          fixture_id: number;
          home_team: string;
          away_team: string;
          h2h_matches_found: number;
        } | null;
        error: string | null;
      } = { available: false, sample_fixture: null, error: null };
      
      if (fixtures.length > 0) {
        const sampleFixture = fixtures[0];
        const homeTeamId = sampleFixture.teams?.home?.id;
        const awayTeamId = sampleFixture.teams?.away?.id;

        if (homeTeamId && awayTeamId) {
          console.log(`[test-uefa] Testing H2H for teams ${homeTeamId} vs ${awayTeamId}`);
          
          const h2hUrl = `${API_BASE}/fixtures/headtohead?h2h=${homeTeamId}-${awayTeamId}&last=5`;
          const h2hResp = await fetch(h2hUrl, { headers: apiHeaders() });
          
          if (h2hResp.ok) {
            const h2hData = await h2hResp.json();
            const h2hFixtures = h2hData.response || [];
            
            h2hTest = {
              available: true,
              sample_fixture: {
                fixture_id: sampleFixture.fixture?.id,
                home_team: sampleFixture.teams?.home?.name,
                away_team: sampleFixture.teams?.away?.name,
                h2h_matches_found: h2hFixtures.length
              },
              error: null
            };
            
            console.log(`[test-uefa] H2H test: Found ${h2hFixtures.length} head-to-head matches`);
          } else {
            h2hTest = {
              available: false,
              sample_fixture: null,
              error: `H2H API returned ${h2hResp.status}`
            };
          }
        }
      }

      results.push({
        competition: comp.name,
        league_id: comp.id,
        fixtures_available: fixtures.length > 0,
        total_fixtures: fixtures.length,
        sample_fixtures: fixtures.slice(0, 3).map((f: any) => ({
          id: f.fixture?.id,
          date: f.fixture?.date,
          home: f.teams?.home?.name,
          away: f.teams?.away?.name,
          status: f.fixture?.status?.short
        })),
        h2h_stats_test: h2hTest
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "UEFA competitions test complete",
        results,
        summary: {
          champions_league_available: results[0]?.fixtures_available || false,
          europa_league_available: results[1]?.fixtures_available || false,
          conference_league_available: results[2]?.fixtures_available || false,
          h2h_supported: results.some(r => r.h2h_stats_test?.available)
        }
      }, null, 2),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200 
      }
    );

  } catch (error) {
    console.error('[test-uefa] Error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage
      }),
      { 
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500 
      }
    );
  }
});
