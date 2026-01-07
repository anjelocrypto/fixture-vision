/*
 * SCORE TICKET LEGS - Process pending legs and mark WIN/LOSS/PUSH/VOID
 * 
 * Runs every 5 minutes via cron.
 * Scores legs based on fixture_results after match is finished (FT).
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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FixtureResult {
  fixture_id: number;
  goals_home: number;
  goals_away: number;
  corners_home: number | null;
  corners_away: number | null;
  cards_home: number | null;
  cards_away: number | null;
  status: string;
}

interface PendingLeg {
  id: string;
  ticket_id: string;
  user_id: string;
  fixture_id: number;
  market: string;
  side: string;
  line: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();
  const logs: string[] = [];

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Parse optional batch_size param
    const url = new URL(req.url);
    const batchSize = Math.min(parseInt(url.searchParams.get("batch_size") || "500"), 1000);

    logs.push(`[score] Starting with batch_size=${batchSize}`);

    // Step 1: Get pending legs where kickoff was > 2 hours ago
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    
    const { data: pendingLegs, error: legsError } = await supabase
      .from("ticket_leg_outcomes")
      .select("id, ticket_id, user_id, fixture_id, market, side, line")
      .eq("result_status", "PENDING")
      .lt("kickoff_at", twoHoursAgo)
      .limit(batchSize);

    if (legsError) throw legsError;

    if (!pendingLegs || pendingLegs.length === 0) {
      logs.push("[score] No pending legs to score");
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

    logs.push(`[score] Found ${pendingLegs.length} pending legs`);

    // Step 2: Get unique fixture IDs and fetch results
    const fixtureIds = [...new Set(pendingLegs.map(leg => leg.fixture_id))];
    
    const { data: fixtureResults, error: resultsError } = await supabase
      .from("fixture_results")
      .select("fixture_id, goals_home, goals_away, corners_home, corners_away, cards_home, cards_away, status")
      .in("fixture_id", fixtureIds)
      .eq("status", "FT");

    if (resultsError) throw resultsError;

    // Build lookup map
    const resultMap = new Map<number, FixtureResult>();
    for (const r of fixtureResults || []) {
      resultMap.set(r.fixture_id, r);
    }

    logs.push(`[score] Found ${resultMap.size} finished fixtures out of ${fixtureIds.length}`);

    // Step 3: Score each leg
    let scoredLegs = 0;
    let skippedLegs = 0;
    const ticketsToUpdate = new Set<string>();

    for (const leg of pendingLegs) {
      const result = resultMap.get(leg.fixture_id);
      
      if (!result) {
        // Fixture not finished yet, skip
        skippedLegs++;
        continue;
      }

      // Calculate actual value based on market
      let actualValue: number | null = null;
      const market = leg.market.toLowerCase();
      
      if (market === "goals" || market === "total_goals" || market === "over_under") {
        actualValue = result.goals_home + result.goals_away;
      } else if (market === "corners" || market === "total_corners") {
        if (result.corners_home !== null && result.corners_away !== null) {
          actualValue = result.corners_home + result.corners_away;
        }
      } else if (market === "cards" || market === "total_cards") {
        if (result.cards_home !== null && result.cards_away !== null) {
          actualValue = result.cards_home + result.cards_away;
        }
      } else if (market === "team_goals" || market === "team_total") {
        // For team-specific markets, we'd need side info like "home" or "away"
        // For now, skip these as they need more context
        skippedLegs++;
        continue;
      }

      if (actualValue === null) {
        // Can't score without actual value
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
        logs.push(`[score] Unknown side "${leg.side}" for leg ${leg.id}`);
        skippedLegs++;
        continue;
      }

      // Update the leg
      const { error: updateError } = await supabase
        .from("ticket_leg_outcomes")
        .update({
          result_status: resultStatus,
          actual_value: actualValue,
          settled_at: new Date().toISOString(),
          scored_version: "v1.0",
        })
        .eq("id", leg.id);

      if (updateError) {
        logs.push(`[score] Error updating leg ${leg.id}: ${updateError.message}`);
        continue;
      }

      scoredLegs++;
      ticketsToUpdate.add(leg.ticket_id);
    }

    logs.push(`[score] Scored ${scoredLegs} legs, skipped ${skippedLegs}`);

    // Step 4: Update ticket summaries
    let updatedTickets = 0;

    for (const ticketId of ticketsToUpdate) {
      // Get all legs for this ticket
      const { data: ticketLegs, error: ticketLegsError } = await supabase
        .from("ticket_leg_outcomes")
        .select("result_status")
        .eq("ticket_id", ticketId);

      if (ticketLegsError || !ticketLegs) {
        logs.push(`[score] Error fetching legs for ticket ${ticketId}`);
        continue;
      }

      // Count by status
      let legsWon = 0;
      let legsLost = 0;
      let legsPushed = 0;
      let legsVoid = 0;
      let legsPending = 0;

      for (const tl of ticketLegs) {
        switch (tl.result_status) {
          case "WIN": legsWon++; break;
          case "LOSS": legsLost++; break;
          case "PUSH": legsPushed++; break;
          case "VOID": legsVoid++; break;
          default: legsPending++; break;
        }
      }

      const legsTotal = ticketLegs.length;
      const legsSettled = legsWon + legsLost + legsPushed + legsVoid;

      // Determine ticket status
      let ticketStatus: string;
      if (legsLost > 0) {
        ticketStatus = "LOST";
      } else if (legsSettled === legsTotal && legsVoid === legsTotal) {
        ticketStatus = "VOID";
      } else if (legsSettled === legsTotal && legsLost === 0) {
        ticketStatus = "WON";
      } else if (legsSettled > 0 && legsSettled < legsTotal) {
        ticketStatus = "PARTIAL";
      } else {
        ticketStatus = "PENDING";
      }

      // Update ticket_outcomes
      const { error: ticketUpdateError } = await supabase
        .from("ticket_outcomes")
        .update({
          legs_settled: legsSettled,
          legs_won: legsWon,
          legs_lost: legsLost,
          legs_pushed: legsPushed,
          legs_void: legsVoid,
          ticket_status: ticketStatus,
          settled_at: legsSettled === legsTotal ? new Date().toISOString() : null,
        })
        .eq("ticket_id", ticketId);

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
        scanned_legs: pendingLegs.length,
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
