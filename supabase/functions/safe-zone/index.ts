import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

/**
 * Safe Zone Edge Function v2.0
 * 
 * Returns future fixtures ranked by probability of:
 * - Over 2.5 goals (mode: O25)
 * - Both Teams To Score (mode: BTTS)
 * - High Corners Over 9.5 (mode: CORNERS)
 * - High Fouls Over 25.5 (mode: FOULS)
 * 
 * Uses Poisson/linear models + empirical data blending with clamped probabilities
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

// League-specific thresholds for corners and fouls (based on research)
const LEAGUE_THRESHOLDS: Record<number, { corners_line: number; fouls_line: number }> = {
  // England - moderate corners/fouls
  39: { corners_line: 9.5, fouls_line: 23.5 },
  40: { corners_line: 10.5, fouls_line: 24.5 }, // Championship higher corners
  // Spain - La Liga moderate fouls
  140: { corners_line: 9.5, fouls_line: 25.5 },
  141: { corners_line: 9.5, fouls_line: 24.5 },
  // Germany - lower fouls
  78: { corners_line: 9.5, fouls_line: 22.5 },
  79: { corners_line: 9.5, fouls_line: 23.5 },
  // Italy - higher fouls
  135: { corners_line: 9.5, fouls_line: 27.5 },
  136: { corners_line: 9.5, fouls_line: 26.5 },
  // France
  61: { corners_line: 9.5, fouls_line: 24.5 },
  62: { corners_line: 9.5, fouls_line: 24.5 },
  // Portugal - highest fouls
  94: { corners_line: 9.5, fouls_line: 28.5 },
  // Netherlands - highest corners
  88: { corners_line: 10.5, fouls_line: 24.5 },
  // Belgium
  144: { corners_line: 10.5, fouls_line: 25.5 },
  // Turkey
  203: { corners_line: 9.5, fouls_line: 26.5 },
  // UEFA
  2: { corners_line: 9.5, fouls_line: 24.5 },
  3: { corners_line: 9.5, fouls_line: 25.5 },
  848: { corners_line: 9.5, fouls_line: 25.5 },
};

// Constants
const TEAM_SAMPLE_SIZE = 10; // Last N games for team stats
const ALPHA_O25 = 0.6;       // Model weight for O2.5
const BETA_BTTS = 0.5;       // Model weight for BTTS
const ALPHA_CORNERS = 0.55;  // Model weight for corners
const ALPHA_FOULS = 0.5;     // Model weight for fouls
const HOME_ADJ = 1.05;       // Home team adjustment
const AWAY_ADJ = 0.95;       // Away team adjustment

// Mode-specific probability bounds
const PROB_BOUNDS = {
  O25: { min: 0.25, max: 0.85 },
  BTTS: { min: 0.25, max: 0.85 },
  CORNERS: { min: 0.30, max: 0.80 },
  FOULS: { min: 0.25, max: 0.85 },
};

type Mode = "O25" | "BTTS" | "CORNERS" | "FOULS";

interface SafeZoneRequest {
  mode: Mode;
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
  // Corners
  corners_for: number;
  corners_against: number;
  corners_total: number;
  over_corners_rate: number;
  corners_sample: number;
  // Fouls
  fouls_committed: number;
  fouls_suffered: number;
  fouls_total: number;
  over_fouls_rate: number;
  fouls_sample: number;
}

interface LeagueStats {
  league_id: number;
  avg_goals: number;
  per_team_avg: number;
  o25_rate: number;
  btts_rate: number;
  sample: number;
  // Corners
  avg_corners: number;
  over_corners_rate: number;
  corners_sample: number;
  // Fouls
  avg_fouls: number;
  over_fouls_rate: number;
  fouls_sample: number;
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

// Compute P(X >= threshold) for Poisson distribution
function poissonCDFComplement(threshold: number, lambda: number): number {
  let cdf = 0;
  for (let k = 0; k < threshold; k++) {
    cdf += poissonPMF(k, lambda);
  }
  return 1 - cdf;
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
    if (!mode || !["O25", "BTTS", "CORNERS", "FOULS"].includes(mode)) {
      return errorResponse("mode must be 'O25', 'BTTS', 'CORNERS', or 'FOULS'", origin, 400);
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
          model_version: "safe-zone-v2",
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

    // Step 3: Batch compute league stats (includes corners/fouls for new modes)
    const leagueStatsMap = await computeLeagueStats(supabase, leagueIdsInFixtures, mode);
    console.log(`[safe-zone] Computed stats for ${leagueStatsMap.size} leagues`);

    // Step 4: Batch compute team stats (includes corners/fouls for new modes)
    const teamStatsMap = await computeTeamStats(supabase, [...teamIds], leagueIdsInFixtures, mode);
    console.log(`[safe-zone] Computed stats for ${teamStatsMap.size} teams`);

    // Step 5: Calculate probabilities for each fixture
    const results = fixtures.map(fixture => {
      const leagueStats = leagueStatsMap.get(fixture.league_id);
      const homeStats = teamStatsMap.get(fixture.home_team_id);
      const awayStats = teamStatsMap.get(fixture.away_team_id);

      const bounds = PROB_BOUNDS[mode];
      const thresholds = LEAGUE_THRESHOLDS[fixture.league_id] || { corners_line: 9.5, fouls_line: 25.5 };

      // Use league average as fallback
      const LGF = leagueStats?.per_team_avg || 1.3;
      const avgGoals = leagueStats?.avg_goals || 2.6;
      const avgCorners = leagueStats?.avg_corners || 10;
      const avgFouls = leagueStats?.avg_fouls || 24;

      // Blend team stats with league average based on sample size
      const gf_home = blendWithLeague(homeStats?.gf, LGF, homeStats?.sample || 0);
      const ga_home = blendWithLeague(homeStats?.ga, LGF, homeStats?.sample || 0);
      const gf_away = blendWithLeague(awayStats?.gf, LGF, awayStats?.sample || 0);
      const ga_away = blendWithLeague(awayStats?.ga, LGF, awayStats?.sample || 0);

      // Compute attack/defense strengths for goals
      const att_H = gf_home / LGF;
      const def_H = ga_home / LGF;
      const att_A = gf_away / LGF;
      const def_A = ga_away / LGF;

      // Expected goals (50/50 weight for attack/defense)
      const mu_home = LGF * (0.5 * att_H + 0.5 * def_A) * HOME_ADJ;
      const mu_away = LGF * (0.5 * att_A + 0.5 * def_H) * AWAY_ADJ;
      const mu_total = mu_home + mu_away;

      let probability: number;
      let extraFields: Record<string, any> = {};

      if (mode === "O25") {
        // Poisson model for O2.5
        const P0 = poissonPMF(0, mu_total);
        const P1 = poissonPMF(1, mu_total);
        const P2 = poissonPMF(2, mu_total);
        const P_O25_model = 1 - (P0 + P1 + P2);

        // Empirical O2.5
        const o25_home_10 = homeStats?.o25_rate ?? leagueStats?.o25_rate ?? 0.5;
        const o25_away_10 = awayStats?.o25_rate ?? leagueStats?.o25_rate ?? 0.5;
        const league_o25 = leagueStats?.o25_rate ?? 0.5;

        const P_O25_emp = (o25_home_10 + o25_away_10 + league_o25) / 3;

        // Blend model + empirical
        const P_O25_raw = ALPHA_O25 * P_O25_model + (1 - ALPHA_O25) * P_O25_emp;
        probability = clamp(P_O25_raw, bounds.min, bounds.max);

        extraFields = {
          o25_home_10: Math.round(o25_home_10 * 100) / 100,
          o25_away_10: Math.round(o25_away_10 * 100) / 100,
          league_o25: Math.round(league_o25 * 100) / 100,
        };
      } else if (mode === "BTTS") {
        // BTTS mode
        const P_H_scores = 1 - Math.exp(-mu_home);
        const P_A_scores = 1 - Math.exp(-mu_away);
        const P_BTTS_model = P_H_scores * P_A_scores;

        // Empirical BTTS
        const btts_home_10 = homeStats?.btts_rate ?? leagueStats?.btts_rate ?? 0.5;
        const btts_away_10 = awayStats?.btts_rate ?? leagueStats?.btts_rate ?? 0.5;
        const league_btts = leagueStats?.btts_rate ?? 0.5;

        const P_BTTS_emp = (btts_home_10 + btts_away_10 + league_btts) / 3;

        // Blend model + empirical
        const P_BTTS_raw = BETA_BTTS * P_BTTS_model + (1 - BETA_BTTS) * P_BTTS_emp;
        probability = clamp(P_BTTS_raw, bounds.min, bounds.max);

        extraFields = {
          btts_home_10: Math.round(btts_home_10 * 100) / 100,
          btts_away_10: Math.round(btts_away_10 * 100) / 100,
          league_btts: Math.round(league_btts * 100) / 100,
        };
      } else if (mode === "CORNERS") {
        // High Corners mode
        const LCF = avgCorners / 2; // League corners per team
        
        // Blend corners stats
        const cf_home = blendWithLeague(homeStats?.corners_for, LCF, homeStats?.corners_sample || 0);
        const ca_home = blendWithLeague(homeStats?.corners_against, LCF, homeStats?.corners_sample || 0);
        const cf_away = blendWithLeague(awayStats?.corners_for, LCF, awayStats?.corners_sample || 0);
        const ca_away = blendWithLeague(awayStats?.corners_against, LCF, awayStats?.corners_sample || 0);

        // Corners attack/defense
        const c_att_H = cf_home / LCF;
        const c_def_H = ca_home / LCF;
        const c_att_A = cf_away / LCF;
        const c_def_A = ca_away / LCF;

        // Expected corners
        const mu_corners_home = LCF * (0.5 * c_att_H + 0.5 * c_def_A) * HOME_ADJ;
        const mu_corners_away = LCF * (0.5 * c_att_A + 0.5 * c_def_H) * AWAY_ADJ;
        const mu_corners_total = mu_corners_home + mu_corners_away;

        // Poisson model for Over X.5 corners
        const P_over_corners_model = poissonCDFComplement(Math.ceil(thresholds.corners_line), mu_corners_total);

        // Empirical corners rates
        const corners_rate_home = homeStats?.over_corners_rate ?? leagueStats?.over_corners_rate ?? 0.5;
        const corners_rate_away = awayStats?.over_corners_rate ?? leagueStats?.over_corners_rate ?? 0.5;
        const league_corners_rate = leagueStats?.over_corners_rate ?? 0.5;

        const P_corners_emp = (corners_rate_home + corners_rate_away + league_corners_rate) / 3;

        // Blend model + empirical
        const P_corners_raw = ALPHA_CORNERS * P_over_corners_model + (1 - ALPHA_CORNERS) * P_corners_emp;
        probability = clamp(P_corners_raw, bounds.min, bounds.max);

        extraFields = {
          mu_corners_home: Math.round(mu_corners_home * 100) / 100,
          mu_corners_away: Math.round(mu_corners_away * 100) / 100,
          mu_corners_total: Math.round(mu_corners_total * 100) / 100,
          corners_for_home: Math.round(cf_home * 100) / 100,
          corners_against_home: Math.round(ca_home * 100) / 100,
          corners_for_away: Math.round(cf_away * 100) / 100,
          corners_against_away: Math.round(ca_away * 100) / 100,
          over_corners_rate_home: Math.round(corners_rate_home * 100) / 100,
          over_corners_rate_away: Math.round(corners_rate_away * 100) / 100,
          league_avg_corners: Math.round(avgCorners * 100) / 100,
          corners_line: thresholds.corners_line,
        };
      } else {
        // FOULS mode
        const LFF = avgFouls / 2; // League fouls per team
        
        // Blend fouls stats
        const ff_home = blendWithLeague(homeStats?.fouls_committed, LFF, homeStats?.fouls_sample || 0);
        const fs_home = blendWithLeague(homeStats?.fouls_suffered, LFF, homeStats?.fouls_sample || 0);
        const ff_away = blendWithLeague(awayStats?.fouls_committed, LFF, awayStats?.fouls_sample || 0);
        const fs_away = blendWithLeague(awayStats?.fouls_suffered, LFF, awayStats?.fouls_sample || 0);

        // Expected fouls (simpler linear model - fouls are less Poisson-distributed)
        const mu_fouls_home = (ff_home + fs_away) / 2 * HOME_ADJ;
        const mu_fouls_away = (ff_away + fs_home) / 2 * AWAY_ADJ;
        const mu_fouls_total = mu_fouls_home + mu_fouls_away;

        // Linear probability estimate for over threshold
        // Higher mu_fouls → higher probability, scaled against league average
        const fouls_ratio = mu_fouls_total / avgFouls;
        const P_over_fouls_model = clamp(0.5 + (fouls_ratio - 1) * 0.4, 0.2, 0.9);

        // Empirical fouls rates
        const fouls_rate_home = homeStats?.over_fouls_rate ?? leagueStats?.over_fouls_rate ?? 0.5;
        const fouls_rate_away = awayStats?.over_fouls_rate ?? leagueStats?.over_fouls_rate ?? 0.5;
        const league_fouls_rate = leagueStats?.over_fouls_rate ?? 0.5;

        const P_fouls_emp = (fouls_rate_home + fouls_rate_away + league_fouls_rate) / 3;

        // Blend model + empirical
        const P_fouls_raw = ALPHA_FOULS * P_over_fouls_model + (1 - ALPHA_FOULS) * P_fouls_emp;
        probability = clamp(P_fouls_raw, bounds.min, bounds.max);

        extraFields = {
          mu_fouls_home: Math.round(mu_fouls_home * 100) / 100,
          mu_fouls_away: Math.round(mu_fouls_away * 100) / 100,
          mu_fouls_total: Math.round(mu_fouls_total * 100) / 100,
          fouls_committed_home: Math.round(ff_home * 100) / 100,
          fouls_suffered_home: Math.round(fs_home * 100) / 100,
          fouls_committed_away: Math.round(ff_away * 100) / 100,
          fouls_suffered_away: Math.round(fs_away * 100) / 100,
          over_fouls_rate_home: Math.round(fouls_rate_home * 100) / 100,
          over_fouls_rate_away: Math.round(fouls_rate_away * 100) / 100,
          league_avg_fouls: Math.round(avgFouls * 100) / 100,
          fouls_line: thresholds.fouls_line,
        };
      }

      // Determine data quality based on mode
      let minSample: number;
      if (mode === "CORNERS") {
        minSample = Math.min(homeStats?.corners_sample || 0, awayStats?.corners_sample || 0);
      } else if (mode === "FOULS") {
        minSample = Math.min(homeStats?.fouls_sample || 0, awayStats?.fouls_sample || 0);
      } else {
        minSample = Math.min(homeStats?.sample || 0, awayStats?.sample || 0);
      }

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
        league_avg_goals: Math.round(avgGoals * 100) / 100,
        ...extraFields,
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
        model_version: "safe-zone-v2",
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
  leagueIds: number[],
  mode: Mode
): Promise<Map<number, LeagueStats>> {
  const result = new Map<number, LeagueStats>();

  // Get last 12 months of results for each league
  const lookbackDate = new Date();
  lookbackDate.setMonth(lookbackDate.getMonth() - 12);
  const lookbackStr = lookbackDate.toISOString();

  // Include corners and fouls when needed
  const selectFields = mode === "CORNERS" || mode === "FOULS"
    ? "league_id, goals_home, goals_away, corners_home, corners_away, fouls_home, fouls_away"
    : "league_id, goals_home, goals_away";

  const { data: results, error } = await supabase
    .from("fixture_results")
    .select(selectFields)
    .in("league_id", leagueIds)
    .in("status", ["FT", "AET", "PEN"])
    .gte("kickoff_at", lookbackStr)
    .limit(5000);

  if (error) {
    console.error("[safe-zone] Error fetching league stats:", error);
    return result;
  }

  // Aggregate by league
  const leagueData = new Map<number, {
    goals: number;
    matches: number;
    o25: number;
    btts: number;
    corners: number;
    corners_matches: number;
    over_corners: number;
    fouls: number;
    fouls_matches: number;
    over_fouls: number;
  }>();

  for (const r of results || []) {
    if (!leagueData.has(r.league_id)) {
      leagueData.set(r.league_id, {
        goals: 0, matches: 0, o25: 0, btts: 0,
        corners: 0, corners_matches: 0, over_corners: 0,
        fouls: 0, fouls_matches: 0, over_fouls: 0,
      });
    }
    const data = leagueData.get(r.league_id)!;
    
    // Goals
    data.goals += (r.goals_home || 0) + (r.goals_away || 0);
    data.matches++;
    if ((r.goals_home || 0) + (r.goals_away || 0) >= 3) data.o25++;
    if (r.goals_home > 0 && r.goals_away > 0) data.btts++;

    // Corners
    if (r.corners_home !== null && r.corners_away !== null) {
      const totalCorners = r.corners_home + r.corners_away;
      data.corners += totalCorners;
      data.corners_matches++;
      const thresholds = LEAGUE_THRESHOLDS[r.league_id] || { corners_line: 9.5 };
      if (totalCorners > thresholds.corners_line) data.over_corners++;
    }

    // Fouls
    if (r.fouls_home !== null && r.fouls_away !== null) {
      const totalFouls = r.fouls_home + r.fouls_away;
      data.fouls += totalFouls;
      data.fouls_matches++;
      const thresholds = LEAGUE_THRESHOLDS[r.league_id] || { fouls_line: 25.5 };
      if (totalFouls > thresholds.fouls_line) data.over_fouls++;
    }
  }

  for (const [leagueId, data] of leagueData) {
    const avgGoals = data.matches > 0 ? data.goals / data.matches : 2.6;
    const avgCorners = data.corners_matches > 0 ? data.corners / data.corners_matches : 10;
    const avgFouls = data.fouls_matches > 0 ? data.fouls / data.fouls_matches : 24;

    result.set(leagueId, {
      league_id: leagueId,
      avg_goals: avgGoals,
      per_team_avg: avgGoals / 2,
      o25_rate: data.matches > 0 ? data.o25 / data.matches : 0.5,
      btts_rate: data.matches > 0 ? data.btts / data.matches : 0.5,
      sample: data.matches,
      avg_corners: avgCorners,
      over_corners_rate: data.corners_matches > 0 ? data.over_corners / data.corners_matches : 0.5,
      corners_sample: data.corners_matches,
      avg_fouls: avgFouls,
      over_fouls_rate: data.fouls_matches > 0 ? data.over_fouls / data.fouls_matches : 0.5,
      fouls_sample: data.fouls_matches,
    });
  }

  return result;
}

async function computeTeamStats(
  supabase: any,
  teamIds: number[],
  leagueIds: number[],
  mode: Mode
): Promise<Map<number, TeamStats>> {
  const result = new Map<number, TeamStats>();

  // Get recent fixture results with fixture data for team info
  const lookbackDate = new Date();
  lookbackDate.setMonth(lookbackDate.getMonth() - 18);
  const lookbackStr = lookbackDate.toISOString();

  // Include corners and fouls when needed
  const selectFields = mode === "CORNERS" || mode === "FOULS"
    ? `fixture_id, league_id, goals_home, goals_away, corners_home, corners_away, fouls_home, fouls_away, kickoff_at,
       fixtures!fixture_results_fixture_id_fkey(teams_home, teams_away)`
    : `fixture_id, league_id, goals_home, goals_away, kickoff_at,
       fixtures!fixture_results_fixture_id_fkey(teams_home, teams_away)`;

  const { data: results, error } = await supabase
    .from("fixture_results")
    .select(selectFields)
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
    league_id: number;
    // Corners
    corners_for?: number;
    corners_against?: number;
    // Fouls
    fouls_committed?: number;
    fouls_suffered?: number;
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
        league_id: r.league_id,
        corners_for: r.corners_home,
        corners_against: r.corners_away,
        fouls_committed: r.fouls_home,
        fouls_suffered: r.fouls_away,
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
        league_id: r.league_id,
        corners_for: r.corners_away,
        corners_against: r.corners_home,
        fouls_committed: r.fouls_away,
        fouls_suffered: r.fouls_home,
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

    // Corners stats
    const cornersMatches = lastN.filter(m => m.corners_for !== undefined && m.corners_for !== null);
    const corners_sample = cornersMatches.length;
    let corners_for = 0, corners_against = 0, corners_total = 0, over_corners_count = 0;
    if (corners_sample > 0) {
      corners_for = cornersMatches.reduce((sum, m) => sum + (m.corners_for || 0), 0) / corners_sample;
      corners_against = cornersMatches.reduce((sum, m) => sum + (m.corners_against || 0), 0) / corners_sample;
      corners_total = corners_for + corners_against;
      // Count over threshold (using average league threshold)
      over_corners_count = cornersMatches.filter(m => {
        const total = (m.corners_for || 0) + (m.corners_against || 0);
        const thresholds = LEAGUE_THRESHOLDS[m.league_id] || { corners_line: 9.5 };
        return total > thresholds.corners_line;
      }).length;
    }

    // Fouls stats
    const foulsMatches = lastN.filter(m => m.fouls_committed !== undefined && m.fouls_committed !== null);
    const fouls_sample = foulsMatches.length;
    let fouls_committed = 0, fouls_suffered = 0, fouls_total = 0, over_fouls_count = 0;
    if (fouls_sample > 0) {
      fouls_committed = foulsMatches.reduce((sum, m) => sum + (m.fouls_committed || 0), 0) / fouls_sample;
      fouls_suffered = foulsMatches.reduce((sum, m) => sum + (m.fouls_suffered || 0), 0) / fouls_sample;
      fouls_total = fouls_committed + fouls_suffered;
      // Count over threshold
      over_fouls_count = foulsMatches.filter(m => {
        const total = (m.fouls_committed || 0) + (m.fouls_suffered || 0);
        const thresholds = LEAGUE_THRESHOLDS[m.league_id] || { fouls_line: 25.5 };
        return total > thresholds.fouls_line;
      }).length;
    }

    result.set(teamId, {
      gf,
      ga,
      sample,
      o25_rate: o25_count / sample,
      btts_rate: btts_count / sample,
      // Corners
      corners_for,
      corners_against,
      corners_total,
      over_corners_rate: corners_sample > 0 ? over_corners_count / corners_sample : 0.5,
      corners_sample,
      // Fouls
      fouls_committed,
      fouls_suffered,
      fouls_total,
      over_fouls_rate: fouls_sample > 0 ? over_fouls_count / fouls_sample : 0.5,
      fouls_sample,
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
          // Corners
          corners_for: existing?.corners_for || 0,
          corners_against: existing?.corners_against || 0,
          corners_total: existing?.corners_total || 0,
          over_corners_rate: existing?.over_corners_rate || 0.5,
          corners_sample: existing?.corners_sample || 0,
          // Fouls
          fouls_committed: existing?.fouls_committed || 0,
          fouls_suffered: existing?.fouls_suffered || 0,
          fouls_total: existing?.fouls_total || 0,
          over_fouls_rate: existing?.over_fouls_rate || 0.5,
          fouls_sample: existing?.fouls_sample || 0,
        });
      }
    }
  }

  return result;
}
