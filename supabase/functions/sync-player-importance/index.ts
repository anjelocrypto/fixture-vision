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
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Authentication: cron key or admin user
    const cronKey = req.headers.get("X-CRON-KEY");
    const authHeader = req.headers.get("authorization");
    
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    
    let isAuthorized = false;
    
    // Check cron key
    if (cronKey) {
      const { data: storedKey } = await supabaseClient.rpc('get_cron_internal_key');
      if (storedKey && cronKey === storedKey) {
        isAuthorized = true;
        console.log("[sync-player-importance] Authorized via cron key");
      }
    }
    
    // Check admin role
    if (!isAuthorized && authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
      
      if (!authError && user) {
        const { data: hasAdmin } = await supabaseClient.rpc('has_role', {
          _user_id: user.id,
          _role: 'admin'
        });
        
        if (hasAdmin) {
          isAuthorized = true;
          console.log("[sync-player-importance] Authorized as admin user");
        }
      }
    }
    
    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }
    
    // Parse request body
    const { league_ids, season } = await req.json().catch(() => ({}));
    
    // Default to current season
    const now = new Date();
    const month = now.getUTCMonth();
    const year = now.getUTCFullYear();
    const currentSeason = season || ((month >= 7) ? year : year - 1);
    
    // Default to active leagues with upcoming fixtures
    let targetLeagues = league_ids || ALLOWED_LEAGUE_IDS;
    
    // Limit to first 10 leagues per run to avoid timeout
    if (Array.isArray(targetLeagues) && targetLeagues.length > 10) {
      console.log(`[sync-player-importance] Limiting to first 10 of ${targetLeagues.length} leagues`);
      targetLeagues = targetLeagues.slice(0, 10);
    }
    
    console.log(`[sync-player-importance] Starting sync for ${targetLeagues.length} leagues, season ${currentSeason}`);
    
    const results: Array<{ league_id: number; teams_processed: number; players_synced: number; error?: string }> = [];
    let totalTeams = 0;
    let totalPlayers = 0;
    
    for (const leagueId of targetLeagues) {
      try {
        const result = await syncLeaguePlayerImportance(leagueId, currentSeason, supabaseClient);
        
        results.push({
          league_id: leagueId,
          teams_processed: result.teams_processed,
          players_synced: result.players_synced,
        });
        
        totalTeams += result.teams_processed;
        totalPlayers += result.players_synced;
        
        console.log(`[sync-player-importance] League ${leagueId}: ${result.teams_processed} teams, ${result.players_synced} players`);
        
      } catch (error) {
        console.error(`[sync-player-importance] Error syncing league ${leagueId}:`, error);
        results.push({
          league_id: leagueId,
          teams_processed: 0,
          players_synced: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    
    console.log(`[sync-player-importance] ✅ Sync complete: ${totalTeams} teams, ${totalPlayers} players across ${targetLeagues.length} leagues`);
    
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
    console.error("[sync-player-importance] Internal error:", error);
    return new Response(
      JSON.stringify({ 
        error: "Internal server error",
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
