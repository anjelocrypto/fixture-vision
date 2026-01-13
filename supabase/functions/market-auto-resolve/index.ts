// ============================================================================
// market-auto-resolve: Cron job to auto-resolve fixture-linked markets
// ============================================================================
// - Finds markets with fixture_id where fixture has finished
// - Determines outcome based on market_type and fixture result
// - Settles positions automatically
// - Supports: over_goals, under_goals, btts, home_win, away_win, draw
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const logPrefix = "[market-auto-resolve]";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Auth check (cron or admin)
  const auth = await checkCronOrAdminAuth(req, adminClient, serviceRoleKey, logPrefix);
  if (!auth.authorized) {
    return errorResponse("Unauthorized", origin, 401, req);
  }

  try {
    console.log(`${logPrefix} Starting auto-resolve scan...`);

    // Find open markets with fixture_id that should auto-resolve
    const { data: markets, error: marketsError } = await adminClient
      .from("prediction_markets")
      .select(`
        *,
        fixtures:fixture_id (
          id,
          status,
          teams_home,
          teams_away
        )
      `)
      .eq("status", "open")
      .not("fixture_id", "is", null);

    if (marketsError) {
      console.error(`${logPrefix} Failed to fetch markets:`, marketsError);
      return errorResponse("Failed to fetch markets", origin, 500, req);
    }

    let resolved = 0;
    let skipped = 0;

    for (const market of markets || []) {
      // Check if fixture has a result
      const { data: result } = await adminClient
        .from("fixture_results")
        .select("*")
        .eq("fixture_id", market.fixture_id)
        .eq("status", "FT")
        .single();

      if (!result) {
        skipped++;
        continue;
      }

      // Determine winning outcome based on market_type
      let winningOutcome: "yes" | "no" | null = null;
      const goalsHome = result.goals_home;
      const goalsAway = result.goals_away;
      const totalGoals = goalsHome + goalsAway;

      // Parse market type from title or market_type field
      const marketType = market.market_type.toLowerCase();
      const title = market.title.toLowerCase();

      if (marketType.includes("over_2.5") || title.includes("over 2.5")) {
        winningOutcome = totalGoals > 2.5 ? "yes" : "no";
      } else if (marketType.includes("under_2.5") || title.includes("under 2.5")) {
        winningOutcome = totalGoals < 2.5 ? "yes" : "no";
      } else if (marketType.includes("over_1.5") || title.includes("over 1.5")) {
        winningOutcome = totalGoals > 1.5 ? "yes" : "no";
      } else if (marketType.includes("btts") || title.includes("both teams")) {
        winningOutcome = (goalsHome > 0 && goalsAway > 0) ? "yes" : "no";
      } else if (marketType.includes("home_win") || title.includes("home win")) {
        winningOutcome = goalsHome > goalsAway ? "yes" : "no";
      } else if (marketType.includes("away_win") || title.includes("away win")) {
        winningOutcome = goalsAway > goalsHome ? "yes" : "no";
      } else if (marketType.includes("draw") || title.includes("draw")) {
        winningOutcome = goalsHome === goalsAway ? "yes" : "no";
      } else {
        console.warn(`${logPrefix} Unknown market type for market ${market.id}: ${marketType}`);
        skipped++;
        continue;
      }

      console.log(`${logPrefix} Auto-resolving market ${market.id}: ${market.title} → ${winningOutcome} (Score: ${goalsHome}-${goalsAway})`);

      // Settle positions
      const { data: positions } = await adminClient
        .from("market_positions")
        .select("*")
        .eq("market_id", market.id)
        .eq("status", "pending");

      const now = new Date().toISOString();
      let totalPayout = 0;

      for (const pos of positions || []) {
        const isWinner = pos.outcome === winningOutcome;
        const payoutAmount = isWinner ? pos.potential_payout : 0;

        await adminClient
          .from("market_positions")
          .update({
            status: isWinner ? "won" : "lost",
            payout_amount: payoutAmount,
            settled_at: now,
          })
          .eq("id", pos.id);

        if (isWinner && payoutAmount > 0) {
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
                total_won: userCoins.total_won + payoutAmount,
              })
              .eq("user_id", pos.user_id);
          }
          totalPayout += payoutAmount;
        }
      }

      // Update market
      await adminClient
        .from("prediction_markets")
        .update({
          status: "resolved",
          winning_outcome: winningOutcome,
          resolved_at: now,
        })
        .eq("id", market.id);

      // Audit log (system action)
      await adminClient.from("admin_market_audit_log").insert({
        admin_user_id: "00000000-0000-0000-0000-000000000000", // System user
        market_id: market.id,
        action: "auto_resolve",
        details: {
          fixture_id: market.fixture_id,
          score: `${goalsHome}-${goalsAway}`,
          winning_outcome: winningOutcome,
          total_payout: totalPayout,
        },
      });

      resolved++;
    }

    console.log(`${logPrefix} Complete. Resolved: ${resolved}, Skipped: ${skipped}`);

    return jsonResponse({
      ok: true,
      resolved,
      skipped,
    }, origin, 200, req);

  } catch (err) {
    console.error(`${logPrefix} Unhandled error:`, err);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
