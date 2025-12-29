/**
 * Basketball Stats Cache Refresh Edge Function
 * 
 * Recomputes season averages and last 5 form for all basketball teams
 * from basketball_game_team_stats into basketball_stats_cache.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
};

interface TeamStatsRow {
  team_id: number;
  league_key: string;
  season: string;
  sample_size: number;
  ppg_for: number;
  ppg_against: number;
  ppg_total: number;
  rpg_total: number;
  apg_total: number;
  tpm_avg: number;
  fgp_avg: number;
  last5_ppg_for: number;
  last5_ppg_against: number;
  last5_ppg_total: number;
  last5_tpm_avg: number;
  last5_rpg_total: number;
  last5_wins: number;
  last5_losses: number;
  last5_game_ids: number[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[basketball-stats-refresh] ===== START =====");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Auth check
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    let isAuthorized = authHeader === `Bearer ${serviceRoleKey}`;

    if (!isAuthorized && cronKeyHeader) {
      const { data: dbKey } = await supabase.rpc("get_cron_internal_key");
      if (cronKeyHeader === dbKey) isAuthorized = true;
    }

    if (!isAuthorized && authHeader) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (anonKey) {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } }
        });
        const { data: isWhitelisted } = await userClient.rpc("is_user_whitelisted");
        if (isWhitelisted) isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Get all teams that have at least one game with stats
    const { data: teamsWithGames, error: teamsError } = await supabase
      .from("basketball_game_team_stats")
      .select("team_id")
      .limit(1000);

    if (teamsError) {
      throw new Error(`Failed to fetch teams: ${teamsError.message}`);
    }

    const uniqueTeamIds = [...new Set((teamsWithGames || []).map((t: any) => t.team_id))];
    console.log(`[basketball-stats-refresh] Processing ${uniqueTeamIds.length} teams`);

    let upserted = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const teamId of uniqueTeamIds) {
      try {
        // Get team info
        const { data: teamInfo } = await supabase
          .from("basketball_teams")
          .select("league_key")
          .eq("id", teamId)
          .single();

        if (!teamInfo) continue;

        const leagueKey = teamInfo.league_key;
        const currentYear = new Date().getFullYear();
        const season = leagueKey.startsWith("nba") ? `${currentYear}` : `${currentYear - 1}-${currentYear}`;

        // Get all games for this team with stats (newest first)
        const { data: gameStats, error: statsError } = await supabase
          .from("basketball_game_team_stats")
          .select(`
            id, game_id, points, fgm, fga, fgp, tpm, tpa, rebounds_total, assists,
            is_home,
            game:basketball_games!inner(id, home_score, away_score, date)
          `)
          .eq("team_id", teamId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (statsError || !gameStats || gameStats.length === 0) {
          continue;
        }

        // Calculate season averages
        const sampleSize = gameStats.length;
        let totalPPGFor = 0;
        let totalPPGAgainst = 0;
        let totalRPG = 0;
        let totalAPG = 0;
        let totalTPM = 0;
        let totalFGP = 0;
        let fgpCount = 0;

        for (const stat of gameStats) {
          totalPPGFor += stat.points || 0;
          totalRPG += stat.rebounds_total || 0;
          totalAPG += stat.assists || 0;
          totalTPM += stat.tpm || 0;
          if (stat.fgp) {
            totalFGP += stat.fgp;
            fgpCount++;
          }

          // Calculate points against
          const game = stat.game as any;
          if (game) {
            const opponentScore = stat.is_home ? game.away_score : game.home_score;
            totalPPGAgainst += opponentScore || 0;
          }
        }

        const ppgFor = sampleSize > 0 ? totalPPGFor / sampleSize : 0;
        const ppgAgainst = sampleSize > 0 ? totalPPGAgainst / sampleSize : 0;
        const ppgTotal = ppgFor + ppgAgainst;
        const rpgTotal = sampleSize > 0 ? totalRPG / sampleSize : 0;
        const apgTotal = sampleSize > 0 ? totalAPG / sampleSize : 0;
        const tpmAvg = sampleSize > 0 ? totalTPM / sampleSize : 0;
        const fgpAvg = fgpCount > 0 ? totalFGP / fgpCount : 0;

        // Calculate last 5 form
        const last5 = gameStats.slice(0, 5);
        let last5PPGFor = 0;
        let last5PPGAgainst = 0;
        let last5TPM = 0;
        let last5RPG = 0;
        let last5Wins = 0;
        let last5Losses = 0;
        const last5GameIds: number[] = [];

        for (const stat of last5) {
          last5PPGFor += stat.points || 0;
          last5TPM += stat.tpm || 0;
          last5RPG += stat.rebounds_total || 0;
          last5GameIds.push(stat.game_id);

          const game = stat.game as any;
          if (game) {
            const opponentScore = stat.is_home ? game.away_score : game.home_score;
            last5PPGAgainst += opponentScore || 0;

            // Win/loss
            const myScore = stat.points;
            if (myScore > opponentScore) {
              last5Wins++;
            } else {
              last5Losses++;
            }
          }
        }

        const last5Count = last5.length;
        const last5PPGForAvg = last5Count > 0 ? last5PPGFor / last5Count : 0;
        const last5PPGAgainstAvg = last5Count > 0 ? last5PPGAgainst / last5Count : 0;
        const last5TPMAvg = last5Count > 0 ? last5TPM / last5Count : 0;
        const last5RPGAvg = last5Count > 0 ? last5RPG / last5Count : 0;

        // Upsert to stats cache
        const { error: upsertError } = await supabase
          .from("basketball_stats_cache")
          .upsert({
            team_id: teamId,
            league_key: leagueKey,
            season: season,
            sample_size: sampleSize,
            ppg_for: Math.round(ppgFor * 10) / 10,
            ppg_against: Math.round(ppgAgainst * 10) / 10,
            ppg_total: Math.round(ppgTotal * 10) / 10,
            rpg_total: Math.round(rpgTotal * 10) / 10,
            apg_total: Math.round(apgTotal * 10) / 10,
            tpm_avg: Math.round(tpmAvg * 10) / 10,
            fgp_avg: Math.round(fgpAvg * 10) / 10,
            last5_ppg_for: Math.round(last5PPGForAvg * 10) / 10,
            last5_ppg_against: Math.round(last5PPGAgainstAvg * 10) / 10,
            last5_ppg_total: Math.round((last5PPGForAvg + last5PPGAgainstAvg) * 10) / 10,
            last5_tpm_avg: Math.round(last5TPMAvg * 10) / 10,
            last5_rpg_total: Math.round(last5RPGAvg * 10) / 10,
            last5_wins: last5Wins,
            last5_losses: last5Losses,
            last5_game_ids: last5GameIds,
          }, { onConflict: "team_id,league_key,season" });

        if (upsertError) {
          errors.push(`Team ${teamId}: ${upsertError.message}`);
          failed++;
        } else {
          upserted++;
        }
      } catch (err: any) {
        errors.push(`Team ${teamId}: ${err.message}`);
        failed++;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[basketball-stats-refresh] Completed in ${elapsed}ms: ${upserted} upserted, ${failed} failed`);

    // Log to pipeline
    await supabase.from("pipeline_run_logs").insert({
      job_name: "basketball-stats-refresh",
      run_started: new Date(startTime).toISOString(),
      run_finished: new Date().toISOString(),
      success: failed === 0,
      mode: "cron",
      processed: upserted,
      failed,
      details: {
        teams_processed: uniqueTeamIds.length,
        elapsed_ms: elapsed,
        errors: errors.slice(0, 10),
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        teams_processed: uniqueTeamIds.length,
        upserted,
        failed,
        elapsed_ms: elapsed,
        errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[basketball-stats-refresh] Fatal error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
