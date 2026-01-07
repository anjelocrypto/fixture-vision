import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const LOG_PREFIX = "[update-performance-weights]";

// Bayesian shrinkage parameters
const PRIOR_STRENGTH = 50;
const PRIOR_WIN_RATE = 0.5;

interface AggregatedStats {
  market: string;
  side: string;
  line: number;
  league_id: number | null;
  wins: number;
  losses: number;
  pushes: number;
  sample_size: number;
  total_odds: number;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(origin) });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Auth check
  const authResult = await checkCronOrAdminAuth(req, supabase, SUPABASE_SERVICE_ROLE_KEY, LOG_PREFIX);
  if (!authResult.authorized) {
    console.error(`${LOG_PREFIX} Unauthorized: ${authResult.error}`);
    return errorResponse(authResult.error ?? "Unauthorized", origin, 401);
  }

  console.log(`${LOG_PREFIX} Authorized via ${authResult.method}, starting weight computation...`);

  try {
    // Get last 90 days of ticket leg outcomes
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    const { data: outcomes, error: fetchError } = await supabase
      .from("ticket_leg_outcomes")
      .select("market, side, line, league_id, odds, result_status")
      .gte("settled_at", cutoffDate.toISOString())
      .in("result_status", ["WIN", "LOSS", "PUSH"]);

    if (fetchError) {
      throw new Error(`Failed to fetch outcomes: ${fetchError.message}`);
    }

    console.log(`${LOG_PREFIX} Fetched ${outcomes?.length ?? 0} settled legs from last 90 days`);

    if (!outcomes || outcomes.length === 0) {
      return jsonResponse({ success: true, message: "No settled outcomes to process", upserted: 0 }, origin);
    }

    // Aggregate by market|side|line (global) and by market|side|line|league_id
    const globalStats = new Map<string, AggregatedStats>();
    const leagueStats = new Map<string, AggregatedStats>();

    for (const leg of outcomes) {
      const { market, side, line, league_id, odds, result_status } = leg;
      
      // Global key (league_id = null)
      const globalKey = `${market}|${side}|${line}`;
      let globalAgg = globalStats.get(globalKey);
      if (!globalAgg) {
        globalAgg = { market, side, line, league_id: null, wins: 0, losses: 0, pushes: 0, sample_size: 0, total_odds: 0 };
        globalStats.set(globalKey, globalAgg);
      }
      updateAggregation(globalAgg, result_status, odds);

      // League-specific key
      if (league_id !== null) {
        const leagueKey = `${market}|${side}|${line}|${league_id}`;
        let leagueAgg = leagueStats.get(leagueKey);
        if (!leagueAgg) {
          leagueAgg = { market, side, line, league_id, wins: 0, losses: 0, pushes: 0, sample_size: 0, total_odds: 0 };
          leagueStats.set(leagueKey, leagueAgg);
        }
        updateAggregation(leagueAgg, result_status, odds);
      }
    }

    // Combine all aggregations
    const allAggregations = [...globalStats.values(), ...leagueStats.values()];
    console.log(`${LOG_PREFIX} Computed ${allAggregations.length} aggregations (${globalStats.size} global, ${leagueStats.size} league-specific)`);

    // Prepare upsert records with league_key for proper unique constraint
    const records = allAggregations.map((agg) => {
      const { wins, losses, pushes, sample_size, total_odds } = agg;
      
      // Raw win rate (exclude pushes from denominator)
      const decisiveLegs = wins + losses;
      const rawWinRate = decisiveLegs > 0 ? wins / decisiveLegs : 0;
      
      // ROI calculation: (total_profit / total_staked) * 100
      // For each leg: profit = (odds - 1) if win, -1 if loss, 0 if push
      // total_staked = wins + losses (pushes return stake)
      const totalProfit = wins > 0 ? (total_odds - wins) : 0; // sum of (odds-1) for wins
      const actualProfit = totalProfit - losses; // subtract losses
      const roiPct = decisiveLegs > 0 ? (actualProfit / decisiveLegs) * 100 : 0;
      
      // Bayesian win rate: (wins + prior_strength * prior) / (sample + prior_strength)
      const bayesWinRate = (wins + PRIOR_STRENGTH * PRIOR_WIN_RATE) / (sample_size + PRIOR_STRENGTH);
      
      // Weight: clamp(bayes / 0.5, 0.7, 1.5)
      const rawWeight = bayesWinRate / 0.5;
      const weight = Math.max(0.7, Math.min(1.5, rawWeight));

      return {
        market: agg.market,
        side: agg.side,
        line: agg.line,
        league_id: agg.league_id,
        league_key: agg.league_id ?? -1, // For proper unique constraint
        sample_size,
        wins,
        losses,
        pushes,
        raw_win_rate: Number(rawWinRate.toFixed(4)),
        roi_pct: Number(roiPct.toFixed(2)),
        bayes_win_rate: Number(bayesWinRate.toFixed(4)),
        weight: Number(weight.toFixed(4)),
        computed_at: new Date().toISOString(),
      };
    });

    // Batch upsert with proper unique constraint (market, side, line, league_key)
    const { error: upsertError, count } = await supabase
      .from("performance_weights")
      .upsert(records, { 
        onConflict: "market,side,line,league_key",
        ignoreDuplicates: false 
      });

    if (upsertError) {
      console.error(`${LOG_PREFIX} Batch upsert error: ${upsertError.message}`);
      throw new Error(`Upsert failed: ${upsertError.message}`);
    }

    const upserted = records.length;

    console.log(`${LOG_PREFIX} Successfully upserted ${upserted}/${records.length} performance weights`);

    return jsonResponse({
      success: true,
      processed: outcomes.length,
      aggregations: allAggregations.length,
      upserted,
    }, origin);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} Error:`, message);
    return errorResponse(message, origin, 500);
  }
});

function updateAggregation(agg: AggregatedStats, status: string, odds: number | null): void {
  agg.sample_size++;
  if (status === "WIN") {
    agg.wins++;
    agg.total_odds += odds ?? 0;
  } else if (status === "LOSS") {
    agg.losses++;
  } else if (status === "PUSH") {
    agg.pushes++;
  }
}
