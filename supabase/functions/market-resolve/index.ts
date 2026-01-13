// ============================================================================
// market-resolve: Admin-only endpoint to resolve prediction markets
// ============================================================================
// - Validates admin role
// - Calls atomic resolve_market RPC (service_role only)
// - Supports: yes, no, or null (void/refund)
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const logPrefix = "[market-resolve]";

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return errorResponse("Authorization required", origin, 401, req);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User client for auth verification
    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return errorResponse("Invalid authentication", origin, 401, req);
    }

    // Check admin role
    const { data: isAdmin } = await userClient.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });

    if (!isAdmin) {
      console.warn(`${logPrefix} Non-admin user ${user.id} attempted to resolve market`);
      return errorResponse("Admin access required", origin, 403, req);
    }

    const body = await req.json();
    const { market_id, winning_outcome } = body;

    if (!market_id) {
      return errorResponse("Missing required field: market_id", origin, 400, req);
    }

    // winning_outcome can be 'yes', 'no', or null (void)
    if (winning_outcome !== null && winning_outcome !== undefined && 
        !["yes", "no"].includes(winning_outcome)) {
      return errorResponse("winning_outcome must be 'yes', 'no', or null (void)", origin, 400, req);
    }

    console.log(`${logPrefix} Admin ${user.id} resolving market ${market_id} with outcome: ${winning_outcome ?? 'VOID'}`);

    // Use service role client to call RPC (only service_role has execute permission)
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: result, error: rpcError } = await adminClient.rpc("resolve_market", {
      _market_id: market_id,
      _winning_outcome: winning_outcome ?? null,
      _admin_user_id: user.id,
      _is_system: false,
    });

    if (rpcError) {
      console.error(`${logPrefix} RPC error:`, rpcError);
      return errorResponse(rpcError.message || "Failed to resolve market", origin, 500, req);
    }

    if (!result.ok) {
      console.warn(`${logPrefix} Resolution failed:`, result.error);
      return errorResponse(result.error, origin, 400, req);
    }

    console.log(`${logPrefix} Market ${market_id} resolved successfully:`, result);

    return jsonResponse(result, origin, 200, req);

  } catch (err) {
    console.error(`${logPrefix} Unhandled error:`, err);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
