import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

/**
 * Safe Zone Edge Function v1.0
 * 
 * Returns future fixtures ranked by probability of:
 * - Over 2.5 goals (mode: O25)
 * - Both Teams To Score (mode: BTTS)
 * 
 * Uses Poisson model + empirical data blending with clamped probabilities [0.25, 0.85]
 */

// Supported leagues (top 5 + 2nd divisions + more)
const SUPPORTED_LEAGUES: Record<number, { name: string; country: string }> = {
  // England
  39: { name: "Premier League", country: "England" },
  40: { name: "Championship", country: "England" },
  // Spain
  140: { name: "La Liga", country: "Spain" },
  141: { name: "La Liga 2", country: "Spain" },
  // Germany
  78: { name: "Bundesliga", country: "Germany" },
  79: { name: "2. Bundesliga", country: "Germany" },
  // Italy
  135: { name: "Serie A", country: "Italy" },
  136: { name: "Serie B", country: "Italy" },
  // France
  61: { name: "Ligue 1", country: "France" },
  62: { name: "Ligue 2", country: "France" },
  // Other major leagues
  94: { name: "Primeira Liga", country: "Portugal" },
  88: { name: "Eredivisie", country: "Netherlands" },
  144: { name: "Pro League", country: "Belgium" },
  203: { name: "Super Lig", country: "Turkey" },
  // UEFA
  2: { name: "Champions League", country: "UEFA" },
  3: { name: "Europa League", country: "UEFA" },
  848: { name: "Conference League", country: "UEFA" },
};

// Constants
const TEAM_SAMPLE_SIZE = 10; // Last N games for team stats
const ALPHA_O25 = 0.6;       // Model weight for O2.5
const BETA_BTTS = 0.5;       // Model weight for BTTS
const HOME_ADJ = 1.05;       // Home team adjustment
const AWAY_ADJ = 0.95;       // Away team adjustment
const MIN_PROB = 0.25;
const MAX_PROB = 0.85;

interface SafeZoneRequest {
  mode: "O25" | "BTTS";
  league_ids: number[];
  matchday?: "next" | string;
  limit?: number;
}

interface TeamStats {
  gf: number;
  ga: number;
  sample: number;
  o25_rate: number;
  btts_rate: number;
}

interface LeagueStats {
  league_id: number;
  avg_goals: number;      // AVG_TOTAL_GOALS_L
  per_team_avg: number;   // LGF = avg_goals / 2
  o25_rate: number;       // O25_L
  btts_rate: number;      // BTTS_L
  sample: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function poissonPMF(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

serve(async (req) => {
  const origin = req.headers.get("origin") || "*";

  if (req.method === "OPTIONS") {
    return handlePreflight(origin);
  }

  const startTime = Date.now();

  try {
    let body: SafeZoneRequest;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", origin, 400);
    }

    const { mode, league_ids, matchday = "next", limit = 50 } = body;

    // Validate input
    if (!mode || !["O25", "BTTS"].includes(mode)) {
      return errorResponse("mode must be 'O25' or 'BTTS'", origin, 400);
    }
    if (!league_ids || !Array.isArray(league_ids) || league_ids.length === 0) {
      return errorResponse("league_ids must be a non-empty array", origin, 400);
    }
    if (league_ids.length > 20) {
      return errorResponse("Maximum 20 leagues allowed", origin, 400);
    }

    const effectiveLimit = Math.min(Math.max(1, limit), 100);

    // Create Supabase client with service role for stats_cache access
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[safe-zone] mode=${mode}, leagues=${league_ids.join(",")}, matchday=${matchday}, limit=${effectiveLimit}`);

    // Step 1: Get fixtures for the next matchday
    const fixtures = await getNextMatchdayFixtures(supabase, league_ids, matchday, effectiveLimit);
    
    if (fixtures.length === 0) {
      return jsonResponse({
        mode,
        fixtures: [],
        meta: {
          leagues_requested: league_ids,
          matchday_mode: matchday === "next" ? "next" : "specific",
          generated_at: new Date().toISOString(),
          model_version: "safe-zone-v1",
          note: "No upcoming fixtures found for the specified leagues",
        },
      }, origin);
    }

    console.log(`[safe-zone] Found ${fixtures.length} fixtures`);

    // Step 2: Get unique leagues and teams from fixtures
    const leagueIdsInFixtures = [...new Set(fixtures.map(f => f.league_id))];
    const teamIds = new Set<number>();
    for (const f of fixtures) {
      teamIds.add(f.home_team_id);
      teamIds.add(f.away_team_id);
    }

    // Step 3: Batch compute league stats
    const leagueStatsMap = await computeLeagueStats(supabase, leagueIdsInFixtures);
    console.log(`[safe-zone] Computed stats for ${leagueStatsMap.size} leagues`);

    // Step 4: Batch compute team stats
    const teamStatsMap = await computeTeamStats(supabase, [...teamIds], leagueIdsInFixtures, mode);
    console.log(`[safe-zone] Computed stats for ${teamStatsMap.size} teams`);

    // Step 5: Calculate probabilities for each fixture
    const results = fixtures.map(fixture => {
      const leagueStats = leagueStatsMap.get(fixture.league_id);
      const homeStats = teamStatsMap.get(fixture.home_team_id);
      const awayStats = teamStatsMap.get(fixture.away_team_id);

      // Use league average as fallback
      const LGF = leagueStats?.per_team_avg || 1.3;
      const avgGoals = leagueStats?.avg_goals || 2.6;

      // Blend team stats with league average based on sample size
      const gf_home = blendWithLeague(homeStats?.gf, LGF, homeStats?.sample || 0);
      const ga_home = blendWithLeague(homeStats?.ga, LGF, homeStats?.sample || 0);
      const gf_away = blendWithLeague(awayStats?.gf, LGF, awayStats?.sample || 0);
      const ga_away = blendWithLeague(awayStats?.ga, LGF, awayStats?.sample || 0);

      // Compute attack/defense strengths
      const att_H = gf_home / LGF;
      const def_H = ga_home / LGF;
      const att_A = gf_away / LGF;
      const def_A = ga_away / LGF;

      // Expected goals (50/50 weight for attack/defense)
      const mu_home = LGF * (0.5 * att_H + 0.5 * def_A) * HOME_ADJ;
      const mu_away = LGF * (0.5 * att_A + 0.5 * def_H) * AWAY_ADJ;
      const mu_total = mu_home + mu_away;

      let probability: number;
      let o25_home_10: number | undefined;
      let o25_away_10: number | undefined;
      let btts_home_10: number | undefined;
      let btts_away_10: number | undefined;

      if (mode === "O25") {
        // Poisson model for O2.5
        const P0 = poissonPMF(0, mu_total);
        const P1 = poissonPMF(1, mu_total);
        const P2 = poissonPMF(2, mu_total);
        const P_O25_model = 1 - (P0 + P1 + P2);

        // Empirical O2.5
        o25_home_10 = homeStats?.o25_rate ?? leagueStats?.o25_rate ?? 0.5;
        o25_away_10 = awayStats?.o25_rate ?? leagueStats?.o25_rate ?? 0.5;
        const league_o25 = leagueStats?.o25_rate ?? 0.5;

        const P_O25_emp = (o25_home_10 + o25_away_10 + league_o25) / 3;

        // Blend model + empirical
        const P_O25_raw = ALPHA_O25 * P_O25_model + (1 - ALPHA_O25) * P_O25_emp;
        probability = clamp(P_O25_raw, MIN_PROB, MAX_PROB);
      } else {
        // BTTS mode
        const P_H_scores = 1 - Math.exp(-mu_home);
        const P_A_scores = 1 - Math.exp(-mu_away);
        const P_BTTS_model = P_H_scores * P_A_scores;

        // Empirical BTTS
        btts_home_10 = homeStats?.btts_rate ?? leagueStats?.btts_rate ?? 0.5;
        btts_away_10 = awayStats?.btts_rate ?? leagueStats?.btts_rate ?? 0.5;
        const league_btts = leagueStats?.btts_rate ?? 0.5;

        const P_BTTS_emp = (btts_home_10 + btts_away_10 + league_btts) / 3;

        // Blend model + empirical
        const P_BTTS_raw = BETA_BTTS * P_BTTS_model + (1 - BETA_BTTS) * P_BTTS_emp;
        probability = clamp(P_BTTS_raw, MIN_PROB, MAX_PROB);
      }

      // Determine data quality
      const minSample = Math.min(homeStats?.sample || 0, awayStats?.sample || 0);
      let data_quality: "high" | "medium" | "low";
      if (minSample >= 8) data_quality = "high";
      else if (minSample >= 5) data_quality = "medium";
      else data_quality = "low";

      const leagueName = SUPPORTED_LEAGUES[fixture.league_id]?.name || 
                         leagueStats?.league_id?.toString() || 
                         `League ${fixture.league_id}`;

      return {
        fixture_id: fixture.id,
        league_id: fixture.league_id,
        league_name: leagueName,
        kickoff_at: fixture.kickoff_at,
        home_team_id: fixture.home_team_id,
        away_team_id: fixture.away_team_id,
        home_team: fixture.home_team_name,
        away_team: fixture.away_team_name,
        mode,
        probability: Math.round(probability * 10000) / 10000,
        mu_home: Math.round(mu_home * 100) / 100,
        mu_away: Math.round(mu_away * 100) / 100,
        gf_home: Math.round(gf_home * 100) / 100,
        ga_home: Math.round(ga_home * 100) / 100,
        gf_away: Math.round(gf_away * 100) / 100,
        ga_away: Math.round(ga_away * 100) / 100,
        sample_home: homeStats?.sample || 0,
        sample_away: awayStats?.sample || 0,
        data_quality,
        ...(mode === "O25" && {
          o25_home_10: Math.round((o25_home_10 || 0) * 100) / 100,
          o25_away_10: Math.round((o25_away_10 || 0) * 100) / 100,
          league_o25: Math.round((leagueStats?.o25_rate || 0) * 100) / 100,
        }),
        ...(mode === "BTTS" && {
          btts_home_10: Math.round((btts_home_10 || 0) * 100) / 100,
          btts_away_10: Math.round((btts_away_10 || 0) * 100) / 100,
          league_btts: Math.round((leagueStats?.btts_rate || 0) * 100) / 100,
        }),
        league_avg_goals: Math.round(avgGoals * 100) / 100,
      };
    });

    // Sort by probability descending, then by kickoff ascending
    results.sort((a, b) => {
      if (b.probability !== a.probability) return b.probability - a.probability;
      return new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime();
    });

    const duration = Date.now() - startTime;
    console.log(`[safe-zone] Returning ${results.length} fixtures in ${duration}ms`);

    return jsonResponse({
      mode,
      fixtures: results,
      meta: {
        leagues_requested: league_ids,
        matchday_mode: matchday === "next" ? "next" : "specific",
        generated_at: new Date().toISOString(),
        model_version: "safe-zone-v1",
        duration_ms: duration,
      },
    }, origin);

  } catch (error) {
    console.error("[safe-zone] Unexpected error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Unknown error",
      origin,
      500,
      req
    );
  }
});

function blendWithLeague(teamValue: number | undefined, leagueAvg: number, sample: number): number {
  if (teamValue === undefined || sample === 0) return leagueAvg;
  if (sample >= 5) return teamValue;
  const weight = sample / 5;
  return weight * teamValue + (1 - weight) * leagueAvg;
}

async function getNextMatchdayFixtures(
  supabase: any,
  leagueIds: number[],
  matchday: string,
  limit: number
): Promise<any[]> {
  const nowTs = Math.floor(Date.now() / 1000);

  if (matchday !== "next") {
    // Specific date mode
    const targetDate = matchday;
    const { data, error } = await supabase
      .from("fixtures")
      .select("id, league_id, timestamp, teams_home, teams_away")
      .in("league_id", leagueIds)
      .gte("timestamp", nowTs)
      .order("timestamp", { ascending: true })
      .limit(500);

    if (error) {
      console.error("[safe-zone] Error fetching fixtures:", error);
      return [];
    }

    return (data || [])
      .filter((f: any) => {
        const date = new Date(f.timestamp * 1000).toISOString().split("T")[0];
        return date === targetDate;
      })
      .slice(0, limit)
      .map(parseFixture);
  }

  // "next" matchday mode: get earliest future date per league, then all fixtures on that date
  const { data: allFixtures, error } = await supabase
    .from("fixtures")
    .select("id, league_id, timestamp, teams_home, teams_away")
    .in("league_id", leagueIds)
    .gte("timestamp", nowTs)
    .order("timestamp", { ascending: true })
    .limit(1000);

  if (error) {
    console.error("[safe-zone] Error fetching fixtures:", error);
    return [];
  }

  // Find next matchday per league
  const nextMatchdayByLeague = new Map<number, string>();
  for (const f of allFixtures || []) {
    const date = new Date(f.timestamp * 1000).toISOString().split("T")[0];
    if (!nextMatchdayByLeague.has(f.league_id)) {
      nextMatchdayByLeague.set(f.league_id, date);
    }
  }

  // Filter to only fixtures on the next matchday for each league
  const results = (allFixtures || [])
    .filter((f: any) => {
      const date = new Date(f.timestamp * 1000).toISOString().split("T")[0];
      return nextMatchdayByLeague.get(f.league_id) === date;
    })
    .slice(0, limit)
    .map(parseFixture);

  return results;
}

function parseFixture(f: any): any {
  return {
    id: f.id,
    league_id: f.league_id,
    kickoff_at: new Date(f.timestamp * 1000).toISOString(),
    home_team_id: parseInt(String(f.teams_home?.id)) || 0,
    away_team_id: parseInt(String(f.teams_away?.id)) || 0,
    home_team_name: f.teams_home?.name || `Team ${f.teams_home?.id}`,
    away_team_name: f.teams_away?.name || `Team ${f.teams_away?.id}`,
  };
}

async function computeLeagueStats(
  supabase: any,
  leagueIds: number[]
): Promise<Map<number, LeagueStats>> {
  const result = new Map<number, LeagueStats>();

  // Get last 12 months of results for each league
  const lookbackDate = new Date();
  lookbackDate.setMonth(lookbackDate.getMonth() - 12);
  const lookbackStr = lookbackDate.toISOString();

  const { data: results, error } = await supabase
    .from("fixture_results")
    .select("league_id, goals_home, goals_away")
    .in("league_id", leagueIds)
    .in("status", ["FT", "AET", "PEN"])
    .gte("kickoff_at", lookbackStr)
    .limit(5000);

  if (error) {
    console.error("[safe-zone] Error fetching league stats:", error);
    return result;
  }

  // Aggregate by league
  const leagueData = new Map<number, { goals: number; matches: number; o25: number; btts: number }>();
  
  for (const r of results || []) {
    if (!leagueData.has(r.league_id)) {
      leagueData.set(r.league_id, { goals: 0, matches: 0, o25: 0, btts: 0 });
    }
    const data = leagueData.get(r.league_id)!;
    data.goals += (r.goals_home || 0) + (r.goals_away || 0);
    data.matches++;
    if ((r.goals_home || 0) + (r.goals_away || 0) >= 3) data.o25++;
    if (r.goals_home > 0 && r.goals_away > 0) data.btts++;
  }

  for (const [leagueId, data] of leagueData) {
    const avgGoals = data.matches > 0 ? data.goals / data.matches : 2.6;
    result.set(leagueId, {
      league_id: leagueId,
      avg_goals: avgGoals,
      per_team_avg: avgGoals / 2,
      o25_rate: data.matches > 0 ? data.o25 / data.matches : 0.5,
      btts_rate: data.matches > 0 ? data.btts / data.matches : 0.5,
      sample: data.matches,
    });
  }

  return result;
}

async function computeTeamStats(
  supabase: any,
  teamIds: number[],
  leagueIds: number[],
  mode: "O25" | "BTTS"
): Promise<Map<number, TeamStats>> {
  const result = new Map<number, TeamStats>();

  // Get recent fixture results with fixture data for team info
  const lookbackDate = new Date();
  lookbackDate.setMonth(lookbackDate.getMonth() - 18);
  const lookbackStr = lookbackDate.toISOString();

  const { data: results, error } = await supabase
    .from("fixture_results")
    .select(`
      fixture_id,
      league_id,
      goals_home,
      goals_away,
      kickoff_at,
      fixtures!fixture_results_fixture_id_fkey(
        teams_home,
        teams_away
      )
    `)
    .in("league_id", leagueIds)
    .in("status", ["FT", "AET", "PEN"])
    .gte("kickoff_at", lookbackStr)
    .order("kickoff_at", { ascending: false })
    .limit(5000);

  if (error) {
    console.error("[safe-zone] Error fetching team stats:", error);
    return result;
  }

  // Build team match history
  const teamMatches = new Map<number, Array<{
    gf: number;
    ga: number;
    btts: boolean;
    o25: boolean;
    kickoff: string;
  }>>();

  for (const r of results || []) {
    const fixture = Array.isArray(r.fixtures) ? r.fixtures[0] : r.fixtures;
    if (!fixture) continue;

    const homeTeamId = parseInt(String(fixture.teams_home?.id));
    const awayTeamId = parseInt(String(fixture.teams_away?.id));

    if (isNaN(homeTeamId) || isNaN(awayTeamId)) continue;

    const totalGoals = (r.goals_home || 0) + (r.goals_away || 0);
    const btts = r.goals_home > 0 && r.goals_away > 0;
    const o25 = totalGoals >= 3;

    // Add home team match
    if (teamIds.includes(homeTeamId)) {
      if (!teamMatches.has(homeTeamId)) teamMatches.set(homeTeamId, []);
      teamMatches.get(homeTeamId)!.push({
        gf: r.goals_home || 0,
        ga: r.goals_away || 0,
        btts,
        o25,
        kickoff: r.kickoff_at,
      });
    }

    // Add away team match
    if (teamIds.includes(awayTeamId)) {
      if (!teamMatches.has(awayTeamId)) teamMatches.set(awayTeamId, []);
      teamMatches.get(awayTeamId)!.push({
        gf: r.goals_away || 0,
        ga: r.goals_home || 0,
        btts,
        o25,
        kickoff: r.kickoff_at,
      });
    }
  }

  // Calculate stats from last N matches
  for (const [teamId, matches] of teamMatches) {
    // Sort by kickoff descending and take last N
    matches.sort((a, b) => new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime());
    const lastN = matches.slice(0, TEAM_SAMPLE_SIZE);
    const sample = lastN.length;

    if (sample === 0) continue;

    const gf = lastN.reduce((sum, m) => sum + m.gf, 0) / sample;
    const ga = lastN.reduce((sum, m) => sum + m.ga, 0) / sample;
    const o25_count = lastN.filter(m => m.o25).length;
    const btts_count = lastN.filter(m => m.btts).length;

    result.set(teamId, {
      gf,
      ga,
      sample,
      o25_rate: o25_count / sample,
      btts_rate: btts_count / sample,
    });
  }

  // Also try to get BTTS metrics from cached table for BTTS mode
  if (mode === "BTTS") {
    const { data: bttsMetrics } = await supabase
      .from("team_btts_metrics")
      .select("team_id, btts_10_rate, sample_10")
      .in("team_id", teamIds);

    for (const m of bttsMetrics || []) {
      const existing = result.get(m.team_id);
      // If cached data has better sample, use it for BTTS rate
      if (m.sample_10 >= 8 && (!existing || existing.sample < 8)) {
        result.set(m.team_id, {
          gf: existing?.gf || 0,
          ga: existing?.ga || 0,
          sample: existing?.sample || 0,
          o25_rate: existing?.o25_rate || 0.5,
          btts_rate: m.btts_10_rate / 100, // Convert from percentage
        });
      }
    }
  }

  return result;
}
