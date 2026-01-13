// ============================================================================
// market-close-expired: Cron job to close markets past their closes_at time
// ============================================================================
// - Calls atomic close_expired_markets RPC
// - Updates status to 'closed' (no more bets accepted)
// - Logs each close action with is_system=true
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

    // Call atomic RPC that closes markets and logs audit entries
    const { data: result, error: rpcError } = await adminClient.rpc("close_expired_markets");

    if (rpcError) {
      console.error(`${logPrefix} RPC error:`, rpcError);
      return errorResponse(rpcError.message || "Failed to close expired markets", origin, 500, req);
    }

    console.log(`${logPrefix} Complete. Closed: ${result?.closed_count ?? 0} markets`);

    return jsonResponse({
      ok: true,
      closed: result?.closed_count ?? 0,
    }, origin, 200, req);

  } catch (err) {
    console.error(`${logPrefix} Unhandled error:`, err);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
