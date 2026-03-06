// ============================================================================
// Populate Safe Zone Picks — GREEN BUCKETS enforced (data-driven)
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";
import {
  isAllowlisted,
  filterByAllowlist,
  filterByGreenBuckets,
  buildGreenBucketsContext,
  ALLOWED_LEAGUE_IDS,
  ALLOWED_MARKET_LINES,
  BANNED_MARKETS,
  GLOBAL_ODDS_CAP,
  normalizeLine,
  type GreenBucketsContext,
} from "../_shared/green_allowlist.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

const MIN_SAMPLE_SIZE = 50;

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

  // Check for diagnostic mode
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const diagnosticMode = body.diagnostic === true;

  try {
    const now = new Date().toISOString();
    const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    // 1) Delete expired rows
    await supabase.from("safe_zone_picks").delete().lt("utc_kickoff", now);

    // 2) Load green_buckets for data-driven filtering
    const { data: gbRows, error: gbErr } = await supabase
      .from("green_buckets")
      .select("league_id, market, side, line_norm, odds_band, hit_rate_pct, sample_size, roi_pct");

    let gbContext: GreenBucketsContext | null = null;
    if (gbErr) {
      console.error("[safe-zone-populate] Failed to load green_buckets:", gbErr);
    } else if (gbRows && gbRows.length > 0) {
      gbContext = buildGreenBucketsContext(gbRows as any);
      console.log(`[safe-zone-populate] Green buckets loaded: ${gbRows.length} buckets, leagues=[${gbContext.leagueIds.join(',')}], markets=[${gbContext.markets.join(',')}]`);
    } else {
      console.warn("[safe-zone-populate] green_buckets table is empty — using static allowlist fallback");
    }

    // Derive allowed leagues/markets from green_buckets (or fallback to static)
    const effectiveLeagueIds = gbContext ? gbContext.leagueIds : ALLOWED_LEAGUE_IDS;
    const effectiveMarkets = gbContext ? gbContext.markets.filter(m => !BANNED_MARKETS.includes(m)) : ALLOWED_MARKET_LINES.map(ml => ml.market);

    // 3) Fetch candidates using green_buckets-derived constraints
    const { data: candidates, error: candErr } = await supabase
      .from("optimized_selections")
      .select("fixture_id, league_id, market, side, line, odds, bookmaker, edge_pct, model_prob, utc_kickoff")
      .gte("utc_kickoff", now)
      .lte("utc_kickoff", in48h)
      .in("market", effectiveMarkets)
      .eq("is_live", false)
      .in("league_id", effectiveLeagueIds)
      .not("odds", "is", null)
      .lte("odds", GLOBAL_ODDS_CAP);

    if (candErr) {
      console.error("[safe-zone-populate] Candidate fetch error:", candErr);
      throw candErr;
    }

    const rawCount = candidates?.length || 0;
    console.log(`[safe-zone-populate] ${rawCount} raw candidates from ${effectiveLeagueIds.length} leagues`);

    // 4) Filter through green_buckets (or static allowlist fallback)
    const { passed: filtered, violations } = gbContext
      ? filterByGreenBuckets(gbContext, candidates || [])
      : filterByAllowlist(candidates || []);
    
    console.log(`[safe-zone-populate] ${filtered.length} passed filter, ${violations.length} rejected`);
    if (violations.length > 0) {
      const sampleViolations = violations.slice(0, 5).map(v => v.reason);
      console.log(`[safe-zone-populate] Sample violations: ${sampleViolations.join('; ')}`);
    }

    if (filtered.length === 0) {
      const result = { status: "ok", picks: 0, message: "No candidates passed green_buckets filter" };
      if (diagnosticMode) {
        Object.assign(result, { diagnostic: { candidates_raw: rawCount, after_filter: 0, violations_sample: violations.slice(0, 10).map(v => v.reason) } });
      }
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4) Fetch performance_weights for allowed markets
    const { data: weights, error: wErr } = await supabase
      .from("performance_weights")
      .select("league_id, league_key, market, side, line, wins, losses, sample_size, bayes_win_rate, roi_pct")
      .in("market", allowedMarkets)
      .eq("side", "over")
      .gte("sample_size", MIN_SAMPLE_SIZE);

    if (wErr) {
      console.error("[safe-zone-populate] Weights fetch error:", wErr);
      throw wErr;
    }

    const weightMap = new Map<string, typeof weights[0]>();
    for (const w of weights || []) {
      const lid = w.league_id ?? w.league_key;
      const normalizedLine = normalizeLine(w.line);
      const key = `${lid}|${w.market}|${w.side}|${normalizedLine}`;
      weightMap.set(key, w);
    }

    console.log(`[safe-zone-populate] ${weightMap.size} performance weight entries loaded (sample >= ${MIN_SAMPLE_SIZE})`);

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
    let noWeightMatch = 0;
    let failedWilsonOrRoi = 0;
    let failedEdge = 0;

    for (const c of filtered) {
      const normalizedLine = normalizeLine(c.line);
      const leagueKey = `${c.league_id}|${c.market}|${c.side}|${normalizedLine}`;
      const globalKey = `-1|${c.market}|${c.side}|${normalizedLine}`;
      const w = weightMap.get(leagueKey) || weightMap.get(globalKey);

      if (!w) {
        noWeightMatch++;
        continue;
      }

      const total = w.wins + w.losses;
      const wlb = wilsonLB(w.wins, total);
      
      if (wlb < 0.55 && w.roi_pct <= 0) {
        failedWilsonOrRoi++;
        continue;
      }

      let edgePct = c.edge_pct;
      if (edgePct == null && c.model_prob != null && c.odds > 0) {
        edgePct = c.model_prob - 1 / c.odds;
      }
      if (edgePct != null && edgePct < 0) {
        failedEdge++;
        continue;
      }
      const finalEdge = edgePct ?? 0;

      const confidence = computeConfidence(wlb, w.roi_pct, finalEdge, w.sample_size);

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
        edge_pct: Math.round(finalEdge * 10000) / 10000,
      });
    }

    console.log(`[safe-zone-populate] Scoring: ${scored.length} passed, ${noWeightMatch} no weight match, ${failedWilsonOrRoi} failed wilson/roi, ${failedEdge} negative edge`);

    // 6) One best pick per fixture
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

    console.log(`[safe-zone-populate] ${bestByFixture.size} unique fixtures after dedup`);

    // 7) Enrich with fixture + league data
    const fixtureIds = [...bestByFixture.keys()];
    if (fixtureIds.length === 0) {
      const result: any = { status: "ok", picks: 0, message: "No qualifying picks after scoring" };
      if (diagnosticMode) {
        result.diagnostic = {
          candidates_raw: rawCount,
          after_allowlist: filtered.length,
          weight_entries_loaded: weightMap.size,
          no_weight_match: noWeightMatch,
          failed_wilson_or_roi: failedWilsonOrRoi,
          failed_edge: failedEdge,
          scored: scored.length,
          final: 0,
        };
      }
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: fixtures } = await supabase
      .from("fixtures")
      .select("id, teams_home, teams_away")
      .in("id", fixtureIds);

    const fixtureMap = new Map<number, any>();
    for (const f of fixtures || []) {
      fixtureMap.set(f.id, f);
    }

    const leagueIdsSet = [...new Set([...bestByFixture.values()].map((p) => p.league_id))];
    const { data: leagues } = await supabase
      .from("leagues")
      .select("id, name")
      .in("id", leagueIdsSet);

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

    const result: any = { status: "ok", picks: rows.length };
    if (diagnosticMode) {
      result.diagnostic = {
        candidates_raw: rawCount,
        after_allowlist: filtered.length,
        violations_count: violations.length,
        weight_entries_loaded: weightMap.size,
        no_weight_match: noWeightMatch,
        failed_wilson_or_roi: failedWilsonOrRoi,
        failed_edge: failedEdge,
        scored: scored.length,
        unique_fixtures: bestByFixture.size,
        final_upsert: rows.length,
        allowlist: {
          leagues: ALLOWED_LEAGUE_IDS,
          markets: ALLOWED_MARKET_LINES,
          odds_cap: GLOBAL_ODDS_CAP,
        },
      };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[safe-zone-populate] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
