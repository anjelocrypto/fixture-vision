/*
 * BACKFILL TICKET OUTCOMES
 * 
 * One-time/batch Edge Function to populate ticket_leg_outcomes + ticket_outcomes
 * for historical tickets that were created before the outcome tracking system.
 * 
 * Processes tickets in batches (default 100) to avoid timeouts.
 * Safe to run multiple times - uses upsert with ignoreDuplicates.
 * 
 * Query params:
 * - batch_size: Number of tickets to process (default 100, max 500)
 * - dry_run: If "true", only logs what would be done without inserting
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LegJson {
  fixtureId: number;
  market: string;
  selection: string;
  odds: number;
  bookmaker?: string;
  source?: string;
  start?: string;
  line?: number;
  side?: string;
  homeTeam?: string;
  awayTeam?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const startTime = Date.now();
  const logs: string[] = [];

  try {
    // Auth check - require admin or service role
    const authHeader = req.headers.get("authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Parse query params
    const url = new URL(req.url);
    const batchSize = Math.min(parseInt(url.searchParams.get("batch_size") || "100"), 500);
    const dryRun = url.searchParams.get("dry_run") === "true";

    logs.push(`[backfill] Starting with batch_size=${batchSize}, dry_run=${dryRun}`);

    // Get count of existing outcomes
    const { count: existingOutcomeCount } = await supabase
      .from("ticket_outcomes")
      .select("ticket_id", { count: "exact", head: true });

    logs.push(`[backfill] Found ${existingOutcomeCount || 0} tickets already with outcomes`);

    // Get count of total tickets
    const { count: totalTicketCount } = await supabase
      .from("generated_tickets")
      .select("id", { count: "exact", head: true });

    const ticketsNeeded = (totalTicketCount || 0) - (existingOutcomeCount || 0);
    logs.push(`[backfill] Approx ${ticketsNeeded} tickets need backfill`);

    if (ticketsNeeded <= 0) {
      logs.push("[backfill] All tickets already have outcomes");
      return new Response(
        JSON.stringify({ 
          success: true, 
          processed: 0, 
          already_done: existingOutcomeCount || 0,
          remaining: 0,
          logs, 
          duration_ms: Date.now() - startTime 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get ticket IDs that already have outcomes
    const { data: existingOutcomeIds } = await supabase
      .from("ticket_outcomes")
      .select("ticket_id");

    const existingTicketIds = new Set((existingOutcomeIds || []).map((o: { ticket_id: string }) => o.ticket_id));

    // Fetch tickets in pages until we have enough for this batch
    const ticketsNeedingBackfill: Array<{
      id: string;
      user_id: string;
      total_odds: number;
      legs: LegJson[];
      created_at: string;
    }> = [];

    let offset = 0;
    const pageSize = 500; // Fetch in pages to avoid 1000 row limit

    while (ticketsNeedingBackfill.length < batchSize) {
      const { data: ticketPage, error: queryError } = await supabase
        .from("generated_tickets")
        .select(`id, user_id, total_odds, legs, created_at`)
        .order("created_at", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (queryError) throw queryError;
      if (!ticketPage || ticketPage.length === 0) break; // No more tickets

      for (const t of ticketPage) {
        if (!existingTicketIds.has(t.id)) {
          ticketsNeedingBackfill.push(t);
          if (ticketsNeedingBackfill.length >= batchSize) break;
        }
      }

      offset += pageSize;
      
      // Safety check - if we've scanned a lot and found nothing, exit
      if (offset > 10000) {
        logs.push(`[backfill] Scanned ${offset} tickets, stopping pagination`);
        break;
      }
    }

    if (ticketsNeedingBackfill.length === 0) {
      logs.push("[backfill] All tickets already have outcomes");
      return new Response(
        JSON.stringify({ 
          success: true, 
          processed: 0, 
          already_done: existingTicketIds.size,
          remaining: 0,
          logs, 
          duration_ms: Date.now() - startTime 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logs.push(`[backfill] Found ${ticketsNeedingBackfill.length} tickets to process this batch`);

    // Collect all fixture IDs across all tickets for bulk lookup
    const allFixtureIds = new Set<number>();
    for (const ticket of ticketsNeedingBackfill) {
      const legs = ticket.legs as LegJson[];
      for (const leg of legs) {
        if (leg.fixtureId) allFixtureIds.add(leg.fixtureId);
      }
    }

    // Bulk fetch fixture data (league_id, timestamp)
    const { data: fixturesData } = await supabase
      .from("fixtures")
      .select("id, league_id, timestamp")
      .in("id", Array.from(allFixtureIds));

    const fixtureMap = new Map<number, { league_id: number | null; kickoff_at: string | null }>();
    for (const f of fixturesData || []) {
      fixtureMap.set(f.id, {
        league_id: f.league_id,
        kickoff_at: f.timestamp ? new Date(f.timestamp * 1000).toISOString() : null,
      });
    }

    logs.push(`[backfill] Loaded ${fixtureMap.size} fixtures for league_id lookup`);

    // Process each ticket
    let processedTickets = 0;
    let insertedLegs = 0;
    let skippedLegs = 0;
    let insertedTicketOutcomes = 0;

    for (const ticket of ticketsNeedingBackfill) {
      const legs = ticket.legs as LegJson[];
      const legOutcomes: Array<{
        ticket_id: string;
        user_id: string;
        fixture_id: number;
        league_id: number | null;
        market: string;
        side: string;
        line: number;
        odds: number;
        selection_key: string;
        selection: string;
        source: string;
        picked_at: string;
        kickoff_at: string | null;
        result_status: string;
        derived_from_selection: boolean;
      }> = [];

      for (const leg of legs) {
        // Parse side and line
        const selectionLower = (leg.selection || "").toLowerCase().trim();
        let side: string;
        let line: number;

        if (leg.side && leg.line !== undefined && leg.line > 0) {
          side = leg.side;
          line = leg.line;
        } else {
          side = selectionLower.startsWith("under") || selectionLower.startsWith("u") ? "under" : "over";
          const lineMatch = selectionLower.match(/([\d.]+)/);
          line = lineMatch ? parseFloat(lineMatch[1]) : 0;
        }

        // Skip invalid legs
        if (line <= 0) {
          skippedLegs++;
          continue;
        }

        // Get fixture info
        const fixtureInfo = fixtureMap.get(leg.fixtureId);
        const leagueId = fixtureInfo?.league_id ?? null;
        const kickoffAt = fixtureInfo?.kickoff_at || (leg.start ? new Date(leg.start).toISOString() : null);

        const selectionKey = `${leg.market}|${side}|${line}`.toLowerCase();

        legOutcomes.push({
          ticket_id: ticket.id,
          user_id: ticket.user_id,
          fixture_id: leg.fixtureId,
          league_id: leagueId,
          market: leg.market,
          side,
          line,
          odds: leg.odds,
          selection_key: selectionKey,
          selection: leg.selection,
          source: leg.source || "prematch",
          picked_at: ticket.created_at,
          kickoff_at: kickoffAt,
          result_status: "PENDING",
          derived_from_selection: !leg.side || leg.line === undefined || leg.line <= 0,
        });
      }

      if (dryRun) {
        logs.push(`[dry-run] Would insert ${legOutcomes.length} legs for ticket ${ticket.id}`);
        processedTickets++;
        insertedLegs += legOutcomes.length;
        continue;
      }

      // Upsert leg outcomes
      if (legOutcomes.length > 0) {
        const { error: legError } = await supabase
          .from("ticket_leg_outcomes")
          .upsert(legOutcomes, {
            onConflict: "ticket_id,fixture_id,market,side,line",
            ignoreDuplicates: true,
          });

        if (legError) {
          logs.push(`[backfill] Error inserting legs for ticket ${ticket.id}: ${legError.message}`);
          continue;
        }

        insertedLegs += legOutcomes.length;
      }

      // Upsert ticket outcome
      const { error: ticketError } = await supabase
        .from("ticket_outcomes")
        .upsert({
          ticket_id: ticket.id,
          user_id: ticket.user_id,
          legs_total: legOutcomes.length,
          legs_settled: 0,
          legs_won: 0,
          legs_lost: 0,
          legs_pushed: 0,
          legs_void: 0,
          ticket_status: "PENDING",
          total_odds: ticket.total_odds,
        }, {
          onConflict: "ticket_id",
          ignoreDuplicates: true,
        });

      if (ticketError) {
        logs.push(`[backfill] Error inserting ticket_outcome for ${ticket.id}: ${ticketError.message}`);
        continue;
      }

      insertedTicketOutcomes++;
      processedTickets++;
    }

    logs.push(`[backfill] Completed: ${processedTickets} tickets, ${insertedLegs} legs inserted, ${skippedLegs} legs skipped, ${insertedTicketOutcomes} ticket outcomes created`);
    return new Response(
      JSON.stringify({
        success: true,
        processed_tickets: processedTickets,
        inserted_legs: insertedLegs,
        skipped_legs: skippedLegs,
        inserted_ticket_outcomes: insertedTicketOutcomes,
        already_done: existingTicketIds.size,
        remaining: ticketsNeeded - processedTickets,
        dry_run: dryRun,
        logs,
        duration_ms: Date.now() - startTime,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[backfill] Error:", error);
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
