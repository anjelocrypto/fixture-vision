// ============================================================================
// market-resolve: Admin-only endpoint to resolve prediction markets
// ============================================================================
// - Validates admin role
// - Sets winning outcome
// - Settles all positions (winners get payout, losers marked lost)
// - Updates market status to 'resolved'
// - Logs to admin_market_audit_log
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

    if (!market_id || !winning_outcome) {
      return errorResponse("Missing required fields: market_id, winning_outcome", origin, 400, req);
    }

    if (!["yes", "no", "void"].includes(winning_outcome)) {
      return errorResponse("winning_outcome must be 'yes', 'no', or 'void'", origin, 400, req);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Get market
    const { data: market, error: marketError } = await adminClient
      .from("prediction_markets")
      .select("*")
      .eq("id", market_id)
      .single();

    if (marketError || !market) {
      return errorResponse("Market not found", origin, 404, req);
    }

    if (market.status === "resolved") {
      return errorResponse("Market already resolved", origin, 400, req);
    }

    console.log(`${logPrefix} Resolving market ${market_id} with outcome: ${winning_outcome}`);

    // Get all pending positions
    const { data: positions, error: posError } = await adminClient
      .from("market_positions")
      .select("*")
      .eq("market_id", market_id)
      .eq("status", "pending");

    if (posError) {
      console.error(`${logPrefix} Failed to fetch positions:`, posError);
      return errorResponse("Failed to fetch positions", origin, 500, req);
    }

    let settledWon = 0;
    let settledLost = 0;
    let totalPayout = 0;

    const now = new Date().toISOString();

    // Settle each position
    for (const pos of positions || []) {
      let newStatus: string;
      let payoutAmount = 0;

      if (winning_outcome === "void") {
        // Refund: return stake (not net_stake - full refund including fees)
        newStatus = "void";
        payoutAmount = pos.stake ?? 0;
      } else if (pos.outcome === winning_outcome) {
        // Winner: pay potential_payout
        newStatus = "won";
        payoutAmount = pos.potential_payout ?? 0;
        settledWon++;
        totalPayout += payoutAmount;
      } else {
        // Loser: no payout
        newStatus = "lost";
        payoutAmount = 0;
        settledLost++;
      }

      // Update position
      await adminClient
        .from("market_positions")
        .update({
          status: newStatus,
          payout_amount: payoutAmount,
          settled_at: now,
        })
        .eq("id", pos.id);

      // Credit winner/void balance
      if (payoutAmount !== null && payoutAmount > 0) {
        const { data: userCoins } = await adminClient
          .from("market_coins")
          .select("balance, total_won")
          .eq("user_id", pos.user_id)
          .single();

        if (userCoins) {
          await adminClient
            .from("market_coins")
            .update({
              balance: userCoins.balance + payoutAmount,
              total_won: userCoins.total_won + (newStatus === "won" ? payoutAmount : 0),
            })
            .eq("user_id", pos.user_id);
        }
      }
    }

    // Update market status
    await adminClient
      .from("prediction_markets")
      .update({
        status: "resolved",
        winning_outcome,
        resolved_at: now,
      })
      .eq("id", market_id);

    // Audit log
    await adminClient.from("admin_market_audit_log").insert({
      admin_user_id: user.id,
      market_id,
      action: "resolve",
      details: {
        winning_outcome,
        positions_won: settledWon,
        positions_lost: settledLost,
        total_payout: totalPayout,
      },
    });

    console.log(`${logPrefix} Market ${market_id} resolved. Won: ${settledWon}, Lost: ${settledLost}, Payout: ${totalPayout}`);

    return jsonResponse({
      ok: true,
      market_id,
      winning_outcome,
      positions_settled: {
        won: settledWon,
        lost: settledLost,
        total_payout: totalPayout,
      },
    }, origin, 200, req);

  } catch (err) {
    console.error(`${logPrefix} Unhandled error:`, err);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
