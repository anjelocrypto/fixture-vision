// ============================================================================
// market-place-bet: Place a position on a prediction market
// ============================================================================
// - Validates market is open
// - Checks user has sufficient balance
// - Calculates 2% fee (min 1 coin)
// - Updates market totals + odds atomically
// - Inserts position record
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

const FEE_RATE = 0.02; // 2% fee
const MIN_FEE = 1; // Minimum 1 coin fee
const MIN_STAKE = 10; // Minimum 10 coin stake

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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User client (for auth)
    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      console.error(`${logPrefix} User auth failed:`, userError);
      return errorResponse("Invalid authentication", origin, 401, req);
    }

    // Service role client (for atomic updates)
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Parse request
    const body = await req.json();
    const { market_id, outcome, stake } = body;

    if (!market_id || !outcome || !stake) {
      return errorResponse("Missing required fields: market_id, outcome, stake", origin, 400, req);
    }

    if (!["yes", "no"].includes(outcome)) {
      return errorResponse("Outcome must be 'yes' or 'no'", origin, 400, req);
    }

    const stakeAmount = Number(stake);
    if (isNaN(stakeAmount) || stakeAmount < MIN_STAKE) {
      return errorResponse(`Minimum stake is ${MIN_STAKE} coins`, origin, 400, req);
    }

    console.log(`${logPrefix} User ${user.id} placing ${stakeAmount} on ${outcome} for market ${market_id}`);

    // 1. Get market details
    const { data: market, error: marketError } = await adminClient
      .from("prediction_markets")
      .select("*")
      .eq("id", market_id)
      .single();

    if (marketError || !market) {
      console.error(`${logPrefix} Market not found:`, marketError);
      return errorResponse("Market not found", origin, 404, req);
    }

    if (market.status !== "open") {
      return errorResponse(`Market is ${market.status}, cannot place bets`, origin, 400, req);
    }

    if (new Date(market.closes_at) <= new Date()) {
      return errorResponse("Market has closed", origin, 400, req);
    }

    // 2. Check user balance (ensure row exists first)
    await adminClient.rpc("ensure_market_coins");
    
    const { data: userCoins, error: coinsError } = await adminClient
      .from("market_coins")
      .select("balance")
      .eq("user_id", user.id)
      .single();

    if (coinsError || !userCoins) {
      console.error(`${logPrefix} Coins fetch failed:`, coinsError);
      return errorResponse("Could not fetch balance", origin, 500, req);
    }

    // 3. Calculate fee (2%, min 1 coin)
    const feeAmount = Math.max(MIN_FEE, Math.floor(stakeAmount * FEE_RATE));
    const netStake = stakeAmount - feeAmount;
    const totalCost = stakeAmount;

    if (userCoins.balance < totalCost) {
      return errorResponse(`Insufficient balance. Need ${totalCost}, have ${userCoins.balance}`, origin, 400, req);
    }

    // 4. Get current odds for the outcome
    const currentOdds = outcome === "yes" ? market.odds_yes : market.odds_no;
    const potentialPayout = Math.floor(netStake * currentOdds);

    console.log(`${logPrefix} Stake: ${stakeAmount}, Fee: ${feeAmount}, Net: ${netStake}, Odds: ${currentOdds}, Potential: ${potentialPayout}`);

    // 5. Atomic transaction: deduct balance, insert position, update market totals
    
    // 5a. Deduct from user balance
    const { error: deductError } = await adminClient
      .from("market_coins")
      .update({
        balance: userCoins.balance - totalCost,
        total_wagered: (await adminClient.from("market_coins").select("total_wagered").eq("user_id", user.id).single()).data?.total_wagered + stakeAmount,
        total_fees_paid: (await adminClient.from("market_coins").select("total_fees_paid").eq("user_id", user.id).single()).data?.total_fees_paid + feeAmount,
      })
      .eq("user_id", user.id)
      .eq("balance", userCoins.balance); // Optimistic lock

    if (deductError) {
      console.error(`${logPrefix} Balance deduct failed (race condition?):`, deductError);
      return errorResponse("Transaction failed, please retry", origin, 409, req);
    }

    // 5b. Insert position
    const { data: position, error: positionError } = await adminClient
      .from("market_positions")
      .insert({
        user_id: user.id,
        market_id,
        outcome,
        stake: stakeAmount,
        fee_amount: feeAmount,
        net_stake: netStake,
        odds_at_placement: currentOdds,
        potential_payout: potentialPayout,
        status: "pending",
      })
      .select()
      .single();

    if (positionError) {
      console.error(`${logPrefix} Position insert failed:`, positionError);
      // Rollback: restore balance
      await adminClient
        .from("market_coins")
        .update({ balance: userCoins.balance })
        .eq("user_id", user.id);
      return errorResponse("Failed to place bet", origin, 500, req);
    }

    // 5c. Update market totals
    const totalYes = market.total_staked_yes + (outcome === "yes" ? netStake : 0);
    const totalNo = market.total_staked_no + (outcome === "no" ? netStake : 0);
    const totalPool = totalYes + totalNo;

    // Recalculate odds based on pool shares (minimum 1.1 odds)
    const newOddsYes = totalYes > 0 ? Math.max(1.1, totalPool / totalYes) : 2.0;
    const newOddsNo = totalNo > 0 ? Math.max(1.1, totalPool / totalNo) : 2.0;

    const { error: marketUpdateError } = await adminClient
      .from("prediction_markets")
      .update({
        total_staked_yes: totalYes,
        total_staked_no: totalNo,
        odds_yes: Math.round(newOddsYes * 100) / 100,
        odds_no: Math.round(newOddsNo * 100) / 100,
      })
      .eq("id", market_id);

    if (marketUpdateError) {
      console.error(`${logPrefix} Market update failed:`, marketUpdateError);
      // Position already created, market update is non-critical
    }

    console.log(`${logPrefix} Success! Position ${position.id} created. New odds: YES=${newOddsYes.toFixed(2)}, NO=${newOddsNo.toFixed(2)}`);

    return jsonResponse({
      ok: true,
      position: {
        id: position.id,
        outcome,
        stake: stakeAmount,
        fee: feeAmount,
        net_stake: netStake,
        odds: currentOdds,
        potential_payout: potentialPayout,
      },
      new_balance: userCoins.balance - totalCost,
      market: {
        odds_yes: Math.round(newOddsYes * 100) / 100,
        odds_no: Math.round(newOddsNo * 100) / 100,
      },
    }, origin, 200, req);

  } catch (err) {
    console.error(`${logPrefix} Unhandled error:`, err);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
