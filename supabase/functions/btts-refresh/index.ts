import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

/**
 * BTTS Refresh Edge Function
 * 
 * Recomputes and caches BTTS metrics for all teams in supported leagues.
 * Called by cron job every 6 hours.
 * 
 * Supported leagues: EN/ES/FR/IT/DE 1st and 2nd divisions
 * 
 * 100% Postgres-based - NO external API calls.
 */

// Supported 1st and 2nd division leagues
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
};

const SUPPORTED_LEAGUE_IDS = Object.keys(SUPPORTED_LEAGUES).map(Number);
const LOOKBACK_MONTHS = 18;

serve(async (req) => {
  const origin = req.headers.get("origin") || "*";

  if (req.method === "OPTIONS") {
    return handlePreflight(origin);
  }

  const startTime = Date.now();
  let teamsProcessed = 0;
  let leaguesProcessed = 0;
  let errors: string[] = [];

  try {
    // Authenticate: accept cron key or service role
    const authHeader = req.headers.get("Authorization") || "";
    const cronKey = req.headers.get("x-cron-key");
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify cron key if provided
    if (cronKey) {
      const { data: dbKey } = await supabase.rpc("get_cron_internal_key");
      if (cronKey !== dbKey) {
        console.log("[btts-refresh] Invalid cron key");
        return errorResponse("Unauthorized", origin, 401, req);
      }
    } else if (!authHeader.includes(supabaseKey)) {
      console.log("[btts-refresh] Missing auth");
      return errorResponse("Unauthorized", origin, 401, req);
    }

    console.log(`[btts-refresh] Starting BTTS metrics refresh for ${SUPPORTED_LEAGUE_IDS.length} leagues`);

    // Calculate date boundaries
    const lookbackDate = new Date();
    lookbackDate.setMonth(lookbackDate.getMonth() - LOOKBACK_MONTHS);
    const lookbackDateStr = lookbackDate.toISOString().split("T")[0];

    const now = new Date();
    // Fix: If we're before August, the current season started LAST year
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth(); // 0-indexed, so Jan=0, Aug=7
    const seasonYear = month >= 7 ? year : year - 1;
    const seasonStartDate = new Date(Date.UTC(seasonYear, 7, 1)); // Aug = 7
    const currentSeasonDateStr = seasonStartDate.toISOString().split("T")[0];
    
    console.log(`[btts-refresh] Season year: ${seasonYear}, season start: ${currentSeasonDateStr}, lookback: ${lookbackDateStr}`);

    // Process each league
    const allMetrics: any[] = [];

    for (const leagueId of SUPPORTED_LEAGUE_IDS) {
      try {
        console.log(`[btts-refresh] Processing league ${leagueId} (${SUPPORTED_LEAGUES[leagueId].name})`);

        // Get teams in current season
        const { data: currentFixtures } = await supabase
          .from("fixtures")
          .select("teams_home, teams_away")
          .eq("league_id", leagueId)
          .gte("date", currentSeasonDateStr)
          .limit(1000);

        const currentSeasonTeams = new Map<number, string>();
        for (const f of currentFixtures || []) {
          const homeId = parseInt(String(f.teams_home?.id));
          const awayId = parseInt(String(f.teams_away?.id));
          const homeName = f.teams_home?.name || `Team ${homeId}`;
          const awayName = f.teams_away?.name || `Team ${awayId}`;
          if (!isNaN(homeId)) currentSeasonTeams.set(homeId, homeName);
          if (!isNaN(awayId)) currentSeasonTeams.set(awayId, awayName);
        }

        if (currentSeasonTeams.size === 0) {
          console.log(`[btts-refresh] No current season teams for league ${leagueId}`);
          continue;
        }

        // Fetch finished matches
        const { data: matches, error: matchError } = await supabase
          .from("fixture_results")
          .select(`
            fixture_id,
            goals_home,
            goals_away,
            kickoff_at,
            fixtures!fixture_results_fixture_id_fkey(
              teams_home,
              teams_away
            )
          `)
          .eq("league_id", leagueId)
          .in("status", ["FT", "AET", "PEN"])
          .gte("kickoff_at", lookbackDateStr)
          .order("kickoff_at", { ascending: false })
          .limit(2000);

        if (matchError) {
          console.error(`[btts-refresh] Error fetching matches for league ${leagueId}:`, matchError);
          errors.push(`League ${leagueId}: ${matchError.message}`);
          continue;
        }

        // Build team match history
        const teamMatches: Map<number, { btts: boolean; kickoff: string }[]> = new Map();

        for (const match of matches || []) {
          const fixture = Array.isArray(match.fixtures) ? match.fixtures[0] : match.fixtures;
          if (!fixture) continue;

          const homeTeamId = parseInt(String(fixture.teams_home?.id));
          const awayTeamId = parseInt(String(fixture.teams_away?.id));

          if (isNaN(homeTeamId) || isNaN(awayTeamId)) continue;

          const btts = match.goals_home > 0 && match.goals_away > 0;

          // Add home team match
          if (currentSeasonTeams.has(homeTeamId)) {
            if (!teamMatches.has(homeTeamId)) teamMatches.set(homeTeamId, []);
            teamMatches.get(homeTeamId)!.push({ btts, kickoff: match.kickoff_at });
          }

          // Add away team match
          if (currentSeasonTeams.has(awayTeamId)) {
            if (!teamMatches.has(awayTeamId)) teamMatches.set(awayTeamId, []);
            teamMatches.get(awayTeamId)!.push({ btts, kickoff: match.kickoff_at });
          }
        }

        // Calculate metrics for each team
        for (const [teamId, teamName] of currentSeasonTeams) {
          const matches = teamMatches.get(teamId) || [];
          
          // Sort by kickoff DESC
          matches.sort((a, b) => 
            new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime()
          );

          // Calculate for windows 5, 10, 15
          const calc = (n: number) => {
            const sample = matches.slice(0, n);
            const count = sample.filter(m => m.btts).length;
            const rate = sample.length > 0 
              ? Math.round((count / sample.length) * 10000) / 100 
              : 0;
            return { count, rate, sample: sample.length };
          };

          const w5 = calc(5);
          const w10 = calc(10);
          const w15 = calc(15);

          allMetrics.push({
            team_id: teamId,
            team_name: teamName,
            league_id: leagueId,
            btts_5: w5.count,
            btts_5_rate: w5.rate,
            sample_5: w5.sample,
            btts_10: w10.count,
            btts_10_rate: w10.rate,
            sample_10: w10.sample,
            btts_15: w15.count,
            btts_15_rate: w15.rate,
            sample_15: w15.sample,
            computed_at: new Date().toISOString(),
          });

          teamsProcessed++;
        }

        leaguesProcessed++;
        console.log(`[btts-refresh] League ${leagueId}: ${currentSeasonTeams.size} teams processed`);

      } catch (leagueError) {
        console.error(`[btts-refresh] Error processing league ${leagueId}:`, leagueError);
        errors.push(`League ${leagueId}: ${leagueError instanceof Error ? leagueError.message : 'Unknown error'}`);
      }
    }

    // Upsert all metrics
    if (allMetrics.length > 0) {
      console.log(`[btts-refresh] Upserting ${allMetrics.length} team metrics`);
      
      const { error: upsertError } = await supabase
        .from("team_btts_metrics")
        .upsert(allMetrics, {
          onConflict: "team_id,league_id",
          ignoreDuplicates: false,
        });

      if (upsertError) {
        console.error("[btts-refresh] Upsert error:", upsertError);
        errors.push(`Upsert failed: ${upsertError.message}`);
      }
    }

    // Log to optimizer_run_logs with finished_at set
    const duration = Date.now() - startTime;
    const finishedAt = new Date().toISOString();
    await supabase.from("optimizer_run_logs").insert({
      run_type: "btts-refresh",
      window_start: lookbackDate.toISOString(),
      window_end: finishedAt,
      started_at: new Date(startTime).toISOString(),
      finished_at: finishedAt,
      scanned: leaguesProcessed,
      upserted: teamsProcessed,
      failed: errors.length,
      notes: errors.length > 0 ? errors.join("; ") : null,
      duration_ms: duration,
    });

    console.log(`[btts-refresh] Complete: ${teamsProcessed} teams in ${leaguesProcessed} leagues, ${errors.length} errors, ${duration}ms`);

    return jsonResponse({
      ok: true,
      teams_processed: teamsProcessed,
      leagues_processed: leaguesProcessed,
      errors: errors.length > 0 ? errors : null,
      duration_ms: duration,
    }, origin);

  } catch (error) {
    console.error("[btts-refresh] Fatal error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Unknown error",
      origin,
      500,
      req
    );
  }
});
