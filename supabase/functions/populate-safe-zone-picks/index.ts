// ============================================================================
// Populate Safe Zone Picks — Precompute pipeline (runs every 30 min via cron)
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

// League blacklist (hard-coded)
const BLACKLISTED_LEAGUES = [172, 71, 143, 235, 271, 129, 136, 48];

// Odds bands per market
const ODDS_BANDS: Record<string, [number, number]> = {
  corners: [1.40, 2.30],
  goals: [1.50, 1.60],
};

const MIN_SAMPLE_SIZE = 50;
const MIN_BAYES_WIN_RATE = 0.55;

/** Wilson Lower Bound (z=1.96 for 95% CI) */
function wilsonLB(wins: number, total: number): number {
  if (total <= 0) return 0;
  const z = 1.96;
  const p = wins / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const adj = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return Math.max(0, (centre - adj) / denominator);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function computeConfidence(wlb: number, roiPct: number, edgePct: number, sampleSize: number): number {
  return clamp(
    0.4 * wlb +
    0.3 * clamp(roiPct / 30, -1, 1) +
    0.2 * clamp(edgePct / 0.10, -1, 1) +
    0.1 * clamp(sampleSize / 100, 0, 1),
    0, 1
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Auth check
  const auth = await checkCronOrAdminAuth(req, supabase, serviceRoleKey, "[safe-zone-populate]");
  if (!auth.authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const now = new Date().toISOString();
    const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    // 1) Delete expired rows
    await supabase.from("safe_zone_picks").delete().lt("utc_kickoff", now);

    // 2) Fetch candidates from optimized_selections (next 48h, corners/goals, over, not live)
    const { data: candidates, error: candErr } = await supabase
      .from("optimized_selections")
      .select("fixture_id, league_id, market, side, line, odds, bookmaker, edge_pct, model_prob, utc_kickoff")
      .gte("utc_kickoff", now)
      .lte("utc_kickoff", in48h)
      .in("market", ["corners", "goals"])
      .eq("side", "over")
      .eq("is_live", false)
      .not("league_id", "in", `(${BLACKLISTED_LEAGUES.join(",")})`)
      .not("odds", "is", null);

    if (candErr) {
      console.error("[safe-zone-populate] Candidate fetch error:", candErr);
      throw candErr;
    }

    console.log(`[safe-zone-populate] ${candidates?.length || 0} raw candidates`);

    // 3) Filter by odds bands
    const filtered = (candidates || []).filter((c) => {
      const band = ODDS_BANDS[c.market];
      if (!band) return false;
      return c.odds >= band[0] && c.odds <= band[1];
    });

    console.log(`[safe-zone-populate] ${filtered.length} after odds band filter`);

    if (filtered.length === 0) {
      return new Response(
        JSON.stringify({ status: "ok", picks: 0, message: "No candidates passed filters" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4) Get unique league+market+line combos for performance_weights lookup
    const combos = [...new Set(filtered.map((c) => `${c.league_id}|${c.market}|${c.side}|${c.line}`))];
    
    // Fetch performance_weights for these combos
    const { data: weights, error: wErr } = await supabase
      .from("performance_weights")
      .select("league_id, market, side, line, wins, losses, sample_size, bayes_win_rate, roi_pct")
      .gte("sample_size", MIN_SAMPLE_SIZE);

    if (wErr) {
      console.error("[safe-zone-populate] Weights fetch error:", wErr);
      throw wErr;
    }

    // Index weights by key
    const weightMap = new Map<string, typeof weights[0]>();
    for (const w of weights || []) {
      const key = `${w.league_id}|${w.market}|${w.side}|${w.line}`;
      weightMap.set(key, w);
    }

    // 5) Score each candidate
    type ScoredPick = {
      fixture_id: number;
      utc_kickoff: string;
      league_id: number;
      market: string;
      side: string;
      line: number;
      odds: number;
      bookmaker: string | null;
      confidence_score: number;
      wilson_lb: number;
      historical_roi_pct: number;
      sample_size: number;
      edge_pct: number;
    };

    const scored: ScoredPick[] = [];

    for (const c of filtered) {
      const key = `${c.league_id}|${c.market}|${c.side}|${c.line}`;
      const w = weightMap.get(key);
      if (!w) continue; // No performance data → exclude
      if (w.bayes_win_rate < MIN_BAYES_WIN_RATE) continue;

      // Compute edge_pct: prefer stored, then compute from model_prob
      let edgePct = c.edge_pct;
      if (edgePct == null && c.model_prob != null && c.odds > 0) {
        edgePct = c.model_prob - 1 / c.odds;
      }
      if (edgePct == null || edgePct <= 0) continue; // Must have positive edge

      // ROI filter
      if (w.roi_pct <= 0) continue;

      const total = w.wins + w.losses;
      const wlb = wilsonLB(w.wins, total);
      const confidence = computeConfidence(wlb, w.roi_pct, edgePct, w.sample_size);

      scored.push({
        fixture_id: c.fixture_id,
        utc_kickoff: c.utc_kickoff,
        league_id: c.league_id,
        market: c.market,
        side: c.side,
        line: c.line,
        odds: c.odds,
        bookmaker: c.bookmaker,
        confidence_score: Math.round(confidence * 10000) / 10000,
        wilson_lb: Math.round(wlb * 10000) / 10000,
        historical_roi_pct: w.roi_pct,
        sample_size: w.sample_size,
        edge_pct: Math.round(edgePct * 10000) / 10000,
      });
    }

    console.log(`[safe-zone-populate] ${scored.length} scored picks`);

    // 6) One best pick per fixture (highest confidence, then wilson, then roi, then edge)
    const bestByFixture = new Map<number, ScoredPick>();
    for (const s of scored) {
      const existing = bestByFixture.get(s.fixture_id);
      if (
        !existing ||
        s.confidence_score > existing.confidence_score ||
        (s.confidence_score === existing.confidence_score && s.wilson_lb > existing.wilson_lb) ||
        (s.confidence_score === existing.confidence_score && s.wilson_lb === existing.wilson_lb && s.historical_roi_pct > existing.historical_roi_pct)
      ) {
        bestByFixture.set(s.fixture_id, s);
      }
    }

    console.log(`[safe-zone-populate] ${bestByFixture.size} unique fixtures`);

    // 7) Enrich with fixture + league data
    const fixtureIds = [...bestByFixture.keys()];
    if (fixtureIds.length === 0) {
      return new Response(
        JSON.stringify({ status: "ok", picks: 0, message: "No qualifying picks" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: fixtures } = await supabase
      .from("fixtures")
      .select("id, teams_home, teams_away")
      .in("id", fixtureIds);

    const fixtureMap = new Map<number, any>();
    for (const f of fixtures || []) {
      fixtureMap.set(f.id, f);
    }

    const leagueIds = [...new Set([...bestByFixture.values()].map((p) => p.league_id))];
    const { data: leagues } = await supabase
      .from("leagues")
      .select("id, name")
      .in("id", leagueIds);

    const leagueMap = new Map<number, string>();
    for (const l of leagues || []) {
      leagueMap.set(l.id, l.name);
    }

    // 8) Build upsert rows
    const rows = [];
    for (const pick of bestByFixture.values()) {
      const fixture = fixtureMap.get(pick.fixture_id);
      if (!fixture) continue;

      const homeTeam = fixture.teams_home?.name || "Home";
      const awayTeam = fixture.teams_away?.name || "Away";
      const leagueName = leagueMap.get(pick.league_id) || "Unknown";

      const explanation = `${pick.market === "corners" ? "Corners" : "Goals"} Over ${pick.line} in ${leagueName}: Wilson LB ${(pick.wilson_lb * 100).toFixed(0)}%, ROI +${pick.historical_roi_pct.toFixed(0)}%, sample ${pick.sample_size}, edge +${(pick.edge_pct * 100).toFixed(1)}%.`;

      rows.push({
        fixture_id: pick.fixture_id,
        utc_kickoff: pick.utc_kickoff,
        league_id: pick.league_id,
        league_name: leagueName,
        home_team: homeTeam,
        away_team: awayTeam,
        market: pick.market,
        side: pick.side,
        line: pick.line,
        odds: pick.odds,
        bookmaker: pick.bookmaker,
        confidence_score: pick.confidence_score,
        wilson_lb: pick.wilson_lb,
        historical_roi_pct: pick.historical_roi_pct,
        sample_size: pick.sample_size,
        edge_pct: pick.edge_pct,
        explanation,
        computed_at: now,
      });
    }

    // 9) Upsert
    if (rows.length > 0) {
      const { error: upsertErr } = await supabase
        .from("safe_zone_picks")
        .upsert(rows, { onConflict: "fixture_id" });

      if (upsertErr) {
        console.error("[safe-zone-populate] Upsert error:", upsertErr);
        throw upsertErr;
      }
    }

    console.log(`[safe-zone-populate] Upserted ${rows.length} picks`);

    return new Response(
      JSON.stringify({ status: "ok", picks: rows.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[safe-zone-populate] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
