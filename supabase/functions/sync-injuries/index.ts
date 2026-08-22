import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchLeagueInjuries } from "../_shared/injuries.ts";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";
import { UPCOMING_WINDOW_HOURS } from "../_shared/config.ts";
import { readJsonWithLimit } from "../_shared/request.ts";
import { getFootballSeasonForLeague } from "../_shared/season.ts";
import {
  boundedRotatingSelection,
  clampProviderCallLimit,
  ProviderCallBudget,
  ProviderControlError,
} from "../_shared/provider_budget.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};
const MAX_PROVIDER_CALLS_PER_RUN = 4;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      serviceRoleKey,
    );
    const auth = await checkCronOrAdminAuth(req, supabaseClient, serviceRoleKey, "[sync-injuries]");
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
    
    // Default to all active leagues if not specified
    let leagueIds = Array.isArray(body.league_ids) ? body.league_ids.map(Number).filter(Number.isInteger) : [];
    if (!leagueIds || !Array.isArray(leagueIds) || leagueIds.length === 0) {
      // Fetch distinct league IDs from upcoming fixtures
      const { data: upcomingLeagues } = await supabaseClient
        .from("fixtures")
        .select("league_id")
        .gte("timestamp", Math.floor(Date.now() / 1000))
        .lte("timestamp", Math.floor((Date.now() + UPCOMING_WINDOW_HOURS * 60 * 60 * 1000) / 1000))
        .in("status", ["NS", "TBD"]);
      
      if (upcomingLeagues && upcomingLeagues.length > 0) {
        leagueIds = [...new Set(upcomingLeagues.map((f: any) => f.league_id))];
      } else {
        leagueIds = [];
      }
    }

    leagueIds = boundedRotatingSelection(
      [...new Set<number>(leagueIds)],
      providerBudget.limit,
      Math.floor(now.getTime() / (4 * 60 * 60 * 1000)),
    );

    console.log(`[sync-injuries] Syncing injuries for ${leagueIds.length} bounded leagues`);

    // Insert initial pipeline log for observability
    const runStarted = new Date();
    let pipelineLogId: number | null = null;
    try {
      const { data: logData } = await supabaseClient
        .from("pipeline_run_logs")
        .insert({
          job_name: "sync-injuries",
          run_started: runStarted.toISOString(),
          success: false,
          mode: auth.method === "cron_key" ? "cron" : "manual",
          processed: 0,
          failed: 0,
          leagues_covered: leagueIds,
          details: { status: "started", provider: providerBudget.snapshot() },
        })
        .select("id")
        .single();
      pipelineLogId = logData?.id || null;
    } catch (e) {
      console.error("[sync-injuries] Failed to insert pipeline log:", e);
    }

    let totalFetched = 0;
    let totalUpserted = 0;
    let failedLeagues = 0;
    const leagueResults: Record<number, number> = {};

    // Fetch and upsert injuries for each league
    for (const leagueId of leagueIds) {
      try {
        const season = typeof body.season === "number"
          ? Math.floor(body.season)
          : getFootballSeasonForLeague(leagueId, now);
        const injuries = await fetchLeagueInjuries(leagueId, season, providerBudget);
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

          // Add last_update timestamp to all injuries
          const now = new Date().toISOString();
          const injuriesWithTimestamp = uniqueInjuries.map((injury: any) => ({
            ...injury,
            last_update: now,
          }));

          // Upsert injuries to database
          const { error: upsertError } = await supabaseClient
            .from("player_injuries")
            .upsert(injuriesWithTimestamp, {
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
        failedLeagues++;
        console.error(`[sync-injuries] Error processing league ${leagueId}:`, err);
        if (err instanceof ProviderControlError) break;
      }
    }

    console.log(`[sync-injuries] ✅ Sync complete: ${totalFetched} fetched, ${totalUpserted} upserted`);

    // Update pipeline log on success
    if (pipelineLogId) {
      try {
        await supabaseClient
          .from("pipeline_run_logs")
          .update({
            run_finished: new Date().toISOString(),
            success: failedLeagues === 0 && providerBudget.failures === 0,
            processed: totalUpserted,
            failed: failedLeagues,
            leagues_covered: leagueIds,
            details: { 
              total_fetched: totalFetched,
              total_upserted: totalUpserted,
              league_results: leagueResults,
              provider: providerBudget.snapshot(),
            },
          })
          .eq("id", pipelineLogId);
      } catch (e) {
        console.error("[sync-injuries] Failed to update pipeline log:", e);
      }
    }

    return new Response(
      JSON.stringify({
        success: failedLeagues === 0 && providerBudget.failures === 0,
        leagues_processed: leagueIds.length,
        total_injuries_fetched: totalFetched,
        total_injuries_upserted: totalUpserted,
        league_results: leagueResults,
        provider: providerBudget.snapshot(),
      }),
      {
        status: failedLeagues === 0 && providerBudget.failures === 0 ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[sync-injuries] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Log failure if we have a pipeline log id
    // Note: pipelineLogId might not be in scope here if error happened early
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
