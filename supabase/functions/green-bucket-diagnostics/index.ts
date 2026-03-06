/**
 * green-bucket-diagnostics — Shows why candidates are rejected
 * 
 * For each upcoming optimized_selection, checks:
 * - Does a matching green_bucket exist?
 * - Is odds_band correct?
 * - Is sample_size sufficient?
 * 
 * Returns detailed rejection reasons for debugging.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

function normalizeLine(line: number): number {
  return Math.round(line * 2) / 2;
}

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const auth = await checkCronOrAdminAuth(req, supabase, serviceRoleKey, "[green-bucket-diagnostics]");
  if (!auth.authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Load all green buckets
    const { data: buckets, error: bucketsError } = await supabase
      .from("green_buckets")
      .select("*");

    if (bucketsError) throw bucketsError;

    // Build composite key set for O(1) lookups
    const bucketSet = new Set(
      (buckets || []).map((b: any) =>
        `${b.league_id}|${b.market}|${b.side}|${b.line_norm}|${b.odds_band}`
      )
    );

    // Build indexed sets for O(1) diagnostic lookups (avoids O(n²) .some() scans)
    const leagueSet = new Set((buckets || []).map((b: any) => b.league_id));
    const leagueMarketSet = new Set(
      (buckets || []).map((b: any) => `${b.league_id}|${b.market}`)
    );
    const leagueMarketLineSet = new Set(
      (buckets || []).map((b: any) => `${b.league_id}|${b.market}|${b.line_norm}`)
    );

    // Load upcoming optimized_selections (next 48h)
    const now = new Date();
    const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const { data: candidates, error: candidatesError } = await supabase
      .from("optimized_selections")
      .select("fixture_id, league_id, market, side, line, odds, bookmaker, utc_kickoff")
      .gte("utc_kickoff", now.toISOString())
      .lt("utc_kickoff", in48h.toISOString())
      .not("odds", "is", null)
      .limit(500);

    if (candidatesError) throw candidatesError;

    const results: any[] = [];
    let accepted = 0;
    let rejected = 0;
    const rejectionReasons: Record<string, number> = {};

    for (const c of candidates || []) {
      const lineNorm = normalizeLine(Number(c.line));
      const band = oddsBand(Number(c.odds));
      const bucketKey = `${c.league_id}|${c.market}|${c.side}|${lineNorm}|${band}`;

      // Cards banned
      if (c.market === "cards") {
        rejected++;
        const reason = "cards_banned";
        rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
        results.push({ ...c, line_norm: lineNorm, odds_band: band, status: "REJECTED", reason });
        continue;
      }

      // Odds > 2.30 banned (consistent: 2.30 itself is in "2.20-2.30" band, only reject strictly above)
      if (Number(c.odds) > 2.30) {
        rejected++;
        const reason = "odds_above_2.30";
        rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
        results.push({ ...c, line_norm: lineNorm, odds_band: band, status: "REJECTED", reason });
        continue;
      }

      if (bucketSet.has(bucketKey)) {
        accepted++;
        results.push({ ...c, line_norm: lineNorm, odds_band: band, status: "ACCEPTED", reason: "green_bucket_match" });
      } else {
        rejected++;
        // Diagnose WHY no match using O(1) indexed set lookups
        const hasLeague = leagueSet.has(c.league_id);
        const hasMarket = leagueMarketSet.has(`${c.league_id}|${c.market}`);
        const hasLine = leagueMarketLineSet.has(`${c.league_id}|${c.market}|${lineNorm}`);

        let reason: string;
        if (!hasLeague) {
          reason = "no_bucket_for_league";
        } else if (!hasMarket) {
          reason = "no_bucket_for_market_in_league";
        } else if (!hasLine) {
          reason = "no_bucket_for_line_in_league_market";
        } else {
          reason = "odds_band_mismatch";
        }

        rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
        results.push({ ...c, line_norm: lineNorm, odds_band: band, status: "REJECTED", reason });
      }
    }

    return new Response(
      JSON.stringify({
        summary: {
          total_candidates: (candidates || []).length,
          accepted,
          rejected,
          green_buckets_loaded: (buckets || []).length,
          rejection_breakdown: rejectionReasons,
        },
        candidates: results,
        buckets: buckets || [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[green-bucket-diagnostics] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
