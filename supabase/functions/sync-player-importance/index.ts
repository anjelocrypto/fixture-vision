import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { syncLeaguePlayerImportance } from "../_shared/player_importance.ts";
import { ALLOWED_LEAGUE_IDS } from "../_shared/leagues.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  console.log("[sync-player-importance] Function invoked", { method: req.method, headers: Object.fromEntries(req.headers.entries()) });
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    
    // Authorization: X-CRON-KEY for internal cron calls, or admin JWT for manual calls
    const cronKey = req.headers.get("X-CRON-KEY");
    
    if (cronKey) {
      // Verify CRON key
      console.log("[sync-player-importance] Checking X-CRON-KEY...");
      const { data: keyData, error: keyError } = await supabaseClient.rpc("get_cron_internal_key");
      
      if (keyError) {
        console.error("[sync-player-importance] Error fetching cron key:", keyError);
        return new Response(
          JSON.stringify({ error: "Internal error verifying cron key" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (cronKey !== keyData) {
        console.error("[sync-player-importance] Invalid CRON key provided");
        return new Response(
          JSON.stringify({ error: "Unauthorized - invalid cron key" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      console.log("[sync-player-importance] ✅ Authorized via X-CRON-KEY");
    } else {
      // JWT verification for manual admin calls
      console.log("[sync-player-importance] No X-CRON-KEY, checking JWT authorization...");
      const authHeader = req.headers.get("Authorization");
      
      if (!authHeader) {
        console.error("[sync-player-importance] Missing authorization header");
        return new Response(
          JSON.stringify({ error: "Missing authorization header" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

      if (authError || !user) {
        console.error("[sync-player-importance] Invalid JWT token:", authError);
        return new Response(
          JSON.stringify({ error: "Unauthorized - invalid token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check if user is admin
      const { data: isAdmin, error: roleError } = await supabaseClient.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });

      if (roleError || !isAdmin) {
        console.error("[sync-player-importance] User is not admin:", roleError);
        return new Response(
          JSON.stringify({ error: "Admin access required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      console.log("[sync-player-importance] ✅ Authorized as admin user");
    }
    
    // Parse request body
    const { league_ids, season } = await req.json().catch(() => ({}));
    
    // Default to current season
    const now = new Date();
    const month = now.getUTCMonth();
    const year = now.getUTCFullYear();
    const currentSeason = season || ((month >= 7) ? year : year - 1);
    
    // Default leagues: top 5 major leagues (EPL, La Liga, Serie A, Bundesliga, Ligue 1)
    // We limit to these to keep sync fast and API costs reasonable
    const TOP_LEAGUES = [39, 140, 135, 78, 61]; // Premier League, La Liga, Serie A, Bundesliga, Ligue 1
    let targetLeagues = league_ids || TOP_LEAGUES;
    
    // Safety limit: max 10 leagues per run to avoid timeout (60s Edge Function limit)
    // Each league takes ~5-10 seconds depending on number of teams
    if (Array.isArray(targetLeagues) && targetLeagues.length > 10) {
      console.log(`[sync-player-importance] WARNING: Limiting to first 10 of ${targetLeagues.length} leagues to avoid timeout`);
      targetLeagues = targetLeagues.slice(0, 10);
    }
    
    console.log(`[sync-player-importance] 🚀 Starting sync for season ${currentSeason}`);
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
          mode: cronKey ? "cron" : "manual",
          processed: 0,
          failed: 0,
          leagues_covered: targetLeagues,
          details: { status: "started", season: currentSeason },
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
      try {
        console.log(`[sync-player-importance] Processing league ${leagueId}...`);
        const result = await syncLeaguePlayerImportance(leagueId, currentSeason, supabaseClient);
        
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
            success: failedLeagues === 0,
            processed: totalPlayers,
            failed: failedLeagues,
            leagues_covered: targetLeagues,
            details: { 
              season: currentSeason,
              total_teams: totalTeams,
              total_players: totalPlayers,
              results,
            },
          })
          .eq("id", pipelineLogId);
      } catch (e) {
        console.error("[sync-player-importance] Failed to update pipeline log:", e);
      }
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        season: currentSeason,
        leagues_processed: targetLeagues.length,
        total_teams: totalTeams,
        total_players: totalPlayers,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
