// ============================================================================
// Daily Safest Insights Edge Function
// ============================================================================
// Computes the 2 strongest, lowest-volatility sports insights daily using
// green bucket performance, team stats, odds freshness, and composite scoring.
//
// Scoring: daily_safety_score = weighted combination of:
//   - historical hit rate (30%)
//   - sample size confidence (20%)
//   - league reliability (15%)
//   - market stability (10%)
//   - recent team-form alignment (10%)
//   - freshness of stats (5%)
//   - freshness of odds (5%)
//   - penalty adjustments (suspicious lines, injuries, stale data)
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Configuration ──────────────────────────────────────────────────────────

const MAX_INSIGHTS = 2;
const WINDOW_HOURS = 24;

// Minimum quality thresholds (strict)
const MIN_HIT_RATE = 0.65;
const MIN_SAMPLE_SIZE = 50;
const MIN_ROI = -2;
const MAX_ODDS = 3.50;
const MIN_ODDS = 1.20;
const STATS_FRESHNESS_HOURS = 48;
const ODDS_FRESHNESS_HOURS = 6;

// Scoring weights
const W_HIT_RATE = 0.30;
const W_SAMPLE = 0.20;
const W_LEAGUE = 0.15;
const W_MARKET_STABILITY = 0.10;
const W_FORM = 0.10;
const W_STATS_FRESH = 0.05;
const W_ODDS_FRESH = 0.05;
const W_ROI = 0.05;

// Top-tier leagues (most reliable data)
const TOP_LEAGUES = new Set([
  39, 140, 135, 78, 61,   // Big 5
  40, 136, 79, 88, 94,    // Strong secondary
  2, 3, 848,              // Champions League, Europa League, Conference
]);
const MID_LEAGUES = new Set([
  203, 207, 144, 253, 262, 179, 113, 188, 218, 235, 119,
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
  kickoff_at: string;
  // Green bucket data
  hit_rate: number;
  sample_size: number;
  roi_pct: number;
  // Stats freshness
  stats_computed_at: string | null;
  home_sample_size: number;
  away_sample_size: number;
  // Odds freshness
  odds_captured_at: string | null;
  // Scoring
  daily_safety_score: number;
  confidence_tier: string;
  freshness_status: string;
  warning_flags: string[];
  supporting_reason: string;
  rejection_reason?: string;
}

// ── Scoring helpers ────────────────────────────────────────────────────────

function scoreHitRate(hitRate: number): number {
  // 65% = 0, 80% = 0.75, 90%+ = 1.0
  return Math.min(1, Math.max(0, (hitRate - 0.65) / 0.25));
}

function scoreSample(size: number): number {
  // 50 = 0.3, 100 = 0.6, 200+ = 1.0
  if (size >= 200) return 1.0;
  if (size >= 100) return 0.6 + (size - 100) / 250;
  return 0.3 + (size - 50) * 0.006;
}

function scoreLeague(leagueId: number): number {
  if (TOP_LEAGUES.has(leagueId)) return 1.0;
  if (MID_LEAGUES.has(leagueId)) return 0.6;
  return 0.3;
}

function scoreMarketStability(market: string): number {
  // Goals markets are most stable historically
  if (market === "goals") return 1.0;
  if (market === "corners") return 0.7;
  return 0.4;
}

function scoreStatsFreshness(computedAt: string | null): number {
  if (!computedAt) return 0;
  const ageHours = (Date.now() - new Date(computedAt).getTime()) / 3600000;
  if (ageHours <= 12) return 1.0;
  if (ageHours <= 24) return 0.8;
  if (ageHours <= STATS_FRESHNESS_HOURS) return 0.5;
  return 0;
}

function scoreOddsFreshness(capturedAt: string | null): number {
  if (!capturedAt) return 0;
  const ageHours = (Date.now() - new Date(capturedAt).getTime()) / 3600000;
  if (ageHours <= 2) return 1.0;
  if (ageHours <= 4) return 0.8;
  if (ageHours <= ODDS_FRESHNESS_HOURS) return 0.5;
  return 0;
}

function scoreROI(roi: number): number {
  if (roi >= 10) return 1.0;
  if (roi >= 5) return 0.8;
  if (roi >= 0) return 0.6;
  if (roi >= -2) return 0.3;
  return 0;
}

function scoreTeamForm(homeSample: number, awaySample: number): number {
  // Both teams need sufficient recent data
  const minSample = Math.min(homeSample, awaySample);
  if (minSample >= 10) return 1.0;
  if (minSample >= 5) return 0.6;
  if (minSample >= 3) return 0.3;
  return 0;
}

function getConfidenceTier(score: number): string {
  if (score >= 0.75) return "very_high";
  if (score >= 0.60) return "high";
  if (score >= 0.45) return "moderate";
  return "insufficient";
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

    // Auth: cron/admin/service-role only for generation; GET for read
    if (req.method === "GET") {
      // Public read - return cached insights for today
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const { data: cached, error } = await supabase
        .from("daily_safest_insights")
        .select("*")
        .gte("computed_at", todayStart.toISOString())
        .order("daily_safety_score", { ascending: false })
        .limit(MAX_INSIGHTS);

      if (error) {
        console.error("[daily-insights] Read error:", error);
        return errorResponse("Failed to read insights", origin, 500, req);
      }

      return jsonResponse({ insights: cached || [], generated_at: cached?.[0]?.computed_at || null }, origin, 200, req);
    }

    // POST = generate new insights (admin/cron only)
    const authResult = await checkCronOrAdminAuth(req, supabase, SUPABASE_SERVICE_ROLE_KEY, "[daily-insights]");
    if (!authResult.authorized) {
      return errorResponse("Unauthorized", origin, 401, req);
    }

    console.log("[daily-insights] ═══════════════════════════════════════════");
    console.log("[daily-insights] 🔍 Starting Daily Safest Insights generation");

    // ── Step 1: Get upcoming fixtures (next 24h) ─────────────────────────
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
      console.error("[daily-insights] Fixtures error:", fxError);
      return errorResponse("Failed to fetch fixtures", origin, 500, req);
    }

    console.log(`[daily-insights] Found ${fixtures?.length || 0} fixtures in next ${WINDOW_HOURS}h`);

    if (!fixtures || fixtures.length === 0) {
      return jsonResponse({
        insights: [],
        candidates_evaluated: 0,
        rejected: [],
        fallback_used: false,
        reason: "No upcoming fixtures in window",
        duration_ms: Date.now() - startTime,
      }, origin, 200, req);
    }

    // ── Step 2: Get green buckets (proven historical performance) ─────────
    const fixtureLeagueIds = [...new Set(fixtures.map((f: any) => f.league_id))];

    const { data: greenBuckets, error: gbError } = await supabase
      .from("green_buckets")
      .select("*")
      .in("league_id", fixtureLeagueIds)
      .gte("hit_rate_pct", MIN_HIT_RATE * 100)
      .gte("sample_size", MIN_SAMPLE_SIZE)
      .gte("roi_pct", MIN_ROI);

    if (gbError) {
      console.error("[daily-insights] Green buckets error:", gbError);
      return errorResponse("Failed to fetch green buckets", origin, 500, req);
    }

    console.log(`[daily-insights] Found ${greenBuckets?.length || 0} qualifying green buckets`);

    if (!greenBuckets || greenBuckets.length === 0) {
      return jsonResponse({
        insights: [],
        candidates_evaluated: 0,
        rejected: [{ reason: "No green buckets meeting quality thresholds" }],
        fallback_used: false,
        duration_ms: Date.now() - startTime,
      }, origin, 200, req);
    }

    // Build bucket lookup: league_id -> buckets
    const bucketsByLeague = new Map<number, any[]>();
    for (const gb of greenBuckets) {
      const arr = bucketsByLeague.get(gb.league_id) || [];
      arr.push(gb);
      bucketsByLeague.set(gb.league_id, arr);
    }

    // ── Step 3: Get league names ─────────────────────────────────────────
    const { data: leaguesData } = await supabase
      .from("leagues")
      .select("id, name")
      .in("id", fixtureLeagueIds);

    const leagueNames = new Map<number, string>();
    for (const l of leaguesData || []) {
      leagueNames.set(l.id, l.name);
    }

    // ── Step 4: Get stats freshness for relevant teams ───────────────────
    const teamIds = new Set<number>();
    for (const fx of fixtures) {
      const homeId = fx.teams_home?.id;
      const awayId = fx.teams_away?.id;
      if (homeId) teamIds.add(Number(homeId));
      if (awayId) teamIds.add(Number(awayId));
    }

    const { data: statsCache } = await supabase
      .from("stats_cache")
      .select("team_id, computed_at, sample_size")
      .in("team_id", Array.from(teamIds));

    const statsByTeam = new Map<number, { computed_at: string | null; sample_size: number }>();
    for (const s of statsCache || []) {
      statsByTeam.set(s.team_id, { computed_at: s.computed_at, sample_size: s.sample_size });
    }

    // ── Step 5: Get odds freshness for relevant fixtures ─────────────────
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

    // ── Step 6: Get optimized selections for odds values ─────────────────
    const { data: selections } = await supabase
      .from("optimized_selections")
      .select("fixture_id, market, side, line, odds, computed_at")
      .in("fixture_id", fixtureIds);

    // Build selection lookup: `${fixture_id}-${market}-${side}-${line}` -> selection
    const selectionLookup = new Map<string, any>();
    for (const sel of selections || []) {
      const key = `${sel.fixture_id}-${sel.market}-${sel.side}-${sel.line}`;
      selectionLookup.set(key, sel);
    }

    // ── Step 7: Score all candidates ─────────────────────────────────────
    const candidates: Candidate[] = [];
    const rejected: Array<{ fixture_id: number; market: string; line: number; reason: string }> = [];

    for (const fx of fixtures) {
      const homeId = Number(fx.teams_home?.id);
      const awayId = Number(fx.teams_away?.id);
      const leagueBuckets = bucketsByLeague.get(fx.league_id) || [];

      if (leagueBuckets.length === 0) {
        rejected.push({
          fixture_id: fx.id,
          market: "*",
          line: 0,
          reason: "No green buckets for this league",
        });
        continue;
      }

      const homeStats = statsByTeam.get(homeId);
      const awayStats = statsByTeam.get(awayId);
      const oddsTimestamp = oddsByFixture.get(fx.id);

      for (const bucket of leagueBuckets) {
        const selKey = `${fx.id}-${bucket.market}-${bucket.side}-${bucket.line_norm}`;
        const sel = selectionLookup.get(selKey);
        const odds = sel?.odds ?? null;
        const selComputedAt = sel?.computed_at ?? null;

        const warnings: string[] = [];

        // ── Freshness gates ──────────────────────────────────────────
        const statsAge = homeStats?.computed_at
          ? (Date.now() - new Date(homeStats.computed_at).getTime()) / 3600000
          : Infinity;

        if (statsAge > STATS_FRESHNESS_HOURS) {
          rejected.push({
            fixture_id: fx.id,
            market: bucket.market,
            line: bucket.line_norm,
            reason: `Stats stale: ${Math.round(statsAge)}h old (max ${STATS_FRESHNESS_HOURS}h)`,
          });
          continue;
        }

        const oddsAge = oddsTimestamp
          ? (Date.now() - new Date(oddsTimestamp).getTime()) / 3600000
          : Infinity;

        if (oddsAge > ODDS_FRESHNESS_HOURS) {
          warnings.push(`odds_age_${Math.round(oddsAge)}h`);
        }

        // ── Odds range check ─────────────────────────────────────────
        if (odds !== null && (odds < MIN_ODDS || odds > MAX_ODDS)) {
          rejected.push({
            fixture_id: fx.id,
            market: bucket.market,
            line: bucket.line_norm,
            reason: `Odds ${odds} outside safe range [${MIN_ODDS}-${MAX_ODDS}]`,
          });
          continue;
        }

        // ── Team data quality ────────────────────────────────────────
        const homeSample = homeStats?.sample_size ?? 0;
        const awaySample = awayStats?.sample_size ?? 0;

        if (homeSample < 3 || awaySample < 3) {
          rejected.push({
            fixture_id: fx.id,
            market: bucket.market,
            line: bucket.line_norm,
            reason: `Insufficient team data: home=${homeSample}, away=${awaySample}`,
          });
          continue;
        }

        // ── Compute composite score ──────────────────────────────────
        const hitRate = bucket.hit_rate_pct / 100;
        const sHitRate = scoreHitRate(hitRate);
        const sSample = scoreSample(bucket.sample_size);
        const sLeague = scoreLeague(fx.league_id);
        const sMarket = scoreMarketStability(bucket.market);
        const sForm = scoreTeamForm(homeSample, awaySample);
        const sStatsFresh = scoreStatsFreshness(homeStats?.computed_at ?? null);
        const sOddsFresh = scoreOddsFreshness(oddsTimestamp ?? null);
        const sROI = scoreROI(bucket.roi_pct);

        let score =
          sHitRate * W_HIT_RATE +
          sSample * W_SAMPLE +
          sLeague * W_LEAGUE +
          sMarket * W_MARKET_STABILITY +
          sForm * W_FORM +
          sStatsFresh * W_STATS_FRESH +
          sOddsFresh * W_ODDS_FRESH +
          sROI * W_ROI;

        // ── Penalty adjustments ──────────────────────────────────────
        if (oddsAge > ODDS_FRESHNESS_HOURS) {
          score *= 0.85;
          warnings.push("odds_stale");
        }

        if (homeSample < 5 || awaySample < 5) {
          score *= 0.90;
          warnings.push("low_team_sample");
        }

        // Suspicious odds check (very low odds = likely already priced in)
        if (odds !== null && odds < 1.30) {
          score *= 0.80;
          warnings.push("very_low_odds");
        }

        const confidenceTier = getConfidenceTier(score);

        // Reject anything below moderate
        if (confidenceTier === "insufficient") {
          rejected.push({
            fixture_id: fx.id,
            market: bucket.market,
            line: bucket.line_norm,
            reason: `Score ${score.toFixed(3)} below minimum threshold`,
          });
          continue;
        }

        // Build supporting reason
        const reason = buildSupportingReason(
          bucket, fx, hitRate, homeSample, awaySample,
          leagueNames.get(fx.league_id) || "Unknown"
        );

        candidates.push({
          fixture_id: fx.id,
          league_id: fx.league_id,
          league_name: leagueNames.get(fx.league_id) || "Unknown",
          home_team: fx.teams_home?.name || "Unknown",
          away_team: fx.teams_away?.name || "Unknown",
          market: bucket.market,
          side: bucket.side,
          line: bucket.line_norm,
          odds,
          kickoff_at: new Date(fx.timestamp * 1000).toISOString(),
          hit_rate: hitRate,
          sample_size: bucket.sample_size,
          roi_pct: bucket.roi_pct,
          stats_computed_at: homeStats?.computed_at ?? null,
          home_sample_size: homeSample,
          away_sample_size: awaySample,
          odds_captured_at: oddsTimestamp ?? null,
          daily_safety_score: Math.round(score * 1000) / 1000,
          confidence_tier: confidenceTier,
          freshness_status: oddsAge <= ODDS_FRESHNESS_HOURS && statsAge <= STATS_FRESHNESS_HOURS ? "fresh" : "partial",
          warning_flags: warnings,
          supporting_reason: reason,
        });
      }
    }

    console.log(`[daily-insights] Candidates: ${candidates.length}, Rejected: ${rejected.length}`);

    // ── Step 8: Select top 2 diversified insights ────────────────────────
    candidates.sort((a, b) => b.daily_safety_score - a.daily_safety_score);

    const selected: Candidate[] = [];
    const usedFixtures = new Set<number>();
    const usedLeagues = new Set<number>();
    const usedMarkets = new Set<string>();

    for (const c of candidates) {
      if (selected.length >= MAX_INSIGHTS) break;

      // Diversity: different fixtures required
      if (usedFixtures.has(c.fixture_id)) continue;

      // Soft diversity: prefer different leagues (skip if both already same league,
      // unless score is significantly higher)
      if (selected.length === 1 && usedLeagues.has(c.league_id)) {
        // Allow same league only if score is within 5% of the best
        const scoreDiff = (selected[0].daily_safety_score - c.daily_safety_score) / selected[0].daily_safety_score;
        if (scoreDiff < 0.05) {
          // Score is close enough, but prefer diversity
          // Look ahead for a different-league candidate
          const diverseCandidate = candidates.find(
            (alt) =>
              alt !== c &&
              !usedFixtures.has(alt.fixture_id) &&
              !usedLeagues.has(alt.league_id) &&
              alt.daily_safety_score >= c.daily_safety_score * 0.90
          );
          if (diverseCandidate) {
            selected.push(diverseCandidate);
            usedFixtures.add(diverseCandidate.fixture_id);
            usedLeagues.add(diverseCandidate.league_id);
            usedMarkets.add(diverseCandidate.market);
            continue;
          }
        }
      }

      // Soft diversity: prefer different market types
      if (selected.length === 1 && usedMarkets.has(c.market)) {
        const diverseMarket = candidates.find(
          (alt) =>
            alt !== c &&
            !usedFixtures.has(alt.fixture_id) &&
            !usedMarkets.has(alt.market) &&
            alt.daily_safety_score >= c.daily_safety_score * 0.85
        );
        if (diverseMarket) {
          selected.push(diverseMarket);
          usedFixtures.add(diverseMarket.fixture_id);
          usedLeagues.add(diverseMarket.league_id);
          usedMarkets.add(diverseMarket.market);
          continue;
        }
      }

      selected.push(c);
      usedFixtures.add(c.fixture_id);
      usedLeagues.add(c.league_id);
      usedMarkets.add(c.market);
    }

    console.log(`[daily-insights] Selected ${selected.length} insights`);

    // ── Step 9: Build selection reasoning ────────────────────────────────
    const selectionReasoning = selected.map((s, i) => ({
      rank: i + 1,
      fixture: `${s.home_team} vs ${s.away_team}`,
      score: s.daily_safety_score,
      hit_rate: `${(s.hit_rate * 100).toFixed(1)}%`,
      sample: s.sample_size,
      reason: s.supporting_reason,
    }));

    // ── Step 10: Persist to DB ───────────────────────────────────────────
    const computedAt = new Date().toISOString();

    // Clear today's old insights
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
        daily_safety_score: s.daily_safety_score,
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
          top_rejected: rejected.slice(0, 10),
          fallback_used: false,
          duration_ms: Date.now() - startTime,
        },
      }));

      const { error: insertError } = await supabase
        .from("daily_safest_insights")
        .insert(rows);

      if (insertError) {
        console.error("[daily-insights] Insert error:", insertError);
        return errorResponse("Failed to persist insights", origin, 500, req);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[daily-insights] ✅ Complete in ${duration}ms: ${selected.length} insights selected`);

    return jsonResponse(
      {
        insights: selected.map((s) => ({
          fixture: `${s.home_team} vs ${s.away_team}`,
          league: s.league_name,
          market: s.market,
          side: s.side,
          line: s.line,
          confidence_tier: s.confidence_tier,
          daily_safety_score: s.daily_safety_score,
          historical_hit_rate: `${(s.hit_rate * 100).toFixed(1)}%`,
          sample_size: s.sample_size,
          supporting_reason: s.supporting_reason,
          freshness_status: s.freshness_status,
          warning_flags: s.warning_flags,
          odds: s.odds,
          kickoff_at: s.kickoff_at,
        })),
        selection_reasoning: selectionReasoning,
        candidates_evaluated: candidates.length,
        rejected_summary: {
          total: rejected.length,
          top_reasons: summarizeRejections(rejected),
        },
        fallback_used: false,
        generated_at: computedAt,
        duration_ms: duration,
      },
      origin,
      200,
      req
    );
  } catch (err) {
    console.error("[daily-insights] Unhandled error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse(message, origin, 500, req);
  }
});

// ── Helper functions ───────────────────────────────────────────────────────

function buildSupportingReason(
  bucket: any,
  fixture: any,
  hitRate: number,
  homeSample: number,
  awaySample: number,
  leagueName: string
): string {
  const marketLabel = bucket.market === "goals" ? "Goals" : bucket.market === "corners" ? "Corners" : bucket.market;
  const lineLabel = `${bucket.side === "over" ? "Over" : "Under"} ${bucket.line_norm}`;
  const hitPct = (hitRate * 100).toFixed(1);

  return (
    `${marketLabel} ${lineLabel} in ${leagueName} has hit at ${hitPct}% ` +
    `across ${bucket.sample_size} historical matches (ROI: ${bucket.roi_pct.toFixed(1)}%). ` +
    `Both teams have sufficient recent data (${homeSample} and ${awaySample} matches respectively), ` +
    `supporting a consistent pattern in this league and market combination.`
  );
}

function summarizeRejections(
  rejected: Array<{ fixture_id: number; market: string; line: number; reason: string }>
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const r of rejected) {
    const category = r.reason.split(":")[0] || r.reason.substring(0, 30);
    summary[category] = (summary[category] || 0) + 1;
  }
  return summary;
}