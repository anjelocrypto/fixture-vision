// ============================================================================
// Daily 2 Strongest Signals — Edge Function
// ============================================================================
// Identifies the 2 strongest historical analytics signals from fixtures in the
// next 24 hours. Uses green bucket performance, performance_weights, team stats,
// odds freshness, and a strict composite daily_signal_score.
//
// This is an analytics feature — no betting/wagering language.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Configuration ──────────────────────────────────────────────────────────

const MAX_SIGNALS = 2;
const WINDOW_HOURS = 24;

// Strict quality gates
const MIN_HIT_RATE = 0.65;          // 65% minimum from green_buckets
const MIN_SAMPLE_SIZE = 50;         // Minimum historical sample
const MIN_ROI = -2;                 // ROI floor for green buckets
const PREFERRED_ODDS_MIN = 1.40;    // Research filter: 1.40–1.60 band
const PREFERRED_ODDS_MAX = 1.60;
const HARD_ODDS_MIN = 1.20;        // Hard reject below this
const HARD_ODDS_MAX = 2.00;        // Hard reject above this
const STATS_FRESHNESS_HOURS = 48;
const ODDS_FRESHNESS_HOURS = 6;
const MIN_TEAM_SAMPLE = 3;         // Minimum per-team match sample

// Scoring weights for daily_signal_score
const W_HIT_RATE = 0.25;
const W_SAMPLE = 0.15;
const W_GREEN_VALIDATION = 0.10;
const W_RECENCY = 0.15;
const W_LEAGUE = 0.10;
const W_MARKET_STABILITY = 0.05;
const W_STATS_FRESH = 0.05;
const W_ODDS_FRESH = 0.05;
const W_ROI = 0.05;
const W_FORM = 0.05;

// League tiers
const TOP_LEAGUES = new Set([
  39, 140, 135, 78, 61,   // Big 5
  40, 136, 79, 88, 94,    // Strong secondary
  2, 3, 848,              // UEFA competitions
]);
const MID_LEAGUES = new Set([
  203, 207, 144, 253, 262, 179, 113, 188, 218, 235, 119,
  71, 98, 307, 233, 45, 48, 143, 66, 141, 89,
]);

// ── Types ──────────────────────────────────────────────────────────────────

interface Candidate {
  fixture_id: number;
  league_id: number;
  league_name: string;
  home_team: string;
  away_team: string;
  market: string;
  side: string;
  line: number;
  odds: number | null;
  odds_band: string;
  kickoff_at: string;
  // Historical evidence
  hit_rate: number;
  sample_size: number;
  roi_pct: number;
  // Performance weights cross-ref
  pw_hit_rate: number | null;
  pw_sample: number | null;
  pw_bayes_wr: number | null;
  // Freshness
  stats_computed_at: string | null;
  home_sample_size: number;
  away_sample_size: number;
  odds_captured_at: string | null;
  // Scoring
  daily_signal_score: number;
  confidence_tier: string;
  trend_label: string;
  freshness_status: string;
  warning_flags: string[];
  supporting_reason: string;
  rejection_reason?: string;
}

// ── Scoring helpers ────────────────────────────────────────────────────────

function scoreHitRate(hr: number): number {
  // 65% = 0, 80% = 0.6, 90%+ = 1.0
  return Math.min(1, Math.max(0, (hr - 0.65) / 0.35));
}

function scoreSample(size: number): number {
  if (size >= 250) return 1.0;
  if (size >= 150) return 0.7 + (size - 150) / 333;
  if (size >= 80) return 0.4 + (size - 80) / 233;
  return Math.max(0, 0.1 + (size - 50) * 0.01);
}

function scoreGreenValidation(hasGreen: boolean, greenHR: number, greenROI: number): number {
  if (!hasGreen) return 0;
  let s = 0.5;
  if (greenHR >= 0.85) s += 0.3;
  else if (greenHR >= 0.75) s += 0.2;
  else s += 0.1;
  if (greenROI >= 20) s += 0.2;
  else if (greenROI >= 5) s += 0.1;
  return Math.min(1, s);
}

function scoreRecency(pwHR: number | null, greenHR: number): number {
  // Compare performance_weights hit rate (recent-weighted) to green bucket lifetime
  if (pwHR === null) return 0.3; // no PW data = uncertain
  const diff = Math.abs(pwHR - greenHR);
  if (diff <= 0.05) return 1.0;  // very consistent
  if (diff <= 0.10) return 0.7;
  if (diff <= 0.15) return 0.4;
  return 0.1; // degrading
}

function determineTrend(pwHR: number | null, greenHR: number): string {
  if (pwHR === null) return "unknown";
  const diff = pwHR - greenHR;
  if (diff > 0.03) return "improving";
  if (diff < -0.10) return "degrading";
  return "stable";
}

function scoreLeague(leagueId: number): number {
  if (TOP_LEAGUES.has(leagueId)) return 1.0;
  if (MID_LEAGUES.has(leagueId)) return 0.6;
  return 0.25;
}

function scoreMarketStability(market: string): number {
  if (market === "goals") return 1.0;
  if (market === "corners") return 0.6;
  return 0.3;
}

function scoreStatsFreshness(computedAt: string | null): number {
  if (!computedAt) return 0;
  const ageH = (Date.now() - new Date(computedAt).getTime()) / 3600000;
  if (ageH <= 12) return 1.0;
  if (ageH <= 24) return 0.8;
  if (ageH <= STATS_FRESHNESS_HOURS) return 0.4;
  return 0;
}

function scoreOddsFreshness(capturedAt: string | null): number {
  if (!capturedAt) return 0;
  const ageH = (Date.now() - new Date(capturedAt).getTime()) / 3600000;
  if (ageH <= 2) return 1.0;
  if (ageH <= 4) return 0.7;
  if (ageH <= ODDS_FRESHNESS_HOURS) return 0.4;
  return 0;
}

function scoreROI(roi: number): number {
  if (roi >= 20) return 1.0;
  if (roi >= 10) return 0.8;
  if (roi >= 5) return 0.6;
  if (roi >= 0) return 0.4;
  if (roi >= MIN_ROI) return 0.2;
  return 0;
}

function scoreTeamForm(homeSample: number, awaySample: number): number {
  const min = Math.min(homeSample, awaySample);
  if (min >= 10) return 1.0;
  if (min >= 5) return 0.6;
  if (min >= MIN_TEAM_SAMPLE) return 0.3;
  return 0;
}

function getConfidenceTier(score: number): string {
  if (score >= 0.75) return "very_high";
  if (score >= 0.60) return "high";
  if (score >= 0.45) return "moderate";
  return "insufficient";
}

function getOddsBand(odds: number | null): string {
  if (!odds) return "unknown";
  if (odds >= PREFERRED_ODDS_MIN && odds <= PREFERRED_ODDS_MAX) return "1.40-1.60";
  if (odds < 1.30) return "1.20-1.30";
  if (odds < 1.40) return "1.30-1.40";
  if (odds < 1.70) return "1.60-1.70";
  if (odds < 1.90) return "1.70-1.90";
  return "1.90+";
}

// ── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const startTime = Date.now();

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // GET = read cached signals for today
    if (req.method === "GET") {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const { data: cached, error } = await supabase
        .from("daily_safest_insights")
        .select("*")
        .gte("computed_at", todayStart.toISOString())
        .order("daily_safety_score", { ascending: false })
        .limit(MAX_SIGNALS);

      if (error) {
        console.error("[daily-signals] Read error:", error);
        return errorResponse("Failed to read signals", origin, 500, req);
      }

      return jsonResponse({ signals: cached || [], generated_at: cached?.[0]?.computed_at || null }, origin, 200, req);
    }

    // POST = generate new signals (admin/cron only)
    const authResult = await checkCronOrAdminAuth(req, supabase, SUPABASE_SERVICE_ROLE_KEY, "[daily-signals]");
    if (!authResult.authorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }

    console.log("[daily-signals] ═══════════════════════════════════════════");
    console.log("[daily-signals] 🔍 Starting Daily 2 Strongest Signals generation");

    // ── Step 1: Upcoming fixtures (next 24h) ──────────────────────────────
    const nowTs = Math.floor(Date.now() / 1000);
    const windowEndTs = nowTs + WINDOW_HOURS * 3600;

    const { data: fixtures, error: fxError } = await supabase
      .from("fixtures")
      .select("id, league_id, teams_home, teams_away, timestamp, status")
      .in("status", ["NS", "TBD"])
      .gte("timestamp", nowTs)
      .lte("timestamp", windowEndTs)
      .order("timestamp", { ascending: true });

    if (fxError) {
      console.error("[daily-signals] Fixtures error:", fxError);
      return errorResponse("Failed to fetch fixtures", origin, 500, req);
    }

    console.log(`[daily-signals] Found ${fixtures?.length || 0} fixtures in next ${WINDOW_HOURS}h`);

    if (!fixtures || fixtures.length === 0) {
      return jsonResponse({
        signals: [],
        candidates_evaluated: 0,
        rejected: [],
        fallback_used: false,
        reason: "No upcoming fixtures in window",
        duration_ms: Date.now() - startTime,
      }, origin, 200, req);
    }

    // ── Step 2: Green buckets ──────────────────────────────────────────────
    const fixtureLeagueIds = [...new Set(fixtures.map((f: any) => f.league_id))];

    const { data: greenBuckets, error: gbError } = await supabase
      .from("green_buckets")
      .select("*")
      .in("league_id", fixtureLeagueIds)
      .gte("hit_rate_pct", MIN_HIT_RATE * 100)
      .gte("sample_size", MIN_SAMPLE_SIZE)
      .gte("roi_pct", MIN_ROI);

    if (gbError) {
      console.error("[daily-signals] Green buckets error:", gbError);
      return errorResponse("Failed to fetch green buckets", origin, 500, req);
    }

    console.log(`[daily-signals] Qualifying green buckets: ${greenBuckets?.length || 0}`);

    if (!greenBuckets || greenBuckets.length === 0) {
      return jsonResponse({
        signals: [],
        candidates_evaluated: 0,
        rejected: [{ reason: "No green buckets meeting quality thresholds for these leagues" }],
        fallback_used: false,
        duration_ms: Date.now() - startTime,
      }, origin, 200, req);
    }

    const bucketsByLeague = new Map<number, any[]>();
    for (const gb of greenBuckets) {
      const arr = bucketsByLeague.get(gb.league_id) || [];
      arr.push(gb);
      bucketsByLeague.set(gb.league_id, arr);
    }

    // ── Step 3: Performance weights (recency cross-reference) ─────────────
    const { data: perfWeights } = await supabase
      .from("performance_weights")
      .select("league_id, market, side, line, sample_size, raw_win_rate, bayes_win_rate, roi_pct")
      .in("league_id", fixtureLeagueIds);

    // Build PW lookup: `${league_id}-${market}-${side}-${line}` -> pw
    const pwLookup = new Map<string, any>();
    for (const pw of perfWeights || []) {
      if (pw.league_id) {
        pwLookup.set(`${pw.league_id}-${pw.market}-${pw.side}-${pw.line}`, pw);
      }
    }
    console.log(`[daily-signals] Performance weights loaded: ${pwLookup.size} league-specific entries`);

    // ── Step 4: League names ──────────────────────────────────────────────
    const { data: leaguesData } = await supabase
      .from("leagues")
      .select("id, name")
      .in("id", fixtureLeagueIds);

    const leagueNames = new Map<number, string>();
    for (const l of leaguesData || []) {
      leagueNames.set(l.id, l.name);
    }

    // ── Step 5: Stats freshness ───────────────────────────────────────────
    const teamIds = new Set<number>();
    for (const fx of fixtures) {
      const hid = fx.teams_home?.id;
      const aid = fx.teams_away?.id;
      if (hid) teamIds.add(Number(hid));
      if (aid) teamIds.add(Number(aid));
    }

    const { data: statsCache } = await supabase
      .from("stats_cache")
      .select("team_id, computed_at, sample_size")
      .in("team_id", Array.from(teamIds));

    const statsByTeam = new Map<number, { computed_at: string | null; sample_size: number }>();
    for (const s of statsCache || []) {
      statsByTeam.set(s.team_id, { computed_at: s.computed_at, sample_size: s.sample_size });
    }

    // ── Step 6: Odds freshness ────────────────────────────────────────────
    const fixtureIds = fixtures.map((f: any) => f.id);
    const { data: oddsData } = await supabase
      .from("odds_cache")
      .select("fixture_id, captured_at")
      .in("fixture_id", fixtureIds);

    const oddsByFixture = new Map<number, string>();
    for (const o of oddsData || []) {
      const existing = oddsByFixture.get(o.fixture_id);
      if (!existing || new Date(o.captured_at) > new Date(existing)) {
        oddsByFixture.set(o.fixture_id, o.captured_at);
      }
    }

    // ── Step 7: Optimized selections for live odds ────────────────────────
    const { data: selections } = await supabase
      .from("optimized_selections")
      .select("fixture_id, market, side, line, odds, computed_at")
      .in("fixture_id", fixtureIds);

    const selectionLookup = new Map<string, any>();
    for (const sel of selections || []) {
      selectionLookup.set(`${sel.fixture_id}-${sel.market}-${sel.side}-${sel.line}`, sel);
    }

    // ── Step 8: Score all candidates ──────────────────────────────────────
    const candidates: Candidate[] = [];
    const rejected: Array<{ fixture_id: number; league: string; market: string; line: number; reason: string }> = [];

    for (const fx of fixtures) {
      const homeId = Number(fx.teams_home?.id);
      const awayId = Number(fx.teams_away?.id);
      const leagueBuckets = bucketsByLeague.get(fx.league_id) || [];
      const lName = leagueNames.get(fx.league_id) || "Unknown";

      if (leagueBuckets.length === 0) {
        rejected.push({ fixture_id: fx.id, league: lName, market: "*", line: 0, reason: "No green buckets for this league" });
        continue;
      }

      const homeStats = statsByTeam.get(homeId);
      const awayStats = statsByTeam.get(awayId);
      const oddsTimestamp = oddsByFixture.get(fx.id);

      for (const bucket of leagueBuckets) {
        const selKey = `${fx.id}-${bucket.market}-${bucket.side}-${bucket.line_norm}`;
        const sel = selectionLookup.get(selKey);
        const odds = sel?.odds ?? null;
        const warnings: string[] = [];

        // ── GATE: Stats freshness ──────────────────────────────────────
        const statsAge = homeStats?.computed_at
          ? (Date.now() - new Date(homeStats.computed_at).getTime()) / 3600000
          : Infinity;

        if (statsAge > STATS_FRESHNESS_HOURS) {
          rejected.push({ fixture_id: fx.id, league: lName, market: bucket.market, line: bucket.line_norm, reason: `Stats stale: ${Math.round(statsAge)}h (max ${STATS_FRESHNESS_HOURS}h)` });
          continue;
        }

        // ── GATE: Odds freshness ───────────────────────────────────────
        const oddsAge = oddsTimestamp
          ? (Date.now() - new Date(oddsTimestamp).getTime()) / 3600000
          : Infinity;

        if (oddsAge > ODDS_FRESHNESS_HOURS) {
          warnings.push(`odds_age_${Math.round(oddsAge)}h`);
        }

        // ── GATE: Hard odds range ──────────────────────────────────────
        if (odds !== null && (odds < HARD_ODDS_MIN || odds > HARD_ODDS_MAX)) {
          rejected.push({ fixture_id: fx.id, league: lName, market: bucket.market, line: bucket.line_norm, reason: `Odds ${odds} outside hard range [${HARD_ODDS_MIN}-${HARD_ODDS_MAX}]` });
          continue;
        }

        // ── GATE: Team data quality ────────────────────────────────────
        const homeSample = homeStats?.sample_size ?? 0;
        const awaySample = awayStats?.sample_size ?? 0;

        if (homeSample < MIN_TEAM_SAMPLE || awaySample < MIN_TEAM_SAMPLE) {
          rejected.push({ fixture_id: fx.id, league: lName, market: bucket.market, line: bucket.line_norm, reason: `Insufficient team data: home=${homeSample}, away=${awaySample}` });
          continue;
        }

        // ── Cross-reference performance_weights ────────────────────────
        const pwKey = `${fx.league_id}-${bucket.market}-${bucket.side}-${bucket.line_norm}`;
        const pw = pwLookup.get(pwKey);
        const pwHR = pw ? pw.raw_win_rate : null;
        const pwSample = pw ? pw.sample_size : null;
        const pwBayes = pw ? pw.bayes_win_rate : null;

        // ── GATE: Trend degradation ────────────────────────────────────
        const hitRate = bucket.hit_rate_pct / 100;
        const trend = determineTrend(pwHR, hitRate);

        if (trend === "degrading" && pwHR !== null && pwHR < 0.50) {
          rejected.push({ fixture_id: fx.id, league: lName, market: bucket.market, line: bucket.line_norm, reason: `Degrading trend: PW hit ${(pwHR * 100).toFixed(1)}% vs green ${(hitRate * 100).toFixed(1)}%` });
          continue;
        }

        // ── Preferred odds band filter (soft penalty, not hard reject) ─
        const oddsBand = getOddsBand(odds);
        const inPreferredBand = odds !== null && odds >= PREFERRED_ODDS_MIN && odds <= PREFERRED_ODDS_MAX;
        if (!inPreferredBand && odds !== null) {
          warnings.push("outside_preferred_odds_band");
        }

        // ── Compute daily_signal_score ──────────────────────────────────
        const sHitRate = scoreHitRate(hitRate);
        const sSample = scoreSample(bucket.sample_size);
        const sGreen = scoreGreenValidation(true, hitRate, bucket.roi_pct);
        const sRecency = scoreRecency(pwHR, hitRate);
        const sLeague = scoreLeague(fx.league_id);
        const sMarket = scoreMarketStability(bucket.market);
        const sStatsFresh = scoreStatsFreshness(homeStats?.computed_at ?? null);
        const sOddsFresh = scoreOddsFreshness(oddsTimestamp ?? null);
        const sROI = scoreROI(bucket.roi_pct);
        const sForm = scoreTeamForm(homeSample, awaySample);

        let score =
          sHitRate * W_HIT_RATE +
          sSample * W_SAMPLE +
          sGreen * W_GREEN_VALIDATION +
          sRecency * W_RECENCY +
          sLeague * W_LEAGUE +
          sMarket * W_MARKET_STABILITY +
          sStatsFresh * W_STATS_FRESH +
          sOddsFresh * W_ODDS_FRESH +
          sROI * W_ROI +
          sForm * W_FORM;

        // ── Penalty adjustments ────────────────────────────────────────
        if (oddsAge > ODDS_FRESHNESS_HOURS) {
          score *= 0.85;
          warnings.push("odds_stale");
        }

        if (homeSample < 5 || awaySample < 5) {
          score *= 0.90;
          warnings.push("low_team_sample");
        }

        if (odds !== null && odds < 1.30) {
          score *= 0.85;
          warnings.push("very_low_odds");
        }

        if (trend === "degrading") {
          score *= 0.80;
          warnings.push("degrading_trend");
        }

        // Bonus for preferred odds band
        if (inPreferredBand) {
          score *= 1.05;
        }

        const confidenceTier = getConfidenceTier(score);

        if (confidenceTier === "insufficient") {
          rejected.push({ fixture_id: fx.id, league: lName, market: bucket.market, line: bucket.line_norm, reason: `Score ${score.toFixed(3)} below minimum threshold` });
          continue;
        }

        const reason = buildSupportingReason(bucket, hitRate, homeSample, awaySample, lName, trend, pwHR, pwSample);

        candidates.push({
          fixture_id: fx.id,
          league_id: fx.league_id,
          league_name: lName,
          home_team: fx.teams_home?.name || "Unknown",
          away_team: fx.teams_away?.name || "Unknown",
          market: bucket.market,
          side: bucket.side,
          line: bucket.line_norm,
          odds,
          odds_band: oddsBand,
          kickoff_at: new Date(fx.timestamp * 1000).toISOString(),
          hit_rate: hitRate,
          sample_size: bucket.sample_size,
          roi_pct: bucket.roi_pct,
          pw_hit_rate: pwHR,
          pw_sample: pwSample ?? null,
          pw_bayes_wr: pwBayes ?? null,
          stats_computed_at: homeStats?.computed_at ?? null,
          home_sample_size: homeSample,
          away_sample_size: awaySample,
          odds_captured_at: oddsTimestamp ?? null,
          daily_signal_score: Math.round(score * 1000) / 1000,
          confidence_tier: confidenceTier,
          trend_label: trend,
          freshness_status: oddsAge <= ODDS_FRESHNESS_HOURS && statsAge <= STATS_FRESHNESS_HOURS ? "fresh" : "partial",
          warning_flags: warnings,
          supporting_reason: reason,
        });
      }
    }

    console.log(`[daily-signals] Candidates: ${candidates.length}, Rejected: ${rejected.length}`);

    // ── Step 9: Select top 2 with diversity ──────────────────────────────
    candidates.sort((a, b) => b.daily_signal_score - a.daily_signal_score);

    const selected: Candidate[] = [];
    const usedFixtures = new Set<number>();
    const usedLeagues = new Set<number>();
    const usedMarkets = new Set<string>();

    for (const c of candidates) {
      if (selected.length >= MAX_SIGNALS) break;

      // Hard rule: different fixtures
      if (usedFixtures.has(c.fixture_id)) continue;

      // Soft diversity: prefer different leagues
      if (selected.length === 1 && usedLeagues.has(c.league_id)) {
        const diverse = candidates.find(
          (alt) => alt !== c && !usedFixtures.has(alt.fixture_id) && !usedLeagues.has(alt.league_id)
            && alt.daily_signal_score >= c.daily_signal_score * 0.88
        );
        if (diverse) {
          selected.push(diverse);
          usedFixtures.add(diverse.fixture_id);
          usedLeagues.add(diverse.league_id);
          usedMarkets.add(diverse.market);
          continue;
        }
      }

      // Soft diversity: prefer different market types
      if (selected.length === 1 && usedMarkets.has(c.market)) {
        const diverseM = candidates.find(
          (alt) => alt !== c && !usedFixtures.has(alt.fixture_id) && !usedMarkets.has(alt.market)
            && alt.daily_signal_score >= c.daily_signal_score * 0.85
        );
        if (diverseM) {
          selected.push(diverseM);
          usedFixtures.add(diverseM.fixture_id);
          usedLeagues.add(diverseM.league_id);
          usedMarkets.add(diverseM.market);
          continue;
        }
      }

      selected.push(c);
      usedFixtures.add(c.fixture_id);
      usedLeagues.add(c.league_id);
      usedMarkets.add(c.market);
    }

    console.log(`[daily-signals] Selected ${selected.length} signals`);

    // ── Step 10: Build metadata ─────────────────────────────────────────
    const selectionReasoning = selected.map((s, i) => ({
      rank: i + 1,
      fixture: `${s.home_team} vs ${s.away_team}`,
      league: s.league_name,
      market: `${s.market} ${s.side} ${s.line}`,
      score: s.daily_signal_score,
      hit_rate: `${(s.hit_rate * 100).toFixed(1)}%`,
      sample: s.sample_size,
      trend: s.trend_label,
      odds_band: s.odds_band,
      reason: s.supporting_reason,
    }));

    const whyRejected = rejected.slice(0, 20).map(r => ({
      fixture_id: r.fixture_id,
      league: r.league,
      market: r.market,
      line: r.line,
      reason: r.reason,
    }));

    // ── Step 11: Persist ─────────────────────────────────────────────────
    const computedAt = new Date().toISOString();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    await supabase
      .from("daily_safest_insights")
      .delete()
      .gte("computed_at", todayStart.toISOString());

    if (selected.length > 0) {
      const rows = selected.map((s) => ({
        fixture_id: s.fixture_id,
        league_id: s.league_id,
        league_name: s.league_name,
        home_team: s.home_team,
        away_team: s.away_team,
        market: s.market,
        side: s.side,
        line: s.line,
        confidence_tier: s.confidence_tier,
        daily_safety_score: s.daily_signal_score,
        historical_hit_rate: s.hit_rate,
        sample_size: s.sample_size,
        supporting_reason: s.supporting_reason,
        freshness_status: s.freshness_status,
        warning_flags: s.warning_flags,
        odds: s.odds,
        kickoff_at: s.kickoff_at,
        computed_at: computedAt,
        generation_metadata: {
          candidates_evaluated: candidates.length,
          rejected_count: rejected.length,
          selection_reasoning: selectionReasoning,
          why_rejected: whyRejected,
          fallback_used: false,
          trend_label: s.trend_label,
          odds_band: s.odds_band,
          pw_hit_rate: s.pw_hit_rate,
          pw_sample: s.pw_sample,
          duration_ms: Date.now() - startTime,
        },
      }));

      const { error: insertError } = await supabase
        .from("daily_safest_insights")
        .insert(rows);

      if (insertError) {
        console.error("[daily-signals] Insert error:", insertError);
        return errorResponse("Failed to persist signals", origin, 500, req);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[daily-signals] ✅ Complete in ${duration}ms: ${selected.length} signals`);

    return jsonResponse(
      {
        signals: selected.map((s) => ({
          fixture: `${s.home_team} vs ${s.away_team}`,
          league: s.league_name,
          market: s.market,
          side: s.side,
          line: s.line,
          odds_band: s.odds_band,
          confidence_tier: s.confidence_tier,
          daily_signal_score: s.daily_signal_score,
          historical_hit_rate: `${(s.hit_rate * 100).toFixed(1)}%`,
          sample_size: s.sample_size,
          trend_label: s.trend_label,
          freshness_status: s.freshness_status,
          warning_flags: s.warning_flags,
          supporting_reason: s.supporting_reason,
          odds: s.odds,
          kickoff_at: s.kickoff_at,
        })),
        why_selected: selectionReasoning,
        why_rejected: whyRejected,
        candidates_evaluated: candidates.length,
        rejected_count: rejected.length,
        fallback_used: false,
        generated_at: computedAt,
        duration_ms: duration,
      },
      origin, 200, req
    );
  } catch (err) {
    console.error("[daily-signals] Unhandled error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, origin, 500, req);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function buildSupportingReason(
  bucket: any,
  hitRate: number,
  homeSample: number,
  awaySample: number,
  leagueName: string,
  trend: string,
  pwHR: number | null,
  pwSample: number | null
): string {
  const mLabel = bucket.market === "goals" ? "Goals" : bucket.market === "corners" ? "Corners" : bucket.market;
  const lineLabel = `${bucket.side === "over" ? "Over" : "Under"} ${bucket.line_norm}`;
  const hitPct = (hitRate * 100).toFixed(1);

  let reason =
    `${mLabel} ${lineLabel} in ${leagueName} has achieved a ${hitPct}% historical hit rate ` +
    `across ${bucket.sample_size} matches (ROI: ${bucket.roi_pct.toFixed(1)}%). `;

  if (pwHR !== null && pwSample) {
    reason += `Recent performance-weighted data (${pwSample} samples) shows a ${(pwHR * 100).toFixed(1)}% rate, `;
    reason += `indicating a ${trend} trend. `;
  }

  reason += `Both teams have sufficient recent data (${homeSample} and ${awaySample} matches).`;

  return reason;
}
