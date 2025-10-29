import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchTeamLast5FixtureIds, computeLastFiveAverages } from "../_shared/stats.ts";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { apiHeaders, API_BASE } from "../_shared/api.ts";
import { ALLOWED_LEAGUE_IDS, LEAGUE_NAMES } from "../_shared/leagues.ts";


// Simple delay helper
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Exponential backoff wrapper for fetch
async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 5, baseDelayMs = 500): Promise<Response> {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
        console.warn(`[stats-refresh] ${url} -> ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
        await sleep(delay);
        attempt++;
        continue;
      }
      return res;
    } catch (e) {
      if (attempt < retries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
        console.warn(`[stats-refresh] network error, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
        await sleep(delay);
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

// Fetch teams for a league-season from API-Football
async function fetchTeamsByLeagueSeason(leagueId: number, season: number): Promise<number[]> {
  const url = `${API_BASE}/teams?league=${leagueId}&season=${season}`;
  const res = await fetchWithRetry(url, { headers: apiHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[stats-refresh] teams fetch failed for league ${leagueId}: ${res.status} ${text.slice(0,180)}`);
    return [];
  }
  const data = await res.json().catch(() => ({} as any));
  const ids = (data?.response ?? []).map((r: any) => r?.team?.id).filter((x: any) => Number.isInteger(x));
  console.log(`[stats-refresh] league ${leagueId} (${LEAGUE_NAMES[leagueId] ?? "?"}) -> ${ids.length} teams from API`);
  return ids;
}

// Compute with retry wrapper (covers downstream API calls)
async function computeWithRetry(teamId: number) {
  let attempt = 0;
  while (true) {
    try {
      // First call inside compute is last5 fixture ids; we also fetch here to compare cache
      const ids = await fetchTeamLast5FixtureIds(teamId);
      return { ids, stats: await computeLastFiveAverages(teamId) };
    } catch (e) {
      if (attempt < 4) {
        const delay = 800 * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
        console.warn(`[stats-refresh] compute team ${teamId} failed, retrying in ${delay}ms`);
        await sleep(delay);
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return handlePreflight(origin, req);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const apiKey = Deno.env.get("API_FOOTBALL_KEY");
    const cronKey = Deno.env.get("CRON_INTERNAL_KEY");

    if (!supabaseUrl || !supabaseKey || !supabaseAnonKey || !apiKey) {
      console.error("[stats-refresh] Missing environment variables");
      return errorResponse("Missing required environment variables", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request body for configurable params
    let window_hours = 120;
    let stats_ttl_hours = 24;
    let force = false;
    let season = new Date().getUTCFullYear();
    
    try {
      const body = await req.json();
      if (body.window_hours) window_hours = parseInt(body.window_hours);
      if (body.stats_ttl_hours) stats_ttl_hours = parseInt(body.stats_ttl_hours);
      if (typeof body.force === 'boolean') force = body.force;
      if (body.season) season = parseInt(body.season);
    } catch {
      // Use defaults if no body or invalid JSON
    }

    // Authentication: Either internal cron call or whitelisted admin
    const authHeader = req.headers.get('authorization');
    const cronKeyHeader = req.headers.get('x-cron-key');
    
    let isAuthorized = false;

    // Check if it's an internal cron call
    if (cronKeyHeader && cronKey && cronKeyHeader === cronKey) {
      console.log("[stats-refresh] Authorized via CRON_INTERNAL_KEY");
      isAuthorized = true;
    } else if (authHeader) {
      // Check if user is whitelisted admin - use anon key client with user JWT
      const jwt = authHeader.replace(/^Bearer\s+/i, '');
      
      const supabaseUser = createClient(
        supabaseUrl,
        supabaseAnonKey,
        { global: { headers: { Authorization: `Bearer ${jwt}` } } }
      );

      const { data: isWhitelisted, error: whitelistError } = await supabaseUser
        .rpc('is_user_whitelisted');

      if (whitelistError) {
        console.error("[stats-refresh] Whitelist check failed:", whitelistError.message);
        return errorResponse("Auth check failed", origin, 401, req);
      }

      if (!isWhitelisted) {
        console.error("[stats-refresh] User not whitelisted");
        return errorResponse("Forbidden: Admin access required", origin, 403, req);
      }

      console.log("[stats-refresh] Authorized via whitelisted admin");
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return errorResponse("Unauthorized: Missing credentials", origin, 401, req);
    }

    console.log(`[stats-refresh] Starting stats refresh job (${window_hours}h window, ${stats_ttl_hours}h TTL, force=${force})`);

    // Acquire mutex to prevent concurrent runs
    const { data: lockAcquired } = await supabase.rpc('acquire_cron_lock', {
      p_job_name: 'stats-refresh',
      p_duration_minutes: 60
    });

    if (!lockAcquired) {
      console.log("[stats-refresh] Another instance is already running, skipping");
      return jsonResponse({ 
        success: true, 
        skipped: true,
        reason: "Another stats-refresh is already running"
      }, origin, 200, req);
    }

    // Get upcoming fixtures
    const now = new Date();
    const startedAt = now;
    const windowEnd = new Date(now.getTime() + window_hours * 60 * 60 * 1000);
    const statsTTL = new Date(now.getTime() - stats_ttl_hours * 60 * 60 * 1000);

    const { data: upcomingFixtures, error: fixturesError } = await supabase
      .from("fixtures")
      .select("id, league_id, teams_home, teams_away")
      .gte("timestamp", Math.floor(now.getTime() / 1000))
      .lte("timestamp", Math.floor(windowEnd.getTime() / 1000));

    if (fixturesError) {
      throw fixturesError;
    }

    // Collect unique team IDs from fixtures, grouped by league
    const teamsByLeague = new Map<number, Set<number>>();
    const allTeamIds = new Set<number>();
    
    for (const fixture of upcomingFixtures || []) {
      const leagueId = fixture.league_id;
      const homeId = fixture.teams_home?.id;
      const awayId = fixture.teams_away?.id;
      
      if (!teamsByLeague.has(leagueId)) {
        teamsByLeague.set(leagueId, new Set());
      }
      
      if (homeId) {
        teamsByLeague.get(leagueId)!.add(homeId);
        allTeamIds.add(homeId);
      }
      if (awayId) {
        teamsByLeague.get(leagueId)!.add(awayId);
        allTeamIds.add(awayId);
      }
    }

    console.log(`[stats-refresh] Found ${allTeamIds.size} teams from ${upcomingFixtures?.length || 0} fixtures across ${teamsByLeague.size} leagues`);

    // For leagues with few/no fixtures, fetch all teams from API
    const leaguesWithFewFixtures = Array.from(teamsByLeague.entries())
      .filter(([_, teams]) => teams.size < 5)
      .map(([leagueId]) => leagueId);

    if (leaguesWithFewFixtures.length > 0) {
      console.log(`[stats-refresh] ${leaguesWithFewFixtures.length} leagues have <5 teams in fixtures, fetching from teams API`);
      
      for (const leagueId of leaguesWithFewFixtures) {
        if (!ALLOWED_LEAGUE_IDS.includes(leagueId)) continue;
        
        try {
          await sleep(1200); // Rate limit: ~45 RPM
          const teamIds = await fetchTeamsByLeagueSeason(leagueId, season);
          
          for (const teamId of teamIds) {
            if (!teamsByLeague.has(leagueId)) {
              teamsByLeague.set(leagueId, new Set());
            }
            teamsByLeague.get(leagueId)!.add(teamId);
            allTeamIds.add(teamId);
          }
        } catch (error) {
          console.error(`[stats-refresh] Failed to fetch teams for league ${leagueId}:`, error);
        }
      }
      
      console.log(`[stats-refresh] After teams API fallback: ${allTeamIds.size} total teams`);
    }

    let teamsScanned = 0;
    let teamsRefreshed = 0;
    let skippedTTL = 0;
    let apiCalls = 0;
    let failures = 0;
    const leagueStats = new Map<number, { total: number; fetched: number; skipped: number; errors: number }>();

    // Initialize league stats
    for (const [leagueId, teams] of teamsByLeague) {
      leagueStats.set(leagueId, { total: teams.size, fetched: 0, skipped: 0, errors: 0 });
    }

    // Process teams with batching (45 RPM = ~1.33s per request)
    const teamArray = Array.from(allTeamIds);
    for (let i = 0; i < teamArray.length; i++) {
      const teamId = teamArray[i];
      teamsScanned++;
      
      // Find which league this team belongs to
      let teamLeagueId: number | undefined;
      for (const [leagueId, teams] of teamsByLeague) {
        if (teams.has(teamId)) {
          teamLeagueId = leagueId;
          break;
        }
      }
      
      try {
        // Check current cache with TTL
        const { data: cached } = await supabase
          .from("stats_cache")
          .select("*")
          .eq("team_id", teamId)
          .single();

        // Skip if updated within TTL window (unless force=true)
        if (!force && cached?.computed_at) {
          const lastUpdate = new Date(cached.computed_at);
          if (lastUpdate > statsTTL) {
            skippedTTL++;
            if (teamLeagueId && leagueStats.has(teamLeagueId)) {
              leagueStats.get(teamLeagueId)!.skipped++;
            }
            continue;
          }
        }

        // Rate limit: ~45 RPM (1.33s between requests)
        if (i > 0 && i % 10 === 0) {
          await sleep(1300);
        }

        // Compute stats with retry
        const { ids: currentFixtureIds, stats } = await computeWithRetry(teamId);
        apiCalls += 1 + (stats.sample_size * 2); // 1 for fixture IDs + 2 per fixture for stats

        // Upsert with updated_at timestamp
        await supabase.from("stats_cache").upsert({
          team_id: teamId,
          goals: stats.goals,
          cards: stats.cards,
          offsides: stats.offsides,
          corners: stats.corners,
          fouls: stats.fouls,
          sample_size: stats.sample_size,
          last_five_fixture_ids: stats.last_five_fixture_ids,
          last_final_fixture: stats.last_final_fixture,
          computed_at: new Date().toISOString(),
          source: 'api-football'
        });

        teamsRefreshed++;
        if (teamLeagueId && leagueStats.has(teamLeagueId)) {
          leagueStats.get(teamLeagueId)!.fetched++;
        }
        
        if (teamsRefreshed % 20 === 0) {
          console.log(`[stats-refresh] Progress: ${teamsRefreshed}/${teamArray.length} teams refreshed`);
        }
      } catch (error) {
        console.error(`[stats-refresh] Failed to process team ${teamId}:`, error);
        failures++;
        if (teamLeagueId && leagueStats.has(teamLeagueId)) {
          leagueStats.get(teamLeagueId)!.errors++;
        }
      }
    }

    // Log per-league summary
    console.log("[stats-refresh] Per-league summary:");
    for (const [leagueId, stats] of leagueStats) {
      const leagueName = LEAGUE_NAMES[leagueId] || `League ${leagueId}`;
      console.log(`  ${leagueName} (${leagueId}): ${stats.total} teams, ${stats.fetched} fetched, ${stats.skipped} skipped, ${stats.errors} errors`);
    }

    console.log("[stats-refresh] Job complete", {
      teamsScanned,
      teamsRefreshed,
      skippedTTL,
      apiCalls,
      failures,
    });

    // Release mutex
    await supabase.rpc('release_cron_lock', { p_job_name: 'stats-refresh' });

    // Log run to optimizer_run_logs
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    
    await supabase.from("optimizer_run_logs").insert({
      id: crypto.randomUUID(),
      run_type: "stats-refresh",
      window_start: now.toISOString(),
      window_end: windowEnd.toISOString(),
      scope: { 
        teams: allTeamIds.size, 
        window_hours, 
        stats_ttl_hours,
        force
      },
      scanned: teamsScanned,
      with_odds: 0,
      upserted: teamsRefreshed,
      skipped: skippedTTL,
      failed: failures,
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: durationMs,
    });

    return jsonResponse({
      success: true,
      window_hours,
      stats_ttl_hours,
      teamsScanned,
      teamsRefreshed,
      skippedTTL,
      apiCalls,
      failures,
      duration_ms: durationMs,
    }, origin, 200, req);

  } catch (error) {
    console.error("[stats-refresh] Error:", error);
    
    // Release mutex on error
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && supabaseKey) {
        const supabaseCleanup = createClient(supabaseUrl, supabaseKey);
        await supabaseCleanup.rpc('release_cron_lock', { p_job_name: 'stats-refresh' });
      }
    } catch (e) {
      console.error("[stats-refresh] Failed to release lock:", e);
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    return errorResponse(errorMessage, origin, 500, req);
  }
});
