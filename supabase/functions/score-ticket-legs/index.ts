/*
 * SCORE TICKET LEGS (RC3.1)
 *
 * ONE documented input contract — a JSON body:
 *   { "limit": <1..500>, "confirm_scoring": true }
 * `limit` is mandatory and never silently defaulted; `confirm_scoring` is the
 * explicit guard required before any scoring run (including cron).
 *
 * Safety contract:
 *  - legs are claimed atomically with a durable lease token AND the fingerprint
 *    of the fixture result they are scored from
 *  - finalization re-locks the fixture and fixture result, re-evaluates the
 *    canonical settlement policy, rejects stale result evidence, and refreshes
 *    the parent ticket outcome inside the SAME transaction
 *  - any finalization/refresh failure fails the whole run: success is never
 *    reported with stale parent state
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";
import { readJsonWithLimit } from "../_shared/request.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

const MAX_BODY_BYTES = 4096;

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
  result_fingerprint: string;
  stats_provenance: string | null;
}

/** Markets that settle from secondary statistics, mirroring is_statistics_market(). */
const STATISTICS_MARKETS = new Set([
  "corners",
  "total_corners",
  "team_corners",
  "cards",
  "total_cards",
  "team_cards",
  "fouls",
  "total_fouls",
  "offsides",
  "total_offsides",
]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Strict, fail-closed request contract. */
function parseRequest(body: unknown): { limit: number } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("invalid_request_body");
  }
  const record = body as Record<string, unknown>;
  if (record.confirm_scoring !== true) throw new Error("confirm_scoring_required");
  const raw = record.limit;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 500) {
    throw new Error("limit_required_1_to_500");
  }
  return { limit: raw };
}

function actualValueFor(leg: ScorableLeg): number | null {
  const market = leg.market.toLowerCase();
  if (market === "goals" || market === "total_goals" || market === "over_under") {
    return leg.goals_home + leg.goals_away;
  }
  if (market === "corners" || market === "total_corners") {
    return leg.corners_home !== null && leg.corners_away !== null
      ? leg.corners_home + leg.corners_away
      : null;
  }
  if (market === "cards" || market === "total_cards") {
    return leg.cards_home !== null && leg.cards_away !== null
      ? leg.cards_home + leg.cards_away
      : null;
  }
  return null;
}

function statusFor(side: string, actual: number, line: number): string | null {
  const s = side.toLowerCase();
  if (s === "over") return actual > line ? "WIN" : actual === line ? "PUSH" : "LOSS";
  if (s === "under") return actual < line ? "WIN" : actual === line ? "PUSH" : "LOSS";
  return null;
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

  const auth = await checkCronOrAdminAuth(req, supabase, serviceRoleKey, "[score-ticket-legs]");
  if (!auth.authorized) {
    console.error("[score-ticket-legs] Unauthorized request");
    return json({ error: "Unauthorized", method: auth.method }, 401);
  }
  logs.push(`[score] Authorized via ${auth.method}`);

  const recordRun = async (fields: Record<string, unknown>) => {
    const { error } = await supabase.from("scorer_run_logs").insert({
      run_started: new Date(startTime).toISOString(),
      run_finished: new Date().toISOString(),
      auth_method: auth.method,
      ...fields,
    });
    if (error) console.error("[score] scorer_run_logs insert failed:", error.message);
  };

  let limit: number;
  try {
    limit = parseRequest(await readJsonWithLimit(req, MAX_BODY_BYTES)).limit;
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_request";
    await recordRun({ success: false, error_message: code, details: { stage: "request_validation" } });
    return json({ success: false, code }, 400);
  }

  try {
    logs.push(`[score] Starting with limit=${limit}`);

    const { data: scorableLegs, error: legsError } = await supabase
      .rpc("claim_scorable_ticket_legs", { batch_limit: limit });

    if (legsError) throw new Error(`claim_failed: ${legsError.message}`);

    const legs = (scorableLegs ?? []) as ScorableLeg[];
    if (legs.length === 0) {
      await recordRun({ success: true, batch_size: limit, details: { reason: "no_scorable_legs" } });
      return json({
        success: true,
        scanned_legs: 0,
        scored_legs: 0,
        updated_tickets: 0,
        duration_ms: Date.now() - startTime,
        logs,
      });
    }

    logs.push(`[score] Claimed ${legs.length} scorable legs`);

    let scoredLegs = 0;
    let skippedLegs = 0;
    let heldOrRejected = 0;
    let staleEvidence = 0;
    const updatedTickets = new Set<string>();

    for (const leg of legs) {
      const release = async () => {
        const { error } = await supabase.rpc("release_ticket_leg_score_claim", {
          p_leg_id: leg.leg_id,
          p_claim_token: leg.claim_token,
        });
        if (error) throw new Error(`release_claim_failed: ${error.message}`);
      };

      const actual = actualValueFor(leg);
      if (actual === null) {
        await release();
        skippedLegs++;
        continue;
      }

      const resultStatus = statusFor(leg.side, actual, leg.line);
      if (resultStatus === null) {
        logs.push(`[score] Unsupported side "${leg.side}" for leg ${leg.leg_id}`);
        await release();
        skippedLegs++;
        continue;
      }

      const { data: outcome, error: finalizeError } = await supabase.rpc(
        "finalize_scored_ticket_leg",
        {
          p_leg_id: leg.leg_id,
          p_claim_token: leg.claim_token,
          p_result_status: resultStatus,
          p_actual_value: actual,
          p_scored_version: "v3.1-atomic",
          p_result_fingerprint: leg.result_fingerprint,
        },
      );

      // A database error means the leg AND its parent ticket may be in an
      // unknown state: fail the run instead of reporting partial success.
      if (finalizeError) {
        throw new Error(`finalize_failed:${leg.leg_id}:${finalizeError.message}`);
      }

      const state = (outcome ?? {}) as { settled?: boolean; outcome?: string };
      if (state.settled === true) {
        scoredLegs++;
        updatedTickets.add(leg.ticket_id);
        continue;
      }
      if (state.outcome === "stale_result_evidence") {
        staleEvidence++;
        logs.push(`[score] Stale result evidence for leg ${leg.leg_id} — not settled`);
        continue;
      }
      heldOrRejected++;
      logs.push(`[score] Not settled ${leg.leg_id}: ${state.outcome ?? "unknown"}`);
    }

    logs.push(
      `[score] Settled ${scoredLegs}, held/rejected ${heldOrRejected}, stale ${staleEvidence}, skipped ${skippedLegs}`,
    );

    await recordRun({
      success: true,
      batch_size: limit,
      scanned_legs: legs.length,
      scored_legs: scoredLegs,
      skipped_legs: skippedLegs,
      held_legs: heldOrRejected,
      updated_tickets: updatedTickets.size,
      details: { duration_ms: Date.now() - startTime, stale_result_evidence: staleEvidence },
    });

    return json({
      success: true,
      scanned_legs: legs.length,
      scored_legs: scoredLegs,
      skipped_legs: skippedLegs,
      held_or_rejected_legs: heldOrRejected,
      stale_result_evidence: staleEvidence,
      // Parent tickets are refreshed inside the settlement transaction.
      updated_tickets: updatedTickets.size,
      duration_ms: Date.now() - startTime,
      logs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[score] Error:", message);
    await recordRun({
      success: false,
      batch_size: limit,
      error_message: message,
      details: { duration_ms: Date.now() - startTime },
    });
    return json({ success: false, error: message, logs, duration_ms: Date.now() - startTime }, 500);
  }
});
