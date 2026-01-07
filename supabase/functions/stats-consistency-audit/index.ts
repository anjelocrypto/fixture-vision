// ============================================================================
// Stats Consistency Audit Edge Function
// ============================================================================
// Compares stats from three sources to verify consistency:
// 1. API-Football (live data)
// 2. Local DB (fixture_results recomputation)
// 3. stats_cache table
//
// Returns detailed per-metric diffs and logs results to optimizer_run_logs.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { API_BASE, apiHeaders } from "../_shared/api.ts";
import { recomputeTeamStatsFromDB, DBStatsResult } from "../_shared/stats_db.ts";
import { ALLOWED_LEAGUE_IDS, LEAGUE_NAMES } from "../_shared/leagues.ts";

// Default leagues to audit (UEFA + major cups)
const DEFAULT_AUDIT_LEAGUES = [
  2,    // UEFA Champions League
  3,    // UEFA Europa League
  848,  // UEFA Europa Conference League
  45,   // FA Cup (England)
  48,   // EFL Cup (England)
  143,  // Copa del Rey (Spain)
  137,  // Coppa Italia (Italy)
  81,   // DFB-Pokal (Germany)
  66,   // Coupe de France (France)
  // Major domestic leagues for comprehensive audit
  39,   // Premier League
  140,  // La Liga
  135,  // Serie A
  78,   // Bundesliga
  61,   // Ligue 1
];

// Thresholds for acceptable differences
const VALIDATION_THRESHOLDS = {
  goals: 0.3,
  corners: 1.0,
  cards: 0.8,
  fouls: 3.0,
  offsides: 1.5
};

interface RequestBody {
  leagueIds?: number[];
  sampleSize?: number;  // Teams per league
  maxTeams?: number;    // Total teams limit
}

interface TeamSample {
  league_id: number;
  team_id: number;
  team_name: string;
  metrics: MetricComparison[];
}

interface MetricComparison {
  name: string;
  api: number | null;
  cache: number | null;
  db: number | null;
  available_api: boolean;
  available_cache: boolean;
  available_db: boolean;
  skipped: boolean;
  diff_api_vs_cache: number | null;
  diff_db_vs_cache: number | null;
  diff_api_vs_db: number | null;
  acceptable: boolean;
}

interface MetricSummary {
  max_diff: number;
  failures: number;
  comparisons: number;
}

interface AuditSummary {
  api_vs_cache: Record<string, MetricSummary>;
  db_vs_cache: Record<string, MetricSummary>;
  api_vs_db: Record<string, MetricSummary>;
}

interface APIFixture {
  fixture: { id: number; timestamp: number; status: { short: string } };
  teams: { home: { id: number }; away: { id: number } };
  goals: { home: number; away: number };
}

interface APIStats {
  team: { id: number };
  statistics: Array<{ type: string; value: number | null }>;
}

// Fetch with retry for rate limiting
async function fetchWithRetry(url: string, headers: Record<string, string>, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 || res.status >= 500) {
      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 10000);
      console.warn(`[audit] Got ${res.status}, retrying in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    return res;
  }
  throw new Error(`Failed after ${maxRetries} retries`);
}

// Compute team averages from API-Football directly
async function computeTeamStatsFromAPI(teamId: number): Promise<{
  goals: number | null;
  corners: number | null;
  cards: number | null;
  fouls: number | null;
  offsides: number | null;
  sample_size: number;
  fixture_ids: number[];
} | null> {
  try {
    // Get current season
    const now = new Date();
    const month = now.getUTCMonth();
    const year = now.getUTCFullYear();
    const season = month >= 7 ? year : year - 1;

    // Fetch last 10 finished fixtures for this team
    const fixturesUrl = `${API_BASE}/fixtures?team=${teamId}&season=${season}&status=FT-AET-PEN&last=10`;
    console.log(`[audit] Fetching fixtures for team ${teamId}: ${fixturesUrl}`);
    
    const fixturesRes = await fetchWithRetry(fixturesUrl, apiHeaders());
    if (!fixturesRes.ok) {
      console.warn(`[audit] Failed to fetch fixtures for team ${teamId}: ${fixturesRes.status}`);
      return null;
    }

    const fixturesJson = await fixturesRes.json();
    const apiFixtures = (fixturesJson.response || []) as APIFixture[];
    
    if (apiFixtures.length === 0) {
      console.log(`[audit] No fixtures found for team ${teamId}`);
      return null;
    }

    // Sort by timestamp descending and take first 5
    const sortedFixtures = apiFixtures
      .filter(f => f.fixture?.id && f.fixture?.status?.short && ['FT', 'AET', 'PEN'].includes(f.fixture.status.short))
      .sort((a, b) => b.fixture.timestamp - a.fixture.timestamp)
      .slice(0, 5);

    if (sortedFixtures.length === 0) {
      return null;
    }

    // Compute averages
    let totalGoals = 0, countGoals = 0;
    let totalCorners = 0, countCorners = 0;
    let totalCards = 0, countCards = 0;
    let totalFouls = 0, countFouls = 0;
    let totalOffsides = 0, countOffsides = 0;
    const fixtureIds: number[] = [];

    for (const fixture of sortedFixtures) {
      const fixtureId = fixture.fixture.id;
      fixtureIds.push(fixtureId);
      
      const isHome = fixture.teams.home.id === teamId;
      
      // Goals from fixture data
      const goals = isHome ? fixture.goals.home : fixture.goals.away;
      if (goals !== null && goals !== undefined) {
        totalGoals += goals;
        countGoals++;
      }

      // Fetch detailed statistics
      const statsUrl = `${API_BASE}/fixtures/statistics?fixture=${fixtureId}`;
      const statsRes = await fetchWithRetry(statsUrl, apiHeaders());
      
      if (statsRes.ok) {
        const statsJson = await statsRes.json();
        const statsData = (statsJson.response || []) as APIStats[];
        
        const teamStats = statsData.find(s => s.team.id === teamId);
        if (teamStats?.statistics) {
          const getStat = (types: string[]): number | null => {
            for (const type of types) {
              const stat = teamStats.statistics.find(s => s.type === type);
              if (stat?.value !== null && stat?.value !== undefined) {
                return stat.value;
              }
            }
            return null;
          };

          const corners = getStat(['Corner Kicks', 'Corners']);
          if (corners !== null) {
            totalCorners += corners;
            countCorners++;
          }

          const yellow = getStat(['Yellow Cards']) || 0;
          const red = getStat(['Red Cards']) || 0;
          const cards = yellow + red;
          if (yellow !== null || red !== null) {
            totalCards += cards;
            countCards++;
          }

          const fouls = getStat(['Fouls']);
          if (fouls !== null) {
            totalFouls += fouls;
            countFouls++;
          }

          const offsides = getStat(['Offsides']);
          if (offsides !== null) {
            totalOffsides += offsides;
            countOffsides++;
          }
        }
      }

      // Rate limit between stats calls
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return {
      goals: countGoals > 0 ? totalGoals / countGoals : null,
      corners: countCorners > 0 ? totalCorners / countCorners : null,
      cards: countCards > 0 ? totalCards / countCards : null,
      fouls: countFouls > 0 ? totalFouls / countFouls : null,
      offsides: countOffsides > 0 ? totalOffsides / countOffsides : null,
      sample_size: countGoals,
      fixture_ids: fixtureIds
    };
  } catch (error) {
    console.error(`[audit] Error computing API stats for team ${teamId}:`, error);
    return null;
  }
}

// Compare metrics and produce detailed comparison
function compareMetrics(
  api: { goals: number | null; corners: number | null; cards: number | null; fouls: number | null; offsides: number | null } | null,
  cache: { goals: number; corners: number; cards: number; fouls: number; offsides: number; sample_size: number } | null,
  db: DBStatsResult | null
): MetricComparison[] {
  const metrics: MetricComparison[] = [];
  const metricNames = ['goals', 'corners', 'cards', 'fouls', 'offsides'] as const;

  for (const name of metricNames) {
    const apiVal = api?.[name] ?? null;
    const cacheVal = cache?.[name] ?? null;
    const dbVal = db?.[name] ?? null;

    const availableApi = apiVal !== null && apiVal !== undefined;
    const availableCache = cacheVal !== null && cacheVal !== undefined;
    const availableDb = dbVal !== null && dbVal !== undefined;

    // Skip if no data from any source
    const skipped = !availableApi && !availableCache && !availableDb;
    
    // Goals are mandatory - if missing, it's a failure
    let acceptable = true;
    const threshold = VALIDATION_THRESHOLDS[name];

    const diffApiVsCache = availableApi && availableCache ? Math.abs(apiVal - cacheVal) : null;
    const diffDbVsCache = availableDb && availableCache ? Math.abs(dbVal - cacheVal) : null;
    const diffApiVsDb = availableApi && availableDb ? Math.abs(apiVal - dbVal) : null;

    // Check if differences exceed threshold
    if (name === 'goals') {
      // Goals are mandatory
      if (!availableApi || !availableCache) {
        acceptable = false;
      } else if (diffApiVsCache !== null && diffApiVsCache > threshold) {
        acceptable = false;
      }
    } else {
      // Other metrics - only fail if data exists and differs significantly
      if (diffApiVsCache !== null && diffApiVsCache > threshold) {
        acceptable = false;
      }
    }

    metrics.push({
      name,
      api: apiVal !== null ? Math.round(apiVal * 100) / 100 : null,
      cache: cacheVal !== null ? Math.round(cacheVal * 100) / 100 : null,
      db: dbVal !== null ? Math.round(dbVal * 100) / 100 : null,
      available_api: availableApi,
      available_cache: availableCache,
      available_db: availableDb,
      skipped,
      diff_api_vs_cache: diffApiVsCache !== null ? Math.round(diffApiVsCache * 100) / 100 : null,
      diff_db_vs_cache: diffDbVsCache !== null ? Math.round(diffDbVsCache * 100) / 100 : null,
      diff_api_vs_db: diffApiVsDb !== null ? Math.round(diffApiVsDb * 100) / 100 : null,
      acceptable: skipped || acceptable
    });
  }

  return metrics;
}

// Initialize summary structure
function initSummary(): AuditSummary {
  const metricNames = ['goals', 'corners', 'cards', 'fouls', 'offsides'];
  const emptySummary: Record<string, MetricSummary> = {};
  for (const name of metricNames) {
    emptySummary[name] = { max_diff: 0, failures: 0, comparisons: 0 };
  }
  return {
    api_vs_cache: { ...emptySummary },
    db_vs_cache: { ...emptySummary },
    api_vs_db: { ...emptySummary }
  };
}

// Update summary with comparison results
function updateSummary(summary: AuditSummary, metrics: MetricComparison[]): void {
  for (const m of metrics) {
    if (m.skipped) continue;

    const threshold = VALIDATION_THRESHOLDS[m.name as keyof typeof VALIDATION_THRESHOLDS];

    // API vs Cache
    if (m.diff_api_vs_cache !== null) {
      summary.api_vs_cache[m.name].comparisons++;
      summary.api_vs_cache[m.name].max_diff = Math.max(summary.api_vs_cache[m.name].max_diff, m.diff_api_vs_cache);
      if (m.diff_api_vs_cache > threshold) {
        summary.api_vs_cache[m.name].failures++;
      }
    }

    // DB vs Cache
    if (m.diff_db_vs_cache !== null) {
      summary.db_vs_cache[m.name].comparisons++;
      summary.db_vs_cache[m.name].max_diff = Math.max(summary.db_vs_cache[m.name].max_diff, m.diff_db_vs_cache);
      if (m.diff_db_vs_cache > threshold) {
        summary.db_vs_cache[m.name].failures++;
      }
    }

    // API vs DB
    if (m.diff_api_vs_db !== null) {
      summary.api_vs_db[m.name].comparisons++;
      summary.api_vs_db[m.name].max_diff = Math.max(summary.api_vs_db[m.name].max_diff, m.diff_api_vs_db);
      if (m.diff_api_vs_db > threshold) {
        summary.api_vs_db[m.name].failures++;
      }
    }
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  
  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse("Missing Supabase configuration", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Auth check (admin or service role) - NO .single() on scalar RPCs!
    const cronKeyHeader = req.headers.get("x-cron-key") ?? req.headers.get("X-CRON-KEY");
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    let isAuthorized = false;

    if (cronKeyHeader) {
      const { data: dbKey, error: keyError } = await supabase.rpc("get_cron_internal_key");
      if (keyError) {
        console.error("[audit] get_cron_internal_key error:", keyError);
      } else {
        const expectedKey = String(dbKey || "").trim();
        const providedKey = String(cronKeyHeader || "").trim();
        if (providedKey && expectedKey && providedKey === expectedKey) {
          isAuthorized = true;
          console.log("[audit] Authorized via X-CRON-KEY");
        }
      }
    }

    if (!isAuthorized && authHeader) {
      if (authHeader === `Bearer ${serviceRoleKey}`) {
        isAuthorized = true;
        console.log("[audit] Authorized via service role");
      } else {
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
        if (anonKey) {
          const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } }
          });
          const { data: isWhitelisted, error: wlError } = await userClient.rpc("is_user_whitelisted");
          if (wlError) {
            console.error("[audit] is_user_whitelisted error:", wlError);
          } else if (isWhitelisted === true) {
            isAuthorized = true;
            console.log("[audit] Authorized via admin user");
          }
        }
      }
    }

    if (!isAuthorized) {
      console.error("[audit] Authorization failed - no valid credentials");
      return errorResponse("Unauthorized", origin, 401, req);
    }

    // Parse request body
    let body: RequestBody = {};
    try {
      body = await req.json();
    } catch {
      // Use defaults
    }

    const leagueIds = body.leagueIds?.length ? body.leagueIds : DEFAULT_AUDIT_LEAGUES;
    const sampleSize = body.sampleSize ?? 3;
    const maxTeams = body.maxTeams ?? 30;

    console.log(`[audit] Starting consistency audit: leagues=[${leagueIds.join(',')}], sampleSize=${sampleSize}, maxTeams=${maxTeams}`);

    const startTime = Date.now();
    const samples: TeamSample[] = [];
    const summary = initSummary();
    let teamsChecked = 0;
    let teamsWithFailures = 0;

    // For each league, find teams with stats_cache and recent fixtures
    for (const leagueId of leagueIds) {
      if (teamsChecked >= maxTeams) break;

      console.log(`[audit] Processing league ${leagueId} (${LEAGUE_NAMES[leagueId] || 'Unknown'})`);

      // Get teams with stats_cache that have recent fixtures in this league
      const { data: fixtures } = await supabase
        .from("fixtures")
        .select("id, teams_home, teams_away, league_id")
        .eq("league_id", leagueId)
        .in("status", ["NS", "FT", "AET", "PEN"])
        .order("timestamp", { ascending: false })
        .limit(50);

      if (!fixtures || fixtures.length === 0) {
        console.log(`[audit] No fixtures found for league ${leagueId}`);
        continue;
      }

      // Extract unique team IDs
      const teamIds = new Set<number>();
      for (const f of fixtures) {
        const homeId = (f.teams_home as any)?.id;
        const awayId = (f.teams_away as any)?.id;
        if (homeId) teamIds.add(Number(homeId));
        if (awayId) teamIds.add(Number(awayId));
      }

      // Get teams that have stats_cache
      const { data: cachedTeams } = await supabase
        .from("stats_cache")
        .select("team_id, goals, corners, cards, fouls, offsides, sample_size")
        .in("team_id", Array.from(teamIds))
        .gte("sample_size", 3);

      if (!cachedTeams || cachedTeams.length === 0) {
        console.log(`[audit] No cached teams found for league ${leagueId}`);
        continue;
      }

      // Randomly sample teams
      const shuffled = cachedTeams.sort(() => Math.random() - 0.5);
      const sampled = shuffled.slice(0, Math.min(sampleSize, maxTeams - teamsChecked));

      for (const cacheEntry of sampled) {
        const teamId = cacheEntry.team_id;
        console.log(`[audit] Auditing team ${teamId}`);

        // Get team name from fixtures
        const teamFixture = fixtures.find(f => 
          (f.teams_home as any)?.id === teamId || (f.teams_away as any)?.id === teamId
        );
        const teamName = teamFixture 
          ? ((teamFixture.teams_home as any)?.id === teamId 
              ? (teamFixture.teams_home as any)?.name 
              : (teamFixture.teams_away as any)?.name)
          : `Team ${teamId}`;

        // Fetch from API-Football
        const apiStats = await computeTeamStatsFromAPI(teamId);
        
        // Recompute from DB
        const dbStats = await recomputeTeamStatsFromDB(supabase, teamId);

        // Compare all three sources
        const metrics = compareMetrics(apiStats, cacheEntry, dbStats);

        // Update summary
        updateSummary(summary, metrics);

        // Check for any failures
        const hasFailures = metrics.some(m => !m.acceptable && !m.skipped);
        if (hasFailures) {
          teamsWithFailures++;
        }

        samples.push({
          league_id: leagueId,
          team_id: teamId,
          team_name: teamName,
          metrics
        });

        teamsChecked++;
        
        // Rate limit between teams
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[audit] Complete: ${teamsChecked} teams, ${teamsWithFailures} with failures, ${duration}ms`);

    // Log to optimizer_run_logs
    await supabase.from("optimizer_run_logs").insert({
      run_type: 'stats-consistency-audit',
      window_start: new Date().toISOString(),
      window_end: new Date().toISOString(),
      scope: {
        league_ids: leagueIds,
        sample_size: sampleSize,
        max_teams: maxTeams
      },
      scanned: teamsChecked,
      failed: teamsWithFailures,
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: duration,
      notes: `API vs Cache goals failures: ${summary.api_vs_cache.goals.failures}, DB vs Cache goals failures: ${summary.db_vs_cache.goals.failures}`
    });

    return jsonResponse({
      success: true,
      leagues_processed: leagueIds.length,
      teams_checked: teamsChecked,
      teams_with_failures: teamsWithFailures,
      thresholds: VALIDATION_THRESHOLDS,
      summary,
      samples,
      duration_ms: duration
    }, origin, 200, req);

  } catch (error) {
    console.error("[audit] Fatal error:", error);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
