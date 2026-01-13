// ============================================================================
// market-auto-resolve: Cron job to auto-resolve fixture-linked markets
// ============================================================================
// - Finds closed markets with fixture_id where fixture has finished
// - Determines outcome based on market_type and fixture result
// - Calls atomic resolve_market RPC for settlement
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

    // Find closed (or open) markets with fixture_id that should auto-resolve
    const { data: markets, error: marketsError } = await adminClient
      .from("prediction_markets")
      .select("id, title, market_type, fixture_id")
      .in("status", ["open", "closed"])
      .not("fixture_id", "is", null);

    if (marketsError) {
      console.error(`${logPrefix} Failed to fetch markets:`, marketsError);
      return errorResponse("Failed to fetch markets", origin, 500, req);
    }

    let resolved = 0;
    let skipped = 0;
    const results: { market_id: string; title: string; outcome: string | null }[] = [];

    for (const market of markets || []) {
      // Check if fixture has a result
      const { data: result } = await adminClient
        .from("fixture_results")
        .select("goals_home, goals_away, status")
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

      const marketType = (market.market_type || "").toLowerCase();
      const title = (market.title || "").toLowerCase();

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

      // Call atomic resolve_market RPC
      const { data: rpcResult, error: rpcError } = await adminClient.rpc("resolve_market", {
        _market_id: market.id,
        _winning_outcome: winningOutcome,
        _admin_user_id: null,
        _is_system: true,
      });

      if (rpcError) {
        console.error(`${logPrefix} RPC error for market ${market.id}:`, rpcError);
        skipped++;
        continue;
      }

      if (!rpcResult.ok) {
        console.warn(`${logPrefix} Resolution failed for market ${market.id}:`, rpcResult.error);
        skipped++;
        continue;
      }

      results.push({
        market_id: market.id,
        title: market.title,
        outcome: winningOutcome,
      });
      resolved++;
    }

    console.log(`${logPrefix} Complete. Resolved: ${resolved}, Skipped: ${skipped}`);

    return jsonResponse({
      ok: true,
      resolved,
      skipped,
      results,
    }, origin, 200, req);

  } catch (err) {
    console.error(`${logPrefix} Unhandled error:`, err);
    return errorResponse("Internal server error", origin, 500, req);
  }
});
