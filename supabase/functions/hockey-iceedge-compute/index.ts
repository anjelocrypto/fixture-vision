/**
 * hockey-iceedge-compute
 *
 * Precomputes IceEdge projections for upcoming hockey games.
 * Populates hockey_iceedge_cache (upsert by game_id).
 * Cleans stale rows (games already started or outside window).
 *
 * ═══════════════════════════════════════════════════════════════════
 * FORMULA DOCUMENTATION (v1 — limited data)
 * ═══════════════════════════════════════════════════════════════════
 *
 * AVAILABLE inputs from hockey_team_stats_cache:
 *   gp, gpg, ga_pg, p1_gpg, p1_gapg, ot_pct, last5_gpg, last5_gapg
 *
 * NOT AVAILABLE (v1 simplifications):
 *   - pp_pct, pk_pct → excluded from formulas (would need game-detail API)
 *   - sog_pg, sa_pg  → excluded
 *   - wins/losses/otw/otl → no win-streak factor
 *   - home/away splits → not in schema; use overall averages
 *
 * ─── projected_total ───────────────────────────────────────────────
 *   Base: (home.gpg + away.ga_pg + away.gpg + home.ga_pg) / 2
 *   H2H adjustment: if H2H exists with gp >= 2,
 *     projected = 0.7 * base + 0.3 * h2h.avg_total_goals
 *   Recency: blend = 0.6 * season_proj + 0.4 * last5_proj
 *     where last5_proj = (home.last5_gpg + away.last5_gapg +
 *                         away.last5_gpg + home.last5_gapg) / 2
 *
 * ─── ot_risk ───────────────────────────────────────────────────────
 *   avg of: home.ot_pct, away.ot_pct, h2h.ot_pct (if available)
 *   Scaled 0-1 (input is already percentage, divide by 100)
 *
 * ─── p1_heat ───────────────────────────────────────────────────────
 *   (home.p1_gpg + away.p1_gpg + home.p1_gapg + away.p1_gapg) / 2
 *   Normalized: min(p1_raw / 2.5, 1.0) where 2.5 goals in P1 = max heat
 *
 * ─── chaos_score ───────────────────────────────────────────────────
 *   Measures unpredictability. Higher when:
 *   - Teams score similarly (close gpg)
 *   - High OT rate
 *   - Divergence between season and last5 form
 *   Formula:
 *     closeness = 1 - min(|home.gpg - away.gpg| / 2, 1)
 *     formShift = min((|home.last5_gpg - home.gpg| + |away.last5_gpg - away.gpg|) / 2, 1)
 *     chaos = 0.4 * closeness + 0.3 * ot_risk + 0.3 * formShift
 *
 * ─── value_score ───────────────────────────────────────────────────
 *   Compares projected_total to best available total line from odds.
 *   If odds exist for "total" market:
 *     edge = |projected_total - best_line| / best_line
 *     value_score = min(edge * 10, 1.0)
 *   If no odds: value_score = 0
 *
 * ─── regulation_lean ───────────────────────────────────────────────
 *   Compare home.gpg vs away.gpg (simplified — no home/away split available)
 *   diff = home.gpg - away.gpg
 *   if diff > 0.4: "home"
 *   if diff < -0.4: "away"
 *   else: "toss-up"
 *
 * ─── confidence_tier ───────────────────────────────────────────────
 *   Based on data quality:
 *   minGP = min(home.gp, away.gp)
 *   if minGP >= 15: "high"
 *   if minGP >= 5:  "medium"
 *   else:           "low"
 *
 * ─── iceedge_rank ──────────────────────────────────────────────────
 *   Composite: 0.35*value_score + 0.25*chaos_score + 0.20*p1_heat + 0.20*ot_risk
 *   Sorted descending, rank = 1..N
 *
 * ─── recommended_markets ───────────────────────────────────────────
 *   Only includes markets that exist in hockey_odds_cache for this game.
 *   Logic:
 *   - If projected_total differs from line by >0.3: add total over/under
 *   - If p1_heat > 0.5: add p1_total if available
 *   - If ot_risk < 0.15 and lean != "toss-up": add reg_winner
 *   - Always add match_winner if available
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-key",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[hockey-iceedge-compute] ===== START =====");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── Auth ──────────────────────────────────────────────────────────────
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    let isAuthorized = authHeader === `Bearer ${serviceRoleKey}`;
    if (!isAuthorized && cronKeyHeader) {
      const { data: dbKey } = await supabase.rpc("get_cron_internal_key");
      if (cronKeyHeader === dbKey) isAuthorized = true;
    }
    if (!isAuthorized && authHeader) {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (anonKey) {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: isWhitelisted } = await userClient.rpc("is_user_whitelisted");
        if (isWhitelisted) isAuthorized = true;
      }
    }
    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Params ────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const windowHours = body.window_hours ?? 48;

    const now = new Date();
    const cutoff = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

    // ── Get upcoming games ────────────────────────────────────────────────
    const { data: upcoming, error: upErr } = await supabase
      .from("hockey_games")
      .select("id, league_id, season, home_team_id, away_team_id, puck_drop")
      .eq("status", "NS")
      .gte("puck_drop", now.toISOString())
      .lte("puck_drop", cutoff.toISOString())
      .order("puck_drop", { ascending: true })
      .limit(100);

    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Also allow historical override for testing
    const overrideGameIds: number[] | null = body.game_ids ?? null;
    let games = upcoming ?? [];

    if (overrideGameIds && overrideGameIds.length > 0) {
      const { data: overrideGames } = await supabase
        .from("hockey_games")
        .select("id, league_id, season, home_team_id, away_team_id, puck_drop")
        .in("id", overrideGameIds);
      games = overrideGames ?? [];
    }

    console.log(`[hockey-iceedge-compute] ${games.length} games to compute`);

    if (games.length === 0) {
      // Still clean stale
      await cleanStale(supabase, now);
      return new Response(
        JSON.stringify({ success: true, computed: 0, message: "No upcoming games" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Load all team stats we need ───────────────────────────────────────
    const teamIds = [...new Set(games.flatMap((g: any) => [g.home_team_id, g.away_team_id]))];
    const { data: allStats } = await supabase
      .from("hockey_team_stats_cache")
      .select("team_id, league_id, season, gp, gpg, ga_pg, p1_gpg, p1_gapg, ot_pct, last5_gpg, last5_gapg")
      .in("team_id", teamIds)
      .order("season", { ascending: false });

    // Index by exact key AND by team:league (latest season fallback)
    const statsMap = new Map<string, any>();
    const statsLatestMap = new Map<string, any>();
    for (const s of (allStats ?? [])) {
      statsMap.set(`${s.team_id}:${s.league_id}:${s.season}`, s);
      const latestKey = `${s.team_id}:${s.league_id}`;
      if (!statsLatestMap.has(latestKey)) {
        statsLatestMap.set(latestKey, s); // first = highest season due to order
      }
    }

    // ── Load H2H cache ───────────────────────────────────────────────────
    const h2hPairs = games.map((g: any) => {
      const lo = Math.min(g.home_team_id, g.away_team_id);
      const hi = Math.max(g.home_team_id, g.away_team_id);
      return { lo, hi };
    });

    const { data: allH2H } = await supabase
      .from("hockey_h2h_cache")
      .select("team_lo, team_hi, gp, avg_total_goals, ot_pct");

    const h2hMap = new Map<string, any>();
    for (const h of (allH2H ?? [])) {
      h2hMap.set(`${h.team_lo}:${h.team_hi}`, h);
    }

    // ── Load odds for these games ─────────────────────────────────────────
    const gameIds = games.map((g: any) => g.id);
    const { data: allOdds } = await supabase
      .from("hockey_odds_cache")
      .select("game_id, market, selection, line, odds")
      .in("game_id", gameIds);

    // Index odds by game_id
    const oddsMap = new Map<number, any[]>();
    for (const o of (allOdds ?? [])) {
      if (!oddsMap.has(o.game_id)) oddsMap.set(o.game_id, []);
      oddsMap.get(o.game_id)!.push(o);
    }

    // ── Compute IceEdge for each game ─────────────────────────────────────
    interface IceEdgeRow {
      game_id: number;
      league_id: number;
      season: number;
      home_team_id: number;
      away_team_id: number;
      puck_drop: string;
      projected_total: number;
      value_score: number;
      chaos_score: number;
      ot_risk: number;
      p1_heat: number;
      regulation_lean: string;
      confidence_tier: string;
      recommended_markets: any[];
      reasoning: string;
      composite: number; // for ranking
    }

    const rows: IceEdgeRow[] = [];
    const skipped: string[] = [];

    for (const g of games) {
      const homeKey = `${g.home_team_id}:${g.league_id}:${g.season}`;
      const awayKey = `${g.away_team_id}:${g.league_id}:${g.season}`;
      const homeFallbackKey = `${g.home_team_id}:${g.league_id}`;
      const awayFallbackKey = `${g.away_team_id}:${g.league_id}`;
      const home = statsMap.get(homeKey) ?? statsLatestMap.get(homeFallbackKey);
      const away = statsMap.get(awayKey) ?? statsLatestMap.get(awayFallbackKey);

      if (!home || !away) {
        skipped.push(`Game ${g.id}: missing stats (home=${!!home}, away=${!!away})`);
        continue;
      }

      // ── projected_total ──────────────────────────────────────────────
      const seasonProj = (home.gpg + away.ga_pg + away.gpg + home.ga_pg) / 2;
      const last5Proj = (home.last5_gpg + away.last5_gapg + away.last5_gpg + home.last5_gapg) / 2;
      let projectedTotal = 0.6 * seasonProj + 0.4 * last5Proj;

      // H2H blend
      const lo = Math.min(g.home_team_id, g.away_team_id);
      const hi = Math.max(g.home_team_id, g.away_team_id);
      const h2h = h2hMap.get(`${lo}:${hi}`);
      if (h2h && h2h.gp >= 2) {
        projectedTotal = 0.7 * projectedTotal + 0.3 * h2h.avg_total_goals;
      }
      projectedTotal = Number(projectedTotal.toFixed(2));

      // ── ot_risk ──────────────────────────────────────────────────────
      const otInputs = [home.ot_pct / 100, away.ot_pct / 100];
      if (h2h && h2h.gp >= 2) otInputs.push(h2h.ot_pct / 100);
      const otRisk = Number((otInputs.reduce((a: number, b: number) => a + b, 0) / otInputs.length).toFixed(3));

      // ── p1_heat ──────────────────────────────────────────────────────
      const p1Raw = (home.p1_gpg + away.p1_gpg + home.p1_gapg + away.p1_gapg) / 2;
      const p1Heat = Number(Math.min(p1Raw / 2.5, 1.0).toFixed(3));

      // ── chaos_score ──────────────────────────────────────────────────
      const closeness = 1 - Math.min(Math.abs(home.gpg - away.gpg) / 2, 1);
      const formShift = Math.min(
        (Math.abs(home.last5_gpg - home.gpg) + Math.abs(away.last5_gpg - away.gpg)) / 2,
        1
      );
      const chaosScore = Number((0.4 * closeness + 0.3 * otRisk + 0.3 * formShift).toFixed(3));

      // ── value_score ──────────────────────────────────────────────────
      const gameOdds = oddsMap.get(g.id) ?? [];
      const totalOdds = gameOdds.filter((o: any) => o.market === "total");
      let valueScore = 0;
      let bestLine: number | null = null;

      if (totalOdds.length > 0) {
        // Find the most common line
        const lineCounts = new Map<number, number>();
        for (const o of totalOdds) {
          lineCounts.set(o.line, (lineCounts.get(o.line) ?? 0) + 1);
        }
        bestLine = [...lineCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        const edge = Math.abs(projectedTotal - bestLine) / (bestLine || 1);
        valueScore = Number(Math.min(edge * 10, 1.0).toFixed(3));
      }

      // ── regulation_lean ──────────────────────────────────────────────
      const gpgDiff = home.gpg - away.gpg;
      let regulationLean = "toss-up";
      if (gpgDiff > 0.4) regulationLean = "home";
      else if (gpgDiff < -0.4) regulationLean = "away";

      // ── confidence_tier ──────────────────────────────────────────────
      const minGP = Math.min(home.gp, away.gp);
      let confidenceTier = "low";
      if (minGP >= 15) confidenceTier = "high";
      else if (minGP >= 5) confidenceTier = "medium";

      // ── recommended_markets ──────────────────────────────────────────
      const availableMarkets = new Set(gameOdds.map((o: any) => o.market));
      const recommended: any[] = [];

      if (bestLine !== null && Math.abs(projectedTotal - bestLine) > 0.3) {
        const side = projectedTotal > bestLine ? "over" : "under";
        if (availableMarkets.has("total")) {
          recommended.push({ market: "total", side, line: bestLine, reason: `Projected ${projectedTotal} vs line ${bestLine}` });
        }
      }
      if (p1Heat > 0.5 && availableMarkets.has("p1_total")) {
        recommended.push({ market: "p1_total", side: "over", reason: `P1 heat ${p1Heat}` });
      }
      if (otRisk < 0.15 && regulationLean !== "toss-up" && availableMarkets.has("reg_winner")) {
        recommended.push({ market: "reg_winner", side: regulationLean, reason: `Low OT risk, lean ${regulationLean}` });
      }
      if (availableMarkets.has("match_winner")) {
        recommended.push({ market: "match_winner", side: regulationLean !== "toss-up" ? regulationLean : "home", reason: "Match winner available" });
      }

      // ── composite (for ranking) ──────────────────────────────────────
      const composite = Number((0.35 * valueScore + 0.25 * chaosScore + 0.20 * p1Heat + 0.20 * otRisk).toFixed(4));

      // ── reasoning ────────────────────────────────────────────────────
      const reasons: string[] = [];
      reasons.push(`Proj total ${projectedTotal} (season ${seasonProj.toFixed(1)}, L5 ${last5Proj.toFixed(1)}${h2h ? `, H2H ${h2h.avg_total_goals}` : ""})`);
      reasons.push(`GP: home ${home.gp}, away ${away.gp}`);
      if (bestLine !== null) reasons.push(`Best total line: ${bestLine}`);
      reasons.push(`OT risk: ${(otRisk * 100).toFixed(0)}%`);

      rows.push({
        game_id: g.id,
        league_id: g.league_id,
        season: g.season,
        home_team_id: g.home_team_id,
        away_team_id: g.away_team_id,
        puck_drop: g.puck_drop,
        projected_total: projectedTotal,
        value_score: valueScore,
        chaos_score: chaosScore,
        ot_risk: otRisk,
        p1_heat: p1Heat,
        regulation_lean: regulationLean,
        confidence_tier: confidenceTier,
        recommended_markets: recommended,
        reasoning: reasons.join("; "),
        composite,
      });
    }

    // ── Assign iceedge_rank ───────────────────────────────────────────────
    rows.sort((a, b) => b.composite - a.composite);
    rows.forEach((r, i) => { (r as any).iceedge_rank = i + 1; });

    // ── Upsert ────────────────────────────────────────────────────────────
    let upserted = 0;
    const errors: string[] = [];

    for (const r of rows) {
      const { composite, ...dbRow } = r as any;
      const { error } = await supabase
        .from("hockey_iceedge_cache")
        .upsert(dbRow, { onConflict: "game_id" });

      if (error) {
        errors.push(`Game ${r.game_id}: ${error.message}`);
      } else {
        upserted++;
      }
    }

    // ── Clean stale rows ──────────────────────────────────────────────────
    const staleDeleted = await cleanStale(supabase, now);

    const elapsed = Date.now() - startTime;
    console.log(`[hockey-iceedge-compute] ═══ COMPLETE ═══ computed=${upserted} skipped=${skipped.length} stale_deleted=${staleDeleted} elapsed=${elapsed}ms`);

    await supabase.from("pipeline_run_logs").insert({
      job_name: "hockey-iceedge-compute",
      run_started: new Date(startTime).toISOString(),
      run_finished: new Date().toISOString(),
      success: errors.length === 0,
      mode: "cron",
      processed: upserted,
      failed: errors.length,
      details: {
        games_input: games.length,
        computed: upserted,
        skipped: skipped.slice(0, 20),
        stale_deleted: staleDeleted,
        errors: errors.slice(0, 20),
        elapsed_ms: elapsed,
        formula_version: "v1-limited",
        simplifications: [
          "No home/away splits (not in schema)",
          "No pp_pct/pk_pct/sog_pg/sa_pg (set to 0 in stats)",
          "No wins/losses/streak factors (not in schema)",
          "regulation_lean uses overall gpg diff only (no venue adjustment)",
        ],
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        computed: upserted,
        skipped: skipped.length,
        stale_deleted: staleDeleted,
        elapsed_ms: elapsed,
        sample: rows.slice(0, 5).map(r => ({
          game_id: r.game_id,
          projected_total: r.projected_total,
          value_score: r.value_score,
          chaos_score: r.chaos_score,
          ot_risk: r.ot_risk,
          p1_heat: r.p1_heat,
          iceedge_rank: (r as any).iceedge_rank,
          confidence_tier: r.confidence_tier,
          recommended_markets: r.recommended_markets,
          regulation_lean: r.regulation_lean,
        })),
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
        skipped_details: skipped.length > 0 ? skipped.slice(0, 10) : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[hockey-iceedge-compute] FATAL:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function cleanStale(supabase: any, now: Date): Promise<number> {
  // Delete rows for games that have already started (puck_drop < now)
  const { data, error } = await supabase
    .from("hockey_iceedge_cache")
    .delete()
    .lt("puck_drop", now.toISOString())
    .select("game_id");

  if (error) {
    console.error("[hockey-iceedge-compute] Stale cleanup error:", error.message);
    return 0;
  }
  const count = data?.length ?? 0;
  if (count > 0) console.log(`[hockey-iceedge-compute] Cleaned ${count} stale rows`);
  return count;
}
