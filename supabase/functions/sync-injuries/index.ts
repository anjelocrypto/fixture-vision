import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchLeagueInjuries } from "../_shared/injuries.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authorization: X-CRON-KEY for internal cron calls
    const cronKey = req.headers.get("X-CRON-KEY");
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify CRON key
    if (cronKey) {
      const { data: keyData } = await supabaseClient.rpc("get_cron_internal_key");
      if (cronKey !== keyData) {
        console.log("[sync-injuries] Invalid CRON key");
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.log("[sync-injuries] Authorized via X-CRON-KEY");
    } else {
      // JWT verification for manual admin calls
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Missing authorization header" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check if user is admin
      const { data: isAdmin } = await supabaseClient.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });

      if (!isAdmin) {
        return new Response(
          JSON.stringify({ error: "Admin access required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Parse request body
    const { league_ids, season } = await req.json().catch(() => ({}));
    
    // Default to current season
    const now = new Date();
    const month = now.getUTCMonth();
    const year = now.getUTCFullYear();
    const currentSeason = season || (month >= 7 ? year : year - 1);
    
    // Default to all active leagues if not specified
    let leagueIds = league_ids;
    if (!leagueIds || !Array.isArray(leagueIds) || leagueIds.length === 0) {
      // Fetch distinct league IDs from upcoming fixtures
      const { data: upcomingLeagues } = await supabaseClient
        .from("fixtures")
        .select("league_id")
        .gte("timestamp", Math.floor(Date.now() / 1000))
        .lte("timestamp", Math.floor((Date.now() + 120 * 60 * 60 * 1000) / 1000))
        .in("status", ["NS", "TBD"]);
      
      if (upcomingLeagues && upcomingLeagues.length > 0) {
        leagueIds = [...new Set(upcomingLeagues.map((f: any) => f.league_id))];
      } else {
        leagueIds = [];
      }
    }

    console.log(`[sync-injuries] Syncing injuries for ${leagueIds.length} leagues, season ${currentSeason}`);

    let totalFetched = 0;
    let totalUpserted = 0;
    const leagueResults: Record<number, number> = {};

    // Fetch and upsert injuries for each league
    for (const leagueId of leagueIds) {
      try {
        const injuries = await fetchLeagueInjuries(leagueId, currentSeason);
        leagueResults[leagueId] = injuries.length;
        totalFetched += injuries.length;

        if (injuries.length > 0) {
          // Deduplicate injuries based on unique key (player_id, team_id, league_id, season)
          // Keep only the latest injury record per player
          const uniqueInjuries = injuries.reduce((acc: any[], injury: any) => {
            const key = `${injury.player_id}-${injury.team_id}-${injury.league_id}-${injury.season}`;
            const existing = acc.find(i => 
              `${i.player_id}-${i.team_id}-${i.league_id}-${i.season}` === key
            );
            if (!existing) {
              acc.push(injury);
            }
            return acc;
          }, []);
          
          console.log(`[sync-injuries] Deduped from ${injuries.length} to ${uniqueInjuries.length} unique injuries for league ${leagueId}`);

          // Upsert injuries to database
          const { error: upsertError } = await supabaseClient
            .from("player_injuries")
            .upsert(uniqueInjuries, {
              onConflict: "player_id,team_id,league_id,season",
              ignoreDuplicates: false,
            });

          if (upsertError) {
            console.error(`[sync-injuries] Error upserting injuries for league ${leagueId}:`, upsertError);
          } else {
            totalUpserted += uniqueInjuries.length;
            console.log(`[sync-injuries] ✅ Upserted ${uniqueInjuries.length} injuries for league ${leagueId}`);
          }
        } else {
          console.log(`[sync-injuries] No injuries found for league ${leagueId}`);
        }

        // Rate limiting: 50 requests per minute
        await new Promise(resolve => setTimeout(resolve, 1200));
      } catch (err) {
        console.error(`[sync-injuries] Error processing league ${leagueId}:`, err);
      }
    }

    console.log(`[sync-injuries] ✅ Sync complete: ${totalFetched} fetched, ${totalUpserted} upserted`);

    return new Response(
      JSON.stringify({
        success: true,
        season: currentSeason,
        leagues_processed: leagueIds.length,
        total_injuries_fetched: totalFetched,
        total_injuries_upserted: totalUpserted,
        league_results: leagueResults,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[sync-injuries] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
