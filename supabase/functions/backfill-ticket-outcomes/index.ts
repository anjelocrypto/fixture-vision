/*
 * BACKFILL TICKET OUTCOMES - Cursor-based, DB-driven
 * 
 * Processes tickets in batches using cursor pagination to avoid timeouts.
 * Only fetches tickets that DON'T already have outcomes in the DB query itself.
 * 
 * Query params:
 * - batch_size: Number of tickets to process (default 50, max 200)
 * - cursor: ISO timestamp to start after (for pagination)
 * - dry_run: If "true", only logs what would be done without inserting
 * - missing_only: If "true", directly targets tickets without outcomes (ignores cursor)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Parse query params
    const url = new URL(req.url);
    const batchSize = Math.min(parseInt(url.searchParams.get("batch_size") || "50"), 200);
    const cursor = url.searchParams.get("cursor") || null; // ISO timestamp
    const dryRun = url.searchParams.get("dry_run") === "true";
    const targetIds = url.searchParams.get("target_ids"); // Comma-separated UUIDs

    logs.push(`[backfill] Starting: batch_size=${batchSize}, cursor=${cursor || 'start'}, dry_run=${dryRun}, target_ids=${targetIds ? 'provided' : 'none'}`);

    let tickets: Array<{
      id: string;
      user_id: string;
      total_odds: number;
      legs: LegJson[];
      created_at: string;
    }> = [];

    if (targetIds) {
      // TARGET_IDS MODE: Process specific ticket IDs
      const ids = targetIds.split(",").map(id => id.trim()).filter(id => id.length > 0);
      logs.push(`[backfill] Targeting ${ids.length} specific tickets`);
      
      if (ids.length > 0) {
        const { data: ticketData, error: ticketError } = await supabase
          .from("generated_tickets")
          .select("id, user_id, total_odds, legs, created_at")
          .in("id", ids.slice(0, batchSize));
        
        if (ticketError) throw ticketError;
        tickets = (ticketData || []) as typeof tickets;
      }
    } else {
      // CURSOR MODE: Standard pagination
      let query = supabase
        .from("generated_tickets")
        .select(`id, user_id, total_odds, legs, created_at`)
        .order("created_at", { ascending: true })
        .limit(batchSize);

      if (cursor) {
        query = query.gt("created_at", cursor);
      }

      const { data: queryTickets, error: queryError } = await query;
      if (queryError) throw queryError;
      tickets = (queryTickets || []) as typeof tickets;
    }

    if (!tickets || tickets.length === 0) {
      logs.push("[backfill] No more tickets to process");
      return new Response(
        JSON.stringify({ 
          success: true, 
          processed_tickets: 0,
          remaining: 0,
          next_cursor: null,
          logs, 
          duration_ms: Date.now() - startTime 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get IDs of tickets in this batch
    const ticketIds = tickets.map(t => t.id);

    // Check which of these already have outcomes
    const { data: existingOutcomes } = await supabase
      .from("ticket_outcomes")
      .select("ticket_id")
      .in("ticket_id", ticketIds);

    const existingSet = new Set((existingOutcomes || []).map(o => o.ticket_id));
    
    // Filter to only tickets needing backfill
    const ticketsToProcess = tickets.filter(t => !existingSet.has(t.id));

    logs.push(`[backfill] Batch has ${tickets.length} tickets, ${ticketsToProcess.length} need backfill, ${existingSet.size} already done`);

    if (ticketsToProcess.length === 0) {
      // All in this batch already done, return next cursor to continue
      const nextCursor = tickets[tickets.length - 1]?.created_at || null;
      logs.push(`[backfill] All in batch already done, advancing cursor`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          processed_tickets: 0,
          skipped_already_done: existingSet.size,
          next_cursor: nextCursor,
          logs, 
          duration_ms: Date.now() - startTime 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Collect all fixture IDs for bulk lookup
    const allFixtureIds = new Set<number>();
    for (const ticket of ticketsToProcess) {
      const legs = ticket.legs as LegJson[];
      for (const leg of legs) {
        if (leg.fixtureId) allFixtureIds.add(leg.fixtureId);
      }
    }

    // Bulk fetch fixture data
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

    logs.push(`[backfill] Loaded ${fixtureMap.size} fixtures for lookup`);

    // DRY RUN CHECK - return early before any writes
    if (dryRun) {
      let totalLegs = 0;
      let skippedLegs = 0;
      for (const ticket of ticketsToProcess) {
        const legs = ticket.legs as LegJson[];
        for (const leg of legs) {
          const selectionLower = (leg.selection || "").toLowerCase().trim();
          let line: number;
          if (leg.side && leg.line !== undefined && leg.line > 0) {
            line = leg.line;
          } else {
            const lineMatch = selectionLower.match(/([\d.]+)/);
            line = lineMatch ? parseFloat(lineMatch[1]) : 0;
          }
          if (line <= 0) {
            skippedLegs++;
          } else {
            totalLegs++;
          }
        }
      }
      const nextCursor = tickets[tickets.length - 1]?.created_at || null;
      logs.push(`[dry-run] Would process ${ticketsToProcess.length} tickets, ${totalLegs} legs, skip ${skippedLegs}`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          dry_run: true,
          would_process_tickets: ticketsToProcess.length,
          would_insert_legs: totalLegs,
          would_skip_legs: skippedLegs,
          next_cursor: nextCursor,
          logs, 
          duration_ms: Date.now() - startTime 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Process each ticket
    let processedTickets = 0;
    let insertedLegs = 0;
    let skippedLegs = 0;

    for (const ticket of ticketsToProcess) {
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

        if (line <= 0) {
          skippedLegs++;
          continue;
        }

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

      processedTickets++;
    }

    // Return next cursor for pagination
    const nextCursor = tickets[tickets.length - 1]?.created_at || null;

    logs.push(`[backfill] Done: ${processedTickets} tickets, ${insertedLegs} legs, ${skippedLegs} skipped`);
    
    return new Response(
      JSON.stringify({
        success: true,
        processed_tickets: processedTickets,
        inserted_legs: insertedLegs,
        skipped_legs: skippedLegs,
        skipped_already_done: existingSet.size,
        next_cursor: nextCursor,
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
