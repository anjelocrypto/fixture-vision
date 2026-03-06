/**
 * ADMIN-VOID-LEGS: Safe admin endpoint to void non-FT pending legs
 * 
 * Uses service_role context to call void_non_ft_pending_legs RPC.
 * Auth: checkCronOrAdminAuth (service_role bearer, X-CRON-KEY, or admin JWT)
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";

const LOG = "[admin-void-legs]";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return errorResponse("Missing configuration", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Auth check
    const auth = await checkCronOrAdminAuth(req, supabase, serviceRoleKey, LOG);
    if (!auth.authorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }

    // Parse optional batch_limit
    let batchLimit = 500;
    try {
      if (req.body) {
        const body = await req.json();
        if (body.batch_limit) batchLimit = body.batch_limit;
      }
    } catch { /* use default */ }

    console.log(`${LOG} Calling void_non_ft_pending_legs(${batchLimit}) via ${auth.method}`);

    // Call the RPC under service_role context
    const { data, error } = await supabase.rpc("void_non_ft_pending_legs", {
      batch_limit: batchLimit,
    });

    if (error) {
      console.error(`${LOG} RPC error:`, error);
      return errorResponse(`RPC error: ${error.message}`, origin, 500, req);
    }

    const result = Array.isArray(data) ? data[0] : data;
    console.log(`${LOG} Result:`, JSON.stringify(result));

    return jsonResponse({
      success: true,
      voided_count: result?.voided_count ?? 0,
      affected_tickets: result?.affected_tickets ?? 0,
      auth_method: auth.method,
    }, origin, 200, req);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} Error:`, msg);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
