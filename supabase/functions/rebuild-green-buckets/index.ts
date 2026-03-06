/**
 * rebuild-green-buckets — Recomputes green_buckets from ticket_leg_outcomes
 * 
 * Bucket key: (league_id, market, side, line_norm, odds_band)
 * GREEN = hit_rate >= 65% AND roi_pct >= -2% AND sample_size >= 50
 * 
 * Runs as a cron or admin-triggered function.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

/** Normalize line to nearest 0.5 */
function normalizeLine(line: number): number {
  return Math.round(line * 2) / 2;
}

/** Compute odds band label */
function oddsBand(odds: number): string {
  if (odds < 1.20) return "<1.20";
  if (odds < 1.30) return "1.20-1.30";
  if (odds < 1.40) return "1.30-1.40";
  if (odds < 1.50) return "1.40-1.50";
  if (odds < 1.60) return "1.50-1.60";
  if (odds < 1.70) return "1.60-1.70";
  if (odds < 1.80) return "1.70-1.80";
  if (odds < 1.90) return "1.80-1.90";
  if (odds < 2.00) return "1.90-2.00";
  if (odds < 2.10) return "2.00-2.10";
  if (odds < 2.20) return "2.10-2.20";
  if (odds < 2.30) return "2.20-2.30";
  return "2.30+";
}

interface BucketAgg {
  wins: number;
  losses: number;
  sumOdds: number; // for ROI calc
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const auth = await checkCronOrAdminAuth(req, supabase, serviceRoleKey, "[rebuild-green-buckets]");
  if (!auth.authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Precise 5-month window using proper month arithmetic
    const now = new Date();
    const fiveMonthsAgo = new Date(now);
    fiveMonthsAgo.setMonth(fiveMonthsAgo.getMonth() - 5);
    const windowStart = fiveMonthsAgo.toISOString();
    console.log(`[rebuild-green-buckets] Window: ${windowStart} → ${now.toISOString()}`);

    // Fetch all settled legs in last 5 months
    // Deterministic ordering to prevent page skips/duplicates
    let allLegs: any[] = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("ticket_leg_outcomes")
        .select("league_id, market, side, line, odds, result_status, picked_at, kickoff_at")
        .in("result_status", ["WIN", "LOSS"])
        .gte("kickoff_at", windowStart)
        .not("market", "eq", "cards") // cards globally banned
        .order("kickoff_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error("[rebuild-green-buckets] Query error:", error);
        throw error;
      }

      if (!data || data.length === 0) {
        hasMore = false;
      } else {
        // Filter: picked_at <= kickoff_at (no post-kickoff contamination)
        // NOTE: This is done in JS because Supabase client can't compare two columns.
        // The DB query already limits to settled legs in the 5-month window.
        const clean = data.filter((leg: any) => {
          if (!leg.picked_at || !leg.kickoff_at) return false;
          return new Date(leg.picked_at) <= new Date(leg.kickoff_at);
        });
        allLegs.push(...clean);
        from += pageSize;
        if (data.length < pageSize) hasMore = false;
      }
    }

    console.log(`[rebuild-green-buckets] Fetched ${allLegs.length} clean settled legs`);

    // Aggregate into buckets
    const bucketMap = new Map<string, BucketAgg>();

    for (const leg of allLegs) {
      if (!leg.league_id || !leg.market || !leg.side || leg.line == null || leg.odds == null) continue;

      const lineNorm = normalizeLine(Number(leg.line));
      const band = oddsBand(Number(leg.odds));
      const key = `${leg.league_id}|${leg.market}|${leg.side}|${lineNorm}|${band}`;

      let agg = bucketMap.get(key);
      if (!agg) {
        agg = { wins: 0, losses: 0, sumOdds: 0 };
        bucketMap.set(key, agg);
      }

      if (leg.result_status === "WIN") {
        agg.wins++;
        agg.sumOdds += Number(leg.odds);
      } else {
        agg.losses++;
      }
    }

    // Build rows — only include buckets with sample_size >= 50
    const MIN_SAMPLE = 50;
    const MIN_HIT_RATE = 65;
    const MIN_ROI = -2;

    const rows: any[] = [];
    let totalBuckets = 0;
    let greenBuckets = 0;
    let droppedLowSample = 0;
    let droppedLowHitRate = 0;
    let droppedLowRoi = 0;

    for (const [key, agg] of bucketMap.entries()) {
      totalBuckets++;
      const [leagueId, market, side, lineNorm, band] = key.split("|");
      const sampleSize = agg.wins + agg.losses;

      if (sampleSize < MIN_SAMPLE) {
        droppedLowSample++;
        continue;
      }

      const hitRate = (agg.wins / sampleSize) * 100;
      // ROI = (sum of (odds-1) for wins - losses) / sample_size * 100
      const pnl = (agg.sumOdds - agg.wins) - agg.losses; // sum(odds_i - 1) for wins - losses
      const roi = (pnl / sampleSize) * 100;

      if (hitRate < MIN_HIT_RATE) {
        droppedLowHitRate++;
        continue;
      }

      if (roi < MIN_ROI) {
        droppedLowRoi++;
        continue;
      }

      greenBuckets++;
      rows.push({
        league_id: parseInt(leagueId),
        market,
        side,
        line_norm: parseFloat(lineNorm),
        odds_band: band,
        sample_size: sampleSize,
        wins: agg.wins,
        losses: agg.losses,
        hit_rate_pct: Math.round(hitRate * 100) / 100,
        roi_pct: Math.round(roi * 100) / 100,
        updated_at: new Date().toISOString(),
      });
    }

    console.log(`[rebuild-green-buckets] Buckets: total=${totalBuckets}, green=${greenBuckets}, dropped: lowSample=${droppedLowSample}, lowHitRate=${droppedLowHitRate}, lowROI=${droppedLowRoi}`);

    // Atomic replace: delete all rows then insert new ones
    // Using .neq() on UUID id to guarantee all rows are matched regardless of RLS
    const { error: deleteError } = await supabase
      .from("green_buckets")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (deleteError) {
      console.error("[rebuild-green-buckets] Delete error:", deleteError);
      throw deleteError;
    }

    if (rows.length > 0) {
      // Insert in batches of 100
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { error: insertError } = await supabase
          .from("green_buckets")
          .insert(batch);

        if (insertError) {
          console.error(`[rebuild-green-buckets] Insert batch ${i} error:`, insertError);
          throw insertError;
        }
      }
    }

    console.log(`[rebuild-green-buckets] Done. Inserted ${rows.length} green buckets.`);

    return new Response(
      JSON.stringify({
        status: "OK",
        total_legs_processed: allLegs.length,
        total_buckets: totalBuckets,
        green_buckets: greenBuckets,
        dropped: {
          low_sample: droppedLowSample,
          low_hit_rate: droppedLowHitRate,
          low_roi: droppedLowRoi,
        },
        thresholds: {
          min_sample: MIN_SAMPLE,
          min_hit_rate_pct: MIN_HIT_RATE,
          min_roi_pct: MIN_ROI,
        },
        window: { from: windowStart, to: now.toISOString() },
        buckets: rows,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[rebuild-green-buckets] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
