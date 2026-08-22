import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { syncLeaguePlayerImportance } from "../_shared/player_importance.ts";
import { ALLOWED_LEAGUE_IDS } from "../_shared/leagues.ts";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";
import { readJsonWithLimit } from "../_shared/request.ts";
import { getFootballSeasonForLeague } from "../_shared/season.ts";
import {
  clampProviderCallLimit,
  ProviderCallBudget,
  ProviderControlError,
} from "../_shared/provider_budget.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_PROVIDER_CALLS_PER_RUN = 10;

serve(async (req) => {
  console.log("[sync-player-importance] Function invoked", { method: req.method });
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      serviceRoleKey,
    );
    const auth = await checkCronOrAdminAuth(req, supabaseClient, serviceRoleKey, "[sync-player-importance]");
    if (!auth.authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await readJsonWithLimit(req, 16_384).catch(() => null) ?? {}) as Record<string, unknown>;
    if (auth.method !== "cron_key" && body.confirm_provider_calls !== true) {
      return new Response(JSON.stringify({ error: "Manual provider calls require confirm_provider_calls=true" }), {
        status: 412,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const providerBudget = new ProviderCallBudget(
      clampProviderCallLimit(body.max_provider_calls, MAX_PROVIDER_CALLS_PER_RUN),
    );
    const now = new Date();
    
    // Default leagues: top 5 major leagues (EPL, La Liga, Serie A, Bundesliga, Ligue 1)
    // We limit to these to keep sync fast and API costs reasonable
    const TOP_LEAGUES = [39, 140, 135, 78, 61]; // Premier League, La Liga, Serie A, Bundesliga, Ligue 1
    let targetLeagues = Array.isArray(body.league_ids)
      ? body.league_ids.map(Number).filter((id) => ALLOWED_LEAGUE_IDS.includes(id))
      : TOP_LEAGUES;
    
    // Safety limit: max 10 leagues per run to avoid timeout (60s Edge Function limit)
    // Each league takes ~5-10 seconds depending on number of teams
    if (Array.isArray(targetLeagues) && targetLeagues.length > 10) {
      console.log(`[sync-player-importance] WARNING: Limiting to first 10 of ${targetLeagues.length} leagues to avoid timeout`);
      targetLeagues = targetLeagues.slice(0, 10);
    }
    
    console.log(`[sync-player-importance] 🚀 Starting bounded sync`);
    console.log(`[sync-player-importance] Target leagues: [${targetLeagues.join(', ')}]`);
    
    // Insert initial pipeline log for observability
    const runStarted = new Date();
    let pipelineLogId: number | null = null;
    try {
      const { data: logData } = await supabaseClient
        .from("pipeline_run_logs")
        .insert({
          job_name: "sync-player-importance",
          run_started: runStarted.toISOString(),
          success: false,
          mode: auth.method === "cron_key" ? "cron" : "manual",
          processed: 0,
          failed: 0,
          leagues_covered: targetLeagues,
          details: { status: "started", provider: providerBudget.snapshot() },
        })
        .select("id")
        .single();
      pipelineLogId = logData?.id || null;
    } catch (e) {
      console.error("[sync-player-importance] Failed to insert pipeline log:", e);
    }
    
    const results: Array<{ league_id: number; teams_processed: number; players_synced: number; error?: string }> = [];
    let totalTeams = 0;
    let totalPlayers = 0;
    
    for (const leagueId of targetLeagues) {
      if (providerBudget.remaining === 0) break;
      try {
        console.log(`[sync-player-importance] Processing league ${leagueId}...`);
        const season = typeof body.season === "number"
          ? Math.floor(body.season)
          : getFootballSeasonForLeague(leagueId, now);
        const result = await syncLeaguePlayerImportance(
          leagueId,
          season,
          supabaseClient,
          providerBudget,
          Math.floor(now.getTime() / (24 * 60 * 60 * 1000)),
        );
        
        results.push({
          league_id: leagueId,
          teams_processed: result.teams_processed,
          players_synced: result.players_synced,
        });
        
        totalTeams += result.teams_processed;
        totalPlayers += result.players_synced;
        
        console.log(`[sync-player-importance] ✅ League ${leagueId} complete: ${result.teams_processed} teams, ${result.players_synced} players`);
        
      } catch (error) {
        console.error(`[sync-player-importance] ❌ Error syncing league ${leagueId}:`, error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({
          league_id: leagueId,
          teams_processed: 0,
          players_synced: 0,
          error: errorMsg,
        });
        if (error instanceof ProviderControlError) break;
      }
    }
    
    const failedLeagues = results.filter(r => r.error).length;
    console.log(`[sync-player-importance] 🎉 Sync complete: ${totalTeams} teams, ${totalPlayers} players across ${targetLeagues.length} leagues`);
    
    // Update pipeline log on success
    if (pipelineLogId) {
      try {
        await supabaseClient
          .from("pipeline_run_logs")
          .update({
            run_finished: new Date().toISOString(),
            success: failedLeagues === 0 && providerBudget.failures === 0,
            processed: totalPlayers,
            failed: failedLeagues,
            leagues_covered: targetLeagues,
            details: { 
              total_teams: totalTeams,
              total_players: totalPlayers,
              results,
              provider: providerBudget.snapshot(),
            },
          })
          .eq("id", pipelineLogId);
      } catch (e) {
        console.error("[sync-player-importance] Failed to update pipeline log:", e);
      }
    }
    
    return new Response(
      JSON.stringify({
        success: failedLeagues === 0 && providerBudget.failures === 0,
        leagues_processed: targetLeagues.length,
        total_teams: totalTeams,
        total_players: totalPlayers,
        results,
        provider: providerBudget.snapshot(),
      }),
      {
        status: failedLeagues === 0 && providerBudget.failures === 0 ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
    
  } catch (error) {
    console.error("[sync-player-importance] ❌ CRITICAL ERROR:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    const stackTrace = error instanceof Error ? error.stack : undefined;
    
    console.error("[sync-player-importance] Error details:", { message: errorMsg, stack: stackTrace });
    
    return new Response(
      JSON.stringify({ 
        error: "Internal server error",
        message: errorMsg,
        details: stackTrace
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
