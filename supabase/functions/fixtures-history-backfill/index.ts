// ============================================================================
// fixtures-history-backfill Edge Function
// ============================================================================
// Imports historical fixtures + results from API-Football into our DB for all
// allowed leagues. Tracks progress in league_history_sync_state table.
//
// ARCHITECTURE SUMMARY:
// - For each league in ALLOWED_LEAGUE_IDS, backfills past fixtures for N seasons
// - Uses pagination-like progress tracking via league_history_sync_state
// - Respects API rate limits with configurable delays
// - Can be called via cron or manually from admin
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { ALLOWED_LEAGUE_IDS } from "../_shared/leagues.ts";
import { API_BASE, apiHeaders } from "../_shared/api.ts";

interface RequestBody {
  seasonsBack?: number;      // How many seasons to backfill (default: 2)
  leagueIds?: number[];      // Specific leagues to process (default: all)
  batchSize?: number;        // Leagues per run (default: 5)
  fixturesPerLeague?: number;// Max fixtures per league per run (default: 50)
  force?: boolean;           // Re-sync even if completed
}

interface FixtureResultRow {
  fixture_id: number;
  league_id: number;
  kickoff_at: string;
  finished_at: string;
  goals_home: number;
  goals_away: number;
  corners_home?: number;
  corners_away?: number;
  cards_home?: number;
  cards_away?: number;
  fouls_home?: number;
  fouls_away?: number;
  offsides_home?: number;
  offsides_away?: number;
  status: string;
  source: string;
  fetched_at: string;
}

// Calculate seasons to backfill
function getSeasonsToBackfill(seasonsBack: number): number[] {
  const now = new Date();
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  const currentSeason = month >= 7 ? year : year - 1;
  
  const seasons: number[] = [];
  for (let i = 0; i < seasonsBack; i++) {
    seasons.push(currentSeason - i);
  }
  return seasons;
}

// Fetch with retry for rate limiting
async function fetchWithRetry(url: string, headers: Record<string, string>, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 || res.status >= 500) {
      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 10000);
      console.warn(`[history-backfill] Got ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    return res;
  }
  throw new Error(`Failed after ${maxRetries} retries`);
}

// Fetch fixture statistics
async function fetchFixtureStatistics(fixtureId: number): Promise<any> {
  const url = `${API_BASE}/fixtures/statistics?fixture=${fixtureId}`;
  const res = await fetchWithRetry(url, apiHeaders());
  
  if (!res.ok) {
    console.warn(`[history-backfill] API error for statistics ${fixtureId}: ${res.status}`);
    return null;
  }
  
  const json = await res.json();
  return json.response || null;
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

    // Auth check
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    let isAuthorized = false;

    if (cronKeyHeader) {
      const { data: dbKey } = await supabase.rpc("get_cron_internal_key").single();
      if (dbKey && cronKeyHeader === dbKey) {
        isAuthorized = true;
        console.log("[history-backfill] Authorized via X-CRON-KEY");
      }
    }

    if (!isAuthorized && authHeader) {
      if (authHeader === `Bearer ${serviceRoleKey}`) {
        isAuthorized = true;
        console.log("[history-backfill] Authorized via service role");
      } else {
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
        if (anonKey) {
          const userClient = createClient(supabaseUrl, anonKey, {
            global: { headers: { Authorization: authHeader } }
          });
          const { data: isWhitelisted } = await userClient.rpc("is_user_whitelisted").single();
          if (isWhitelisted) {
            isAuthorized = true;
            console.log("[history-backfill] Authorized via admin user");
          }
        }
      }
    }

    if (!isAuthorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }

    // Parse request body
    let body: RequestBody = {};
    try {
      body = await req.json();
    } catch {
      // Use defaults
    }

    const seasonsBack = body.seasonsBack ?? 2;
    const batchSize = body.batchSize ?? 5;
    const fixturesPerLeague = body.fixturesPerLeague ?? 50;
    const force = body.force ?? false;
    const targetLeagues = body.leagueIds ?? ALLOWED_LEAGUE_IDS;
    const seasons = getSeasonsToBackfill(seasonsBack);

    console.log(`[history-backfill] Starting backfill: ${targetLeagues.length} leagues, seasons=${seasons.join(',')}, batchSize=${batchSize}, fixturesPerLeague=${fixturesPerLeague}`);

    const startTime = Date.now();
    let totalFixturesProcessed = 0;
    let totalResultsInserted = 0;
    let leaguesProcessed = 0;
    let errors = 0;

    // Initialize sync state for all league/season combos if not exists
    for (const leagueId of targetLeagues) {
      for (const season of seasons) {
        await supabase
          .from("league_history_sync_state")
          .upsert({
            league_id: leagueId,
            season: season,
            status: 'pending'
          }, { onConflict: 'league_id,season', ignoreDuplicates: true });
      }
    }

    // Get league/season combos that need processing
    let query = supabase
      .from("league_history_sync_state")
      .select("*")
      .in("league_id", targetLeagues)
      .in("season", seasons)
      .order("last_run_at", { ascending: true, nullsFirst: true });

    if (!force) {
      query = query.neq("status", "completed");
    }

    const { data: syncStates, error: syncError } = await query.limit(batchSize);

    if (syncError) {
      console.error("[history-backfill] Error fetching sync state:", syncError);
      return errorResponse("Failed to fetch sync state", origin, 500, req);
    }

    if (!syncStates || syncStates.length === 0) {
      console.log("[history-backfill] All leagues are fully synced");
      return jsonResponse({
        success: true,
        message: "All leagues are fully synced",
        leagues_processed: 0,
        fixtures_processed: 0,
        results_inserted: 0
      }, origin, 200, req);
    }

    console.log(`[history-backfill] Processing ${syncStates.length} league/season combos`);

    for (const syncState of syncStates) {
      const leagueId = syncState.league_id;
      const season = syncState.season;

      try {
        // Mark as in progress
        await supabase
          .from("league_history_sync_state")
          .update({ status: 'in_progress', last_run_at: new Date().toISOString() })
          .eq("id", syncState.id);

        console.log(`[history-backfill] Processing league ${leagueId}, season ${season}`);

        // Fetch fixtures from API-Football
        const url = `${API_BASE}/fixtures?league=${leagueId}&season=${season}&status=FT-AET-PEN`;
        console.log(`[history-backfill] Fetching: ${url}`);
        
        const res = await fetchWithRetry(url, apiHeaders());
        
        if (!res.ok) {
          throw new Error(`API error: ${res.status}`);
        }

        const json = await res.json();
        const apiFixtures = json.response || [];
        
        console.log(`[history-backfill] League ${leagueId} season ${season}: ${apiFixtures.length} fixtures from API`);

        // Get existing fixture IDs from our DB
        const fixtureIds = apiFixtures.map((f: any) => f.fixture?.id).filter(Boolean);
        const { data: existingFixtures } = await supabase
          .from("fixtures")
          .select("id")
          .in("id", fixtureIds);
        const existingFixtureIds = new Set((existingFixtures || []).map(f => f.id));

        // Get existing results
        const { data: existingResults } = await supabase
          .from("fixture_results")
          .select("fixture_id")
          .in("fixture_id", fixtureIds);
        const existingResultIds = new Set((existingResults || []).map(r => r.fixture_id));

        // Process fixtures (limited per run)
        const fixturesToProcess = apiFixtures.slice(0, fixturesPerLeague);
        let fixturesUpserted = 0;
        let resultsUpserted = 0;

        for (const apiFixture of fixturesToProcess) {
          const fixtureId = apiFixture.fixture?.id;
          if (!fixtureId) continue;

          const timestamp = apiFixture.fixture?.timestamp;
          const homeTeam = apiFixture.teams?.home;
          const awayTeam = apiFixture.teams?.away;
          const goalsHome = apiFixture.goals?.home ?? 0;
          const goalsAway = apiFixture.goals?.away ?? 0;
          const fixtureStatus = apiFixture.fixture?.status?.short || 'FT';

          // Upsert fixture if not exists
          if (!existingFixtureIds.has(fixtureId)) {
            const fixtureDate = new Date(timestamp * 1000).toISOString().split('T')[0];
            await supabase.from("fixtures").upsert({
              id: fixtureId,
              league_id: leagueId,
              date: fixtureDate,
              timestamp: timestamp,
              teams_home: { id: homeTeam?.id, name: homeTeam?.name, logo: homeTeam?.logo },
              teams_away: { id: awayTeam?.id, name: awayTeam?.name, logo: awayTeam?.logo },
              status: fixtureStatus
            }, { onConflict: 'id' });
            fixturesUpserted++;
          }

          // Fetch and upsert results if not exists
          if (!existingResultIds.has(fixtureId)) {
            // Fetch detailed statistics
            let cornersHome: number | null = null;
            let cornersAway: number | null = null;
            let cardsHome: number | null = null;
            let cardsAway: number | null = null;
            let foulsHome: number | null = null;
            let foulsAway: number | null = null;
            let offsidesHome: number | null = null;
            let offsidesAway: number | null = null;

            const statsData = await fetchFixtureStatistics(fixtureId);
            
            if (statsData && Array.isArray(statsData) && statsData.length === 2) {
              const homeStats = statsData.find((s: any) => s.team?.id === homeTeam?.id);
              const awayStats = statsData.find((s: any) => s.team?.id === awayTeam?.id);
              
              if (homeStats?.statistics) {
                const cornersStat = homeStats.statistics.find((st: any) => 
                  st.type === "Corner Kicks" || st.type === "Corners"
                );
                cornersHome = cornersStat?.value ?? null;
                
                const yellowCards = homeStats.statistics.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
                const redCards = homeStats.statistics.find((st: any) => st.type === "Red Cards")?.value ?? 0;
                cardsHome = (yellowCards || 0) + (redCards || 0);
                
                foulsHome = homeStats.statistics.find((st: any) => st.type === "Fouls")?.value ?? null;
                offsidesHome = homeStats.statistics.find((st: any) => st.type === "Offsides")?.value ?? null;
              }
              
              if (awayStats?.statistics) {
                const cornersStat = awayStats.statistics.find((st: any) => 
                  st.type === "Corner Kicks" || st.type === "Corners"
                );
                cornersAway = cornersStat?.value ?? null;
                
                const yellowCards = awayStats.statistics.find((st: any) => st.type === "Yellow Cards")?.value ?? 0;
                const redCards = awayStats.statistics.find((st: any) => st.type === "Red Cards")?.value ?? 0;
                cardsAway = (yellowCards || 0) + (redCards || 0);
                
                foulsAway = awayStats.statistics.find((st: any) => st.type === "Fouls")?.value ?? null;
                offsidesAway = awayStats.statistics.find((st: any) => st.type === "Offsides")?.value ?? null;
              }
            }

            const result: FixtureResultRow = {
              fixture_id: fixtureId,
              league_id: leagueId,
              kickoff_at: new Date(timestamp * 1000).toISOString(),
              finished_at: new Date(timestamp * 1000).toISOString(),
              goals_home: goalsHome,
              goals_away: goalsAway,
              corners_home: cornersHome ?? undefined,
              corners_away: cornersAway ?? undefined,
              cards_home: cardsHome ?? undefined,
              cards_away: cardsAway ?? undefined,
              fouls_home: foulsHome ?? undefined,
              fouls_away: foulsAway ?? undefined,
              offsides_home: offsidesHome ?? undefined,
              offsides_away: offsidesAway ?? undefined,
              status: fixtureStatus,
              source: 'history-backfill',
              fetched_at: new Date().toISOString()
            };

            await supabase.from("fixture_results").upsert(result, { onConflict: 'fixture_id' });
            resultsUpserted++;

            // Rate limit: 100ms between stats calls
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          totalFixturesProcessed++;
        }

        // Update sync state
        const isComplete = apiFixtures.length <= fixturesPerLeague;
        await supabase
          .from("league_history_sync_state")
          .update({
            status: isComplete ? 'completed' : 'in_progress',
            total_fixtures_synced: (syncState.total_fixtures_synced || 0) + fixturesUpserted,
            error_message: null
          })
          .eq("id", syncState.id);

        totalResultsInserted += resultsUpserted;
        leaguesProcessed++;

        console.log(`[history-backfill] League ${leagueId} season ${season}: ${fixturesUpserted} fixtures, ${resultsUpserted} results`);

        // Delay between leagues
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err) {
        console.error(`[history-backfill] Error processing league ${leagueId} season ${season}:`, err);
        
        await supabase
          .from("league_history_sync_state")
          .update({
            status: 'error',
            error_message: err instanceof Error ? err.message : String(err)
          })
          .eq("id", syncState.id);
        
        errors++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[history-backfill] Complete: ${leaguesProcessed} leagues, ${totalFixturesProcessed} fixtures, ${totalResultsInserted} results, ${errors} errors, ${duration}ms`);

    // Log to optimizer_run_logs
    await supabase.from("optimizer_run_logs").insert({
      run_type: 'history-backfill',
      window_start: new Date().toISOString(),
      window_end: new Date().toISOString(),
      scope: {
        seasons_back: seasonsBack,
        batch_size: batchSize,
        fixtures_per_league: fixturesPerLeague,
        target_leagues: targetLeagues.length
      },
      scanned: totalFixturesProcessed,
      upserted: totalResultsInserted,
      failed: errors,
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: duration
    });

    return jsonResponse({
      success: true,
      leagues_processed: leaguesProcessed,
      fixtures_processed: totalFixturesProcessed,
      results_inserted: totalResultsInserted,
      errors,
      duration_ms: duration,
      message: `Processed ${leaguesProcessed} league/season combos, ${totalResultsInserted} new results`
    }, origin, 200, req);

  } catch (error) {
    console.error("[history-backfill] Fatal error:", error);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
