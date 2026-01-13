// ============================================================================
// market-create: Admin-only endpoint to create prediction markets
// ============================================================================
// - Validates admin role
// - Creates market with initial odds
// - Logs to admin_market_audit_log
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const logPrefix = "[market-create]";

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return errorResponse("Authorization required", origin, 401, req);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User client for auth check
    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return errorResponse("Invalid authentication", origin, 401, req);
    }

    // Check admin role
    const { data: isAdmin, error: roleError } = await userClient.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });

    if (roleError || !isAdmin) {
      console.warn(`${logPrefix} Non-admin user ${user.id} attempted to create market`);
      return errorResponse("Admin access required", origin, 403, req);
    }

    // Parse request
    const body = await req.json();
    const {
      title,
      description,
      category = "football",
      market_type = "binary",
      fixture_id,
      closes_at,
      initial_odds_yes = 2.0,
      initial_odds_no = 2.0,
    } = body;

    if (!title || !closes_at) {
      return errorResponse("Missing required fields: title, closes_at", origin, 400, req);
    }

    const closesAtDate = new Date(closes_at);
    if (closesAtDate <= new Date()) {
      return errorResponse("closes_at must be in the future", origin, 400, req);
    }

    // Service role client for inserts
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Create market
    const { data: market, error: marketError } = await adminClient
      .from("prediction_markets")
      .insert({
        title,
        description,
        category,
        market_type,
        fixture_id: fixture_id || null,
        closes_at: closesAtDate.toISOString(),
        created_by: user.id,
        odds_yes: initial_odds_yes,
        odds_no: initial_odds_no,
        total_staked_yes: 0,
        total_staked_no: 0,
        status: "open",
      })
      .select()
      .single();

    if (marketError) {
      console.error(`${logPrefix} Market creation failed:`, marketError);
      return errorResponse("Failed to create market", origin, 500, req);
    }

    // Audit log
    await adminClient.from("admin_market_audit_log").insert({
      admin_user_id: user.id,
      market_id: market.id,
      action: "create",
      details: {
        title,
        category,
        fixture_id,
        closes_at: closesAtDate.toISOString(),
        initial_odds: { yes: initial_odds_yes, no: initial_odds_no },
      },
    });

    console.log(`${logPrefix} Admin ${user.id} created market ${market.id}: "${title}"`);

    return jsonResponse({
      ok: true,
      market: {
        id: market.id,
        title: market.title,
        status: market.status,
        closes_at: market.closes_at,
        odds_yes: market.odds_yes,
        odds_no: market.odds_no,
      },
    }, origin, 201, req);

  } catch (err) {
    console.error(`${logPrefix} Unhandled error:`, err);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
