import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Hardcoded allowed fixture IDs - SECURITY: only these fixtures can be queried
const ALLOWED_FIXTURE_IDS = [
  1379118, // Wolves vs Man Utd
  1379113, // Fulham vs Crystal Palace
  1390965, // Real Madrid vs Celta Vigo
  1390967, // Valencia vs Sevilla
  1390963, // Espanyol vs Rayo Vallecano
  1390964, // Osasuna vs Levante
  1378001, // Torino vs AC Milan
  1377998, // Napoli vs Juventus
  1377997, // Lazio vs Bologna
  1377994, // Cagliari vs AS Roma
  1378002, // Udinese vs Genoa
  1387828, // Lorient vs Lyon
];

// Simple in-memory rate limiting (10 requests per minute per IP)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  
  if (entry.count >= RATE_LIMIT) {
    return false;
  }
  
  entry.count++;
  return true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Rate limiting by IP
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';
    if (!checkRateLimit(ip)) {
      console.log(`[demo-fixtures] Rate limit exceeded for IP: ${ip}`);
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { mode, fixture_id } = await req.json();
    console.log(`[demo-fixtures] Request: mode=${mode}, fixture_id=${fixture_id}`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // MODE: list - Return all demo fixtures
    if (mode === 'list') {
      const { data: fixtures, error: fixturesError } = await supabase
        .from('fixtures')
        .select(`
          id,
          league_id,
          date,
          teams_home,
          teams_away,
          leagues!inner(name)
        `)
        .in('id', ALLOWED_FIXTURE_IDS);

      if (fixturesError) {
        console.error('[demo-fixtures] Error fetching fixtures:', fixturesError);
        throw fixturesError;
      }

      // Get results for all demo fixtures
      const { data: results, error: resultsError } = await supabase
        .from('fixture_results')
        .select('*')
        .in('fixture_id', ALLOWED_FIXTURE_IDS);

      if (resultsError) {
        console.error('[demo-fixtures] Error fetching results:', resultsError);
      }

      const resultsMap = new Map(results?.map(r => [r.fixture_id, r]) || []);

      const formattedFixtures = fixtures?.map(f => {
        const result = resultsMap.get(f.id);
        return {
          fixture_id: f.id,
          league_id: f.league_id,
          league_name: (f.leagues as any)?.name || 'Unknown League',
          home_team: (f.teams_home as any)?.name || 'Home',
          away_team: (f.teams_away as any)?.name || 'Away',
          home_logo: (f.teams_home as any)?.logo || '',
          away_logo: (f.teams_away as any)?.logo || '',
          kickoff_at: f.date,
          score: result ? {
            home: result.goals_home,
            away: result.goals_away
          } : null,
          stats: result ? {
            corners_home: result.corners_home,
            corners_away: result.corners_away,
            cards_home: result.cards_home,
            cards_away: result.cards_away
          } : null
        };
      }) || [];

      return new Response(
        JSON.stringify({
          fixtures: formattedFixtures,
          metadata: {
            count: formattedFixtures.length,
            matchday: "December 7-8, 2025",
            leagues: ["Premier League", "La Liga", "Serie A", "Ligue 1"],
            note: "Demo Mode - past matches only, not live tips"
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // MODE: details - Return detailed stats for a single fixture
    if (mode === 'details') {
      // SECURITY: Validate fixture_id is in allowed list
      if (!fixture_id || !ALLOWED_FIXTURE_IDS.includes(fixture_id)) {
        console.log(`[demo-fixtures] Rejected invalid fixture_id: ${fixture_id}`);
        return new Response(
          JSON.stringify({ error: 'Invalid fixture ID for demo mode' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get fixture details
      const { data: fixture, error: fixtureError } = await supabase
        .from('fixtures')
        .select(`
          id,
          league_id,
          date,
          teams_home,
          teams_away,
          leagues!inner(name)
        `)
        .eq('id', fixture_id)
        .single();

      if (fixtureError || !fixture) {
        console.error('[demo-fixtures] Fixture not found:', fixtureError);
        return new Response(
          JSON.stringify({ error: 'Fixture not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get result
      const { data: result } = await supabase
        .from('fixture_results')
        .select('*')
        .eq('fixture_id', fixture_id)
        .single();

      // Get team IDs
      const homeTeamId = (fixture.teams_home as any)?.id;
      const awayTeamId = (fixture.teams_away as any)?.id;

      // Get team stats (if available)
      const { data: homeStats } = await supabase
        .from('stats_cache')
        .select('*')
        .eq('team_id', homeTeamId)
        .single();

      const { data: awayStats } = await supabase
        .from('stats_cache')
        .select('*')
        .eq('team_id', awayTeamId)
        .single();

      // Get H2H data
      const { data: h2h } = await supabase
        .from('h2h_cache')
        .select('*')
        .or(`and(team1_id.eq.${homeTeamId},team2_id.eq.${awayTeamId}),and(team1_id.eq.${awayTeamId},team2_id.eq.${homeTeamId})`)
        .single();

      // Get BTTS metrics
      const { data: homeBtts } = await supabase
        .from('team_btts_metrics')
        .select('*')
        .eq('team_id', homeTeamId)
        .eq('league_id', fixture.league_id)
        .single();

      const { data: awayBtts } = await supabase
        .from('team_btts_metrics')
        .select('*')
        .eq('team_id', awayTeamId)
        .eq('league_id', fixture.league_id)
        .single();

      return new Response(
        JSON.stringify({
          fixture: {
            fixture_id: fixture.id,
            league_id: fixture.league_id,
            league_name: (fixture.leagues as any)?.name || 'Unknown League',
            home_team: (fixture.teams_home as any)?.name || 'Home',
            away_team: (fixture.teams_away as any)?.name || 'Away',
            home_logo: (fixture.teams_home as any)?.logo || '',
            away_logo: (fixture.teams_away as any)?.logo || '',
            home_team_id: homeTeamId,
            away_team_id: awayTeamId,
            kickoff_at: fixture.date
          },
          result: result ? {
            goals_home: result.goals_home,
            goals_away: result.goals_away,
            corners_home: result.corners_home,
            corners_away: result.corners_away,
            cards_home: result.cards_home,
            cards_away: result.cards_away,
            fouls_home: result.fouls_home,
            fouls_away: result.fouls_away
          } : null,
          team_stats: {
            home: homeStats ? {
              goals: homeStats.goals,
              corners: homeStats.corners,
              cards: homeStats.cards,
              fouls: homeStats.fouls,
              sample_size: homeStats.sample_size
            } : null,
            away: awayStats ? {
              goals: awayStats.goals,
              corners: awayStats.corners,
              cards: awayStats.cards,
              fouls: awayStats.fouls,
              sample_size: awayStats.sample_size
            } : null
          },
          h2h: h2h ? {
            goals: h2h.goals,
            corners: h2h.corners,
            cards: h2h.cards,
            sample_size: h2h.sample_size
          } : null,
          btts: {
            home: homeBtts ? {
              btts_5_rate: homeBtts.btts_5_rate,
              btts_10_rate: homeBtts.btts_10_rate,
              sample_5: homeBtts.sample_5,
              sample_10: homeBtts.sample_10
            } : null,
            away: awayBtts ? {
              btts_5_rate: awayBtts.btts_5_rate,
              btts_10_rate: awayBtts.btts_10_rate,
              sample_5: awayBtts.sample_5,
              sample_10: awayBtts.sample_10
            } : null
          },
          demo_note: "This is historical data from a finished match. For live tips on upcoming games, create an account."
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid mode. Use "list" or "details"' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[demo-fixtures] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
