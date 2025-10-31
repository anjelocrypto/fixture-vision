import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// Inlined API utilities (moved here to avoid cross-file import boot issues)
function apiHeaders(): Record<string, string> {
  const key = Deno.env.get("API_FOOTBALL_KEY") ?? "";
  if (!key) {
    throw new Error("[api] Missing API_FOOTBALL_KEY environment variable");
  }
  console.log("[api] Using API-Sports direct endpoint with x-apisports-key");
  return {
    "x-apisports-key": key
  };
}

const API_BASE = "https://v3.football.api-sports.io";

// Inlined stats utilities (moved here to avoid cross-file import boot issues)
// Computes last-5 finished fixtures averages for a team using API-Football

type Last5Result = {
  team_id: number;
  goals: number;
  corners: number;
  cards: number;
  fouls: number;
  offsides: number;
  sample_size: number;
  last_five_fixture_ids: number[];
  last_final_fixture: number | null;
  computed_at?: string;
  source?: string;
};

async function fetchTeamLast5FixtureIds(teamId: number): Promise<number[]> {
  console.log(`[analyze-fixture/stats] Fetching last 5 fixture IDs for team ${teamId}`);
  const url = `${API_BASE}/fixtures?team=${teamId}&last=5&status=FT`;
  const res = await fetch(url, { headers: apiHeaders() });
  if (!res.ok) {
    console.error(`[analyze-fixture/stats] Failed to fetch fixtures for team ${teamId}: ${res.status}`);
    return [];
  }
  const json = await res.json();
  const ids = (json?.response ?? [])
    .map((f: any) => Number(f.fixture?.id))
    .filter(Number.isFinite);
  console.log(`[analyze-fixture/stats] Found ${ids.length} finished fixtures for team ${teamId}: [${ids.join(", ")}]`);
  return ids;
}

async function fetchFixtureTeamStats(fixtureId: number, teamId: number) {
  console.log(`[analyze-fixture/stats] Fetching stats for team ${teamId} in fixture ${fixtureId}`);
  // Determine goals for that team from the fixture endpoint
  const fixtureUrl = `${API_BASE}/fixtures?id=${fixtureId}`;
  const fixtureRes = await fetch(fixtureUrl, { headers: apiHeaders() });
  if (!fixtureRes.ok) {
    console.error(`[analyze-fixture/stats] Failed to fetch fixture ${fixtureId}: ${fixtureRes.status}`);
    return { goals: 0, corners: 0, offsides: 0, fouls: 0, cards: 0 };
  }
  const fixtureJson = await fixtureRes.json();
  const fixture = fixtureJson?.response?.[0];

  let goals = 0;
  if (fixture) {
    const homeId = fixture?.teams?.home?.id;
    const awayId = fixture?.teams?.away?.id;
    const gHome = Number(fixture?.goals?.home ?? fixture?.score?.fulltime?.home ?? 0);
    const gAway = Number(fixture?.goals?.away ?? fixture?.score?.fulltime?.away ?? 0);
    if (teamId === homeId) goals = gHome; else if (teamId === awayId) goals = gAway;
  }

  // Fetch statistics for this fixture
  const statsUrl = `${API_BASE}/fixtures/statistics?fixture=${fixtureId}`;
  const statsRes = await fetch(statsUrl, { headers: apiHeaders() });
  if (!statsRes.ok) {
    console.warn(`[analyze-fixture/stats] Failed to fetch statistics for fixture ${fixtureId}, team ${teamId}: ${statsRes.status}`);
    return { goals, corners: 0, offsides: 0, fouls: 0, cards: 0 };
  }
  const statsJson = await statsRes.json();
  const teamStats = (statsJson?.response ?? []).find((r: any) => r?.team?.id === teamId);
  if (!teamStats) {
    console.warn(`[analyze-fixture/stats] No statistics found for team ${teamId} in fixture ${fixtureId}`);
    return { goals, corners: 0, offsides: 0, fouls: 0, cards: 0 };
  }
  const statsArr = teamStats?.statistics ?? [];
  const val = (type: string) => {
    const row = statsArr.find((s: any) => (s?.type || "").toLowerCase() === type.toLowerCase());
    const v = row?.value;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const num = parseFloat(String(v).replace(/[^0-9.]/g, ""));
      return isNaN(num) ? 0 : num;
    }
    return 0;
  };
  const corners = val("Corner Kicks");
  const offsides = val("Offsides");
  const fouls = val("Fouls");
  const yellow = val("Yellow Cards");
  const red = val("Red Cards");
  const cards = yellow + red;
  return { goals, corners, offsides, fouls, cards };
}

async function computeLastFiveAverages(teamId: number): Promise<Last5Result> {
  const fixtures = await fetchTeamLast5FixtureIds(teamId);
  const stats: Array<{ goals: number; corners: number; offsides: number; fouls: number; cards: number }> = [];
  for (const fxId of fixtures) {
    try {
      const s = await fetchFixtureTeamStats(fxId, teamId);
      stats.push(s);
    } catch (error) {
      console.error(`[analyze-fixture/stats] Error fetching stats for fixture ${fxId}:`, error);
    }
  }
  const n = stats.length || 0;
  const sum = (k: 'goals' | 'corners' | 'cards' | 'fouls' | 'offsides') => stats.reduce((a: number, s) => a + (Number(s[k]) || 0), 0);
  const avg = (x: number) => (n ? x / n : 0);
  const result: Last5Result = {
    team_id: teamId,
    goals: avg(sum("goals")),
    corners: avg(sum("corners")),
    cards: avg(sum("cards")),
    fouls: avg(sum("fouls")),
    offsides: avg(sum("offsides")),
    sample_size: n,
    last_five_fixture_ids: fixtures,
    last_final_fixture: fixtures[0] ?? null,
    computed_at: new Date().toISOString(),
    source: "api-football",
  };
  return result;
}

// Multipliers for combined stats (v2 formula)
const METRIC_MULTIPLIERS = {
  goals: 1.6,
  corners: 1.75,
  offsides: 1.8,
  fouls: 1.8,
  cards: 1.8,
} as const;

// Sanity clamps
const METRIC_BOUNDS = {
  goals: { min: 0, max: 12 },
  corners: { min: 0, max: 25 },
  offsides: { min: 0, max: 10 },
  fouls: { min: 0, max: 40 },
  cards: { min: 0, max: 15 },
} as const;

type MetricKey = 'goals' | 'corners' | 'offsides' | 'fouls' | 'cards';

type CombinedMetrics = {
  goals: number | null;
  corners: number | null;
  offsides: number | null;
  fouls: number | null;
  cards: number | null;
  sample_size: number;
};

/**
 * Compute combined metrics using v2 formula:
 * combined(metric) = ((home_avg + away_avg) / 2) × multiplier
 * 
 * Requires minimum 3 matches per team for each metric.
 * Returns null for metrics with insufficient data.
 */
function computeCombinedMetrics(
  homeStats: Last5Result,
  awayStats: Last5Result
): CombinedMetrics {
  const minSampleSize = Math.min(homeStats.sample_size, awayStats.sample_size);
  
  const combined: CombinedMetrics = {
    goals: null,
    corners: null,
    offsides: null,
    fouls: null,
    cards: null,
    sample_size: minSampleSize,
  };

  // Only compute if we have at least 3 matches for both teams
  if (homeStats.sample_size < 3 || awayStats.sample_size < 3) {
    console.log(`[analyze-fixture] Insufficient sample size: home=${homeStats.sample_size}, away=${awayStats.sample_size} (min 3 required)`);
    return combined;
  }

  const metrics: MetricKey[] = ['goals', 'corners', 'offsides', 'fouls', 'cards'];
  
  for (const metric of metrics) {
    const homeAvg = Number(homeStats[metric]) || 0;
    const awayAvg = Number(awayStats[metric]) || 0;
    const multiplier = METRIC_MULTIPLIERS[metric];
    const bounds = METRIC_BOUNDS[metric];
    
    // Formula: ((home_avg + away_avg) / 2) × multiplier
    let value = ((homeAvg + awayAvg) / 2) * multiplier;
    
    // Apply bounds
    value = Math.max(bounds.min, Math.min(bounds.max, value));
    
    // Round to 1 decimal
    combined[metric] = Math.round(value * 10) / 10;
  }

  console.log(
    `[analyze-fixture] combined v2: goals=${combined.goals} corners=${combined.corners} offsides=${combined.offsides} fouls=${combined.fouls} cards=${combined.cards} (samples: H=${homeStats.sample_size}/A=${awayStats.sample_size})`
  );

  return combined;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const RequestSchema = z.object({
  fixtureId: z.number().int().positive(),
  homeTeamId: z.number().int().positive(),
  awayTeamId: z.number().int().positive(),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Verify authentication
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

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    // Validate input
    const bodyRaw = await req.json().catch(() => null);
    if (!bodyRaw) {
      return new Response(
        JSON.stringify({ error: "Invalid request body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const validation = RequestSchema.safeParse(bodyRaw);
    if (!validation.success) {
      console.error("[analyze-fixture] Validation error:", validation.error.format());
      return new Response(
        JSON.stringify({ error: "Invalid request parameters" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
      );
    }

    const { fixtureId, homeTeamId, awayTeamId } = validation.data;
    console.log(`[analyze-fixture] Analyzing fixture ${fixtureId}: home=${homeTeamId}, away=${awayTeamId}`);

    // Helper to get or compute team stats
    const getTeamStats = async (teamId: number) => {
      // Try cache first
      const { data: cached } = await supabaseClient
        .from("stats_cache")
        .select("*")
        .eq("team_id", teamId)
        .single();

      if (cached && cached.last_five_fixture_ids && cached.last_five_fixture_ids.length > 0) {
        // Check if cache is fresh (computed within last 2 hours)
        const cacheAge = Date.now() - new Date(cached.computed_at).getTime();
        const TWO_HOURS = 2 * 60 * 60 * 1000;
        if (cacheAge < TWO_HOURS) {
          console.log(`[analyze-fixture] Using cached stats for team ${teamId} (age: ${Math.round(cacheAge / 1000 / 60)}min)`);
          return cached;
        }
      }

      console.log(`[analyze-fixture] Cache miss or stale for team ${teamId}, computing fresh stats`);
      const freshStats = await computeLastFiveAverages(teamId);

      // Upsert to cache
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

      return freshStats;
    };

    // Fetch stats for both teams
    const [homeStats, awayStats] = await Promise.all([
      getTeamStats(homeTeamId),
      getTeamStats(awayTeamId)
    ]);

    // Compute combined stats using v2 formula: ((home + away) / 2) × multiplier
    const combined = computeCombinedMetrics(homeStats, awayStats);

    console.log(`[analyze-fixture] Analysis complete for fixture ${fixtureId}`);

    return new Response(
      JSON.stringify({
        home: {
          team_id: homeStats.team_id,
          goals: homeStats.goals,
          corners: homeStats.corners,
          cards: homeStats.cards,
          fouls: homeStats.fouls,
          offsides: homeStats.offsides,
          sample_size: homeStats.sample_size,
          computed_at: homeStats.computed_at
        },
        away: {
          team_id: awayStats.team_id,
          goals: awayStats.goals,
          corners: awayStats.corners,
          cards: awayStats.cards,
          fouls: awayStats.fouls,
          offsides: awayStats.offsides,
          sample_size: awayStats.sample_size,
          computed_at: awayStats.computed_at
        },
        combined
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[analyze-fixture] Internal error:", {
      message: error instanceof Error ? error.message : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
