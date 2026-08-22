/*
 * SCORE TICKET LEGS - Process pending legs and mark WIN/LOSS/PUSH/VOID
 * 
 * Runs every 5 minutes via cron.
 * Scores legs based on fixture_results after match is finished (FT).
 * 
 * Uses RPC get_scorable_pending_legs which:
 * - INNER JOINs with fixture_results (FT) so we only get scorable legs
 * - Uses FOR UPDATE SKIP LOCKED to prevent double-processing
 * 
 * Scoring rules:
 * - goals: goals_home + goals_away
 * - corners: corners_home + corners_away  
 * - cards: cards_home + cards_away
 * 
 * over: actual > line = WIN, actual = line = PUSH, actual < line = LOSS
 * under: actual < line = WIN, actual = line = PUSH, actual > line = LOSS
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

interface ScorableLeg {
  claim_token: string;
  leg_id: string;
  ticket_id: string;
  user_id: string;
  fixture_id: number;
  market: string;
  side: string;
  line: number;
  goals_home: number;
  goals_away: number;
  corners_home: number | null;
  corners_away: number | null;
  cards_home: number | null;
  cards_away: number | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();
  const logs: string[] = [];

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Auth check - require service role, cron key, or admin user
  const auth = await checkCronOrAdminAuth(req, supabase, serviceRoleKey, "[score-ticket-legs]");
  if (!auth.authorized) {
    console.error("[score-ticket-legs] Unauthorized request");
    return new Response(
      JSON.stringify({ error: "Unauthorized", method: auth.method }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  logs.push(`[score] Authorized via ${auth.method}`);

  try {
    // Parse optional batch_size param
    const url = new URL(req.url);
    const batchSize = Math.min(parseInt(url.searchParams.get("batch_size") || "500"), 1000);

    logs.push(`[score] Starting with batch_size=${batchSize}`);

    // Step 1: atomically claim scorable legs with a durable lease token.
    const { data: scorableLegs, error: legsError } = await supabase
      .rpc("claim_scorable_ticket_legs", { batch_limit: batchSize });

    if (legsError) {
      logs.push(`[score] RPC error: ${legsError.message}`);
      throw legsError;
    }

    if (!scorableLegs || scorableLegs.length === 0) {
      logs.push("[score] No scorable legs found (all pending legs either have no FT results or are locked)");
      return new Response(
        JSON.stringify({
          success: true,
          scanned_legs: 0,
          scored_legs: 0,
          updated_tickets: 0,
          duration_ms: Date.now() - startTime,
          logs,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logs.push(`[score] Found ${scorableLegs.length} scorable legs with FT results`);

    // Step 2: Score each leg (results are already in the row from RPC)
    let scoredLegs = 0;
    let skippedLegs = 0;
    const ticketsToUpdate = new Set<string>();

    for (const leg of scorableLegs as ScorableLeg[]) {
      // Calculate actual value based on market
      let actualValue: number | null = null;
      const market = leg.market.toLowerCase();
      
      if (market === "goals" || market === "total_goals" || market === "over_under") {
        actualValue = leg.goals_home + leg.goals_away;
      } else if (market === "corners" || market === "total_corners") {
        if (leg.corners_home !== null && leg.corners_away !== null) {
          actualValue = leg.corners_home + leg.corners_away;
        }
      } else if (market === "cards" || market === "total_cards") {
        if (leg.cards_home !== null && leg.cards_away !== null) {
          actualValue = leg.cards_home + leg.cards_away;
        }
      } else if (market === "team_goals" || market === "team_total") {
        // For team-specific markets, we'd need side info like "home" or "away"
        // For now, skip these as they need more context
        await supabase.rpc("release_ticket_leg_score_claim", {
          p_leg_id: leg.leg_id,
          p_claim_token: leg.claim_token,
        });
        skippedLegs++;
        continue;
      }

      if (actualValue === null) {
        // Can't score without actual value (e.g., corners/cards not available)
        await supabase.rpc("release_ticket_leg_score_claim", {
          p_leg_id: leg.leg_id,
          p_claim_token: leg.claim_token,
        });
        skippedLegs++;
        continue;
      }

      // Determine result status
      let resultStatus: string;
      const side = leg.side.toLowerCase();
      
      if (side === "over") {
        if (actualValue > leg.line) {
          resultStatus = "WIN";
        } else if (actualValue === leg.line) {
          resultStatus = "PUSH";
        } else {
          resultStatus = "LOSS";
        }
      } else if (side === "under") {
        if (actualValue < leg.line) {
          resultStatus = "WIN";
        } else if (actualValue === leg.line) {
          resultStatus = "PUSH";
        } else {
          resultStatus = "LOSS";
        }
      } else {
        // Unknown side, skip
        logs.push(`[score] Unknown side "${leg.side}" for leg ${leg.leg_id}`);
        await supabase.rpc("release_ticket_leg_score_claim", {
          p_leg_id: leg.leg_id,
          p_claim_token: leg.claim_token,
        });
        skippedLegs++;
        continue;
      }

      const { data: finalized, error: updateError } = await supabase.rpc(
        "finalize_scored_ticket_leg",
        {
          p_leg_id: leg.leg_id,
          p_claim_token: leg.claim_token,
          p_result_status: resultStatus,
          p_actual_value: actualValue,
          p_scored_version: "v1.3-durable-claim",
        },
      );

      if (updateError || finalized !== true) {
        logs.push(`[score] Error updating leg ${leg.leg_id}: ${updateError?.message ?? "claim no longer owned"}`);
        continue;
      }

      scoredLegs++;
      ticketsToUpdate.add(leg.ticket_id);
    }

    logs.push(`[score] Scored ${scoredLegs} legs, skipped ${skippedLegs}`);

    // Step 3: Update ticket summaries
    let updatedTickets = 0;

    for (const ticketId of ticketsToUpdate) {
      const { error: ticketUpdateError } = await supabase.rpc(
        "refresh_ticket_outcome",
        { p_ticket_id: ticketId },
      );

      if (ticketUpdateError) {
        logs.push(`[score] Error updating ticket ${ticketId}: ${ticketUpdateError.message}`);
        continue;
      }

      updatedTickets++;
    }

    logs.push(`[score] Updated ${updatedTickets} tickets`);

    return new Response(
      JSON.stringify({
        success: true,
        scanned_legs: scorableLegs.length,
        scored_legs: scoredLegs,
        skipped_legs: skippedLegs,
        updated_tickets: updatedTickets,
        duration_ms: Date.now() - startTime,
        logs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[score] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        logs,
        duration_ms: Date.now() - startTime,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
