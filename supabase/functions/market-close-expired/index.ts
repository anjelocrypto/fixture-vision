// ============================================================================
// market-close-expired: Cron job to close markets past their closes_at time
// ============================================================================
// - Finds open markets where closes_at has passed
// - Updates status to 'closed' (no more bets accepted)
// - Does NOT resolve - resolution happens via fixture result or admin action
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const logPrefix = "[market-close-expired]";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Auth check
  const auth = await checkCronOrAdminAuth(req, adminClient, serviceRoleKey, logPrefix);
  if (!auth.authorized) {
    return errorResponse("Unauthorized", origin, 401, req);
  }

  try {
    console.log(`${logPrefix} Checking for expired markets...`);

    const now = new Date().toISOString();

    // Find and close expired markets
    const { data: expiredMarkets, error: fetchError } = await adminClient
      .from("prediction_markets")
      .select("id, title, closes_at")
      .eq("status", "open")
      .lt("closes_at", now);

    if (fetchError) {
      console.error(`${logPrefix} Failed to fetch expired markets:`, fetchError);
      return errorResponse("Failed to fetch markets", origin, 500, req);
    }

    if (!expiredMarkets || expiredMarkets.length === 0) {
      console.log(`${logPrefix} No expired markets found`);
      return jsonResponse({ ok: true, closed: 0 }, origin, 200, req);
    }

    const marketIds = expiredMarkets.map(m => m.id);

    const { error: updateError } = await adminClient
      .from("prediction_markets")
      .update({ status: "closed" })
      .in("id", marketIds);

    if (updateError) {
      console.error(`${logPrefix} Failed to close markets:`, updateError);
      return errorResponse("Failed to close markets", origin, 500, req);
    }

    console.log(`${logPrefix} Closed ${marketIds.length} expired markets:`, expiredMarkets.map(m => m.title));

    return jsonResponse({
      ok: true,
      closed: marketIds.length,
      markets: expiredMarkets.map(m => ({ id: m.id, title: m.title })),
    }, origin, 200, req);

  } catch (err) {
    console.error(`${logPrefix} Unhandled error:`, err);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
