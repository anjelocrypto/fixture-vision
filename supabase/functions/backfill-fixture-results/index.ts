/**
 * BACKFILL-FIXTURE-RESULTS — RETIRED PROVIDER PATH (Gate D remediation)
 *
 * This legacy bulk backfill previously accepted requests with NO headers at all
 * ("no-auth admin UI" path) and performed unbounded, retrying API-Football calls.
 * That surface is removed.
 *
 * Replacement: `auto-backfill-results`
 *   - targeted mode : { mode: "targeted", fixture_id, confirm_provider_calls: true,
 *                       include_statistics?: boolean, max_provider_calls?: 1|2 }
 *   - bulk mode     : { confirm_provider_calls: true, batch_size, lookback_days,
 *                       max_provider_calls }
 *
 * This endpoint now: default-denies every request, authenticates before doing
 * anything, never logs secrets or secret prefixes, and makes zero provider calls.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { authorizeIngestionRequest } from "../_shared/result_ingestion.ts";

export const REPLACEMENT_FUNCTION = "auto-backfill-results";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return handlePreflight(origin, req);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse("Missing configuration", origin, 500, req);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Default deny. No no-header path. No secret logging.
  const auth = await authorizeIngestionRequest({
    serviceRoleKey,
    cronKeyHeader: req.headers.get("x-cron-key") ?? req.headers.get("X-CRON-KEY"),
    authHeader: req.headers.get("authorization") ?? req.headers.get("Authorization"),
    lookupCronKey: async () => {
      const { data } = await supabase.rpc("get_cron_internal_key");
      return typeof data === "string" ? data : null;
    },
    verifyAdmin: async (authHeader: string) => {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (!anonKey) return false;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await userClient.rpc("is_user_whitelisted");
      return data === true;
    },
  });

  if (!auth.authorized) {
    console.error("[backfill-fixture-results] Authorization failed");
    return errorResponse("Unauthorized", origin, 401, req);
  }

  console.log(`[backfill-fixture-results] Retired endpoint called (auth=${auth.method}); provider path disabled`);
  return jsonResponse({
    success: false,
    code: "endpoint_retired",
    error: "backfill-fixture-results provider path is disabled",
    replacement: REPLACEMENT_FUNCTION,
    provider_calls: 0,
    mutations: 0,
  }, origin, 410, req);
});
