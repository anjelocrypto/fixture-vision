// ============================================================================
// market-place-bet: Place a position on a prediction market
// ============================================================================
// - Calls atomic Postgres RPC (place_market_bet) which handles:
//   - Market validation (open, not closed)
//   - Balance check + 2% fee calculation
//   - Position insertion with duplicate handling
//   - Market totals update (display only, fixed odds)
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const logPrefix = "[market-place-bet]";

  try {
    // Get user from auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return errorResponse("Authorization required", origin, 401, req);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // User client (RPC uses auth.uid() internally)
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error(`${logPrefix} User auth failed:`, userError);
      return errorResponse("Invalid authentication", origin, 401, req);
    }

    // Parse request
    const body = await req.json();
    const { market_id, outcome, stake } = body;

    if (!market_id || !outcome || stake === undefined) {
      return errorResponse("Missing required fields: market_id, outcome, stake", origin, 400, req);
    }

    const stakeAmount = Number(stake);
    if (isNaN(stakeAmount) || !Number.isInteger(stakeAmount)) {
      return errorResponse("Stake must be an integer", origin, 400, req);
    }

    console.log(`${logPrefix} User ${user.id} placing ${stakeAmount} on ${outcome} for market ${market_id}`);

    // Call atomic RPC - handles all validation, locking, fee calculation, position insert
    const { data: result, error: rpcError } = await supabase.rpc("place_market_bet", {
      _market_id: market_id,
      _outcome: outcome,
      _stake: stakeAmount,
    });

    if (rpcError) {
      console.error(`${logPrefix} RPC error:`, rpcError);
      return errorResponse(rpcError.message || "Failed to place bet", origin, 500, req);
    }

    // RPC returns JSON with ok: true/false
    if (!result.ok) {
      console.log(`${logPrefix} Bet rejected: ${result.error}`);
      return errorResponse(result.error, origin, 400, req);
    }

    console.log(`${logPrefix} Success! Position ${result.position_id} created. Stake: ${result.stake}, Fee: ${result.fee}, Odds: ${result.odds}`);

    return jsonResponse({
      ok: true,
      position: {
        id: result.position_id,
        outcome,
        stake: result.stake,
        fee: result.fee,
        net_stake: result.net_stake,
        odds: result.odds,
        potential_payout: result.potential_payout,
      },
      new_balance: result.new_balance,
    }, origin, 200, req);

  } catch (err) {
    console.error(`${logPrefix} Unhandled error:`, err);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
