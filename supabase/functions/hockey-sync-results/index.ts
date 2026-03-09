/**
 * hockey-sync-results
 *
 * Updates hockey_games rows that are finished but have incomplete result data.
 * Populates:
 *   - home_score
 *   - away_score
 *   - period_scores  (JSONB from game.periods)
 *   - status         (status.short)
 *   - went_to_ot     (derived deterministically from status.short)
 *
 * went_to_ot derivation
 * ─────────────────────
 * We derive went_to_ot ONLY from game.status.short:
 *   "AOT" = After Overtime  → true
 *   "AP"  = After Penalties → true
 *   "AET" = After Extra Time (used in some tournaments) → true
 *   "FT"  = Full Time (regulation) → false
 * We do NOT infer from period count or score differences.
 *
 * Safety rules
 * ─────────────
 * - We only update games whose status in our DB is NOT already a terminal status
 *   (FT, AOT, AP, AET) with valid scores already populated.
 *   This prevents overwriting good data with nulls if provider returns partial data.
 * - We skip any game where the API returns null scores for both teams on a
 *   supposedly finished game (treat as suspicious / data not ready).
 * - All writes are per-game upserts on PK=id, never bulk deletes.
 *
 * Provider: api-sports.io  /hockey endpoint
 * Auth key: API_HOCKEY_KEY
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-key",
};

const HOCKEY_BASE = "https://v1.hockey.api-sports.io";

// Statuses we consider "terminal finished" in the provider API
const PROVIDER_FINISHED = new Set(["FT", "AOT", "AP", "AET"]);

// Terminal statuses we already trust in our DB (won't re-fetch those)
const DB_SETTLED = new Set(["FT", "AOT", "AP", "AET"]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[hockey-sync-results] ===== START =====");

  try {
    const supabaseUrl    = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey         = Deno.env.get("API_HOCKEY_KEY");

    if (!apiKey) {
      console.error("[hockey-sync-results] FATAL: API_HOCKEY_KEY not configured");
      return new Response(
        JSON.stringify({ error: "API_HOCKEY_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── Auth ─────────────────────────────────────────────────────────────────
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader    = req.headers.get("authorization");
    let isAuthorized    = authHeader === `Bearer ${serviceRoleKey}`;

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

    // ── Request params ────────────────────────────────────────────────────────
    const body       = await req.json().catch(() => ({}));
    const batchLimit = body.limit ?? 50;

    // ── Find games that need results ──────────────────────────────────────────
    // Candidates:
    //  1. Games where puck_drop is in the past
    //  2. Status is NOT a settled terminal status (so we haven't processed them)
    //     OR status IS terminal but home_score IS NULL (partial write guard)
    // We cap the batch to avoid API budget burn.
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago

    const { data: candidates, error: queryErr } = await supabase
      .from("hockey_games")
      .select("id, league_id, season, status, home_score, away_score, puck_drop")
      .lt("puck_drop", cutoff)
      .or("status.not.in.(FT,AOT,AP,AET),home_score.is.null")
      .order("puck_drop", { ascending: false })
      .limit(batchLimit);

    if (queryErr) {
      console.error("[hockey-sync-results] DB query error:", queryErr.message);
      return new Response(
        JSON.stringify({ error: queryErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(
      `[hockey-sync-results] Found ${candidates?.length ?? 0} candidate games to check`
    );

    let processed  = 0;
    let skipped    = 0;
    let failed     = 0;
    let apiCalls   = 0;
    const errors: string[] = [];

    for (const dbGame of (candidates ?? [])) {
      try {
        // ── Fetch single game from API ────────────────────────────────────────
        const url = `${HOCKEY_BASE}/games?id=${dbGame.id}`;
        const response = await fetch(url, {
          headers: { "x-apisports-key": apiKey },
        });
        apiCalls++;

        if (!response.ok) {
          errors.push(`API ${response.status} for game ${dbGame.id}`);
          console.error(
            `[hockey-sync-results] API error ${response.status} for game ${dbGame.id}`
          );
          failed++;
          continue;
        }

        const json    = await response.json();
        const results = json.response ?? [];

        if (!Array.isArray(results) || results.length === 0) {
          // Provider returned no data – game may not be finished yet
          console.log(`[hockey-sync-results] No API data for game ${dbGame.id}, skipping`);
          skipped++;
          continue;
        }

        const game = results[0];

        // ── Status from provider ──────────────────────────────────────────────
        const providerStatus: string = game.status?.short ?? "NS";

        if (!PROVIDER_FINISHED.has(providerStatus)) {
          // Not finished yet according to provider → skip, will be picked up later
          console.log(
            `[hockey-sync-results] Game ${dbGame.id} not finished (${providerStatus}), skipping`
          );
          skipped++;
          continue;
        }

        // ── Scores ────────────────────────────────────────────────────────────
        const homeScore: number | null = game.scores?.home ?? null;
        const awayScore: number | null = game.scores?.away ?? null;

        // Safety: if provider returns null scores for a "finished" game,
        // do NOT overwrite existing good data with nulls.
        if (homeScore === null && awayScore === null) {
          // Check if we already have scores
          if (dbGame.home_score !== null || dbGame.away_score !== null) {
            console.warn(
              `[hockey-sync-results] Game ${dbGame.id}: API returned null scores for finished game but DB already has scores – keeping DB values`
            );
            // Still update status/OT if the status changed
          }
        }

        // ── went_to_ot: derived ONLY from status.short ────────────────────────
        const wentToOt: boolean =
          providerStatus === "AOT" ||
          providerStatus === "AP"  ||
          providerStatus === "AET";

        // ── period_scores: raw from provider ─────────────────────────────────
        // game.periods is an object like:
        //   { first: { home: 1, away: 0 }, second: {...}, third: {...},
        //     overtime: { home: 1, away: 0 } }
        // Store as-is; iceedge-compute will interpret it.
        const periodScores: any | null = game.periods ?? null;

        // ── Guard: skip if provider looks inconsistent ────────────────────────
        // A finished game with null home AND null away AND no existing DB score = suspicious
        if (
          homeScore === null &&
          awayScore === null &&
          dbGame.home_score === null &&
          dbGame.away_score === null
        ) {
          errors.push(
            `Game ${dbGame.id}: null scores from provider for status=${providerStatus}`
          );
          console.warn(
            `[hockey-sync-results] Game ${dbGame.id}: null scores on finished game – skipping write`
          );
          failed++;
          continue;
        }

        // ── Build update payload ──────────────────────────────────────────────
        // If provider returns null scores but DB already has them, preserve DB values.
        const updatePayload: Record<string, any> = {
          status:        providerStatus,
          went_to_ot:    wentToOt,
          period_scores: periodScores,
        };

        // Only write scores if provider has them (don't overwrite good data with null)
        if (homeScore !== null) updatePayload.home_score = homeScore;
        if (awayScore !== null) updatePayload.away_score = awayScore;

        // ── Write to DB ───────────────────────────────────────────────────────
        const { error: updateErr } = await supabase
          .from("hockey_games")
          .update(updatePayload)
          .eq("id", dbGame.id);

        if (updateErr) {
          errors.push(`DB update game ${dbGame.id}: ${updateErr.message}`);
          console.error(
            `[hockey-sync-results] DB update error game ${dbGame.id}:`,
            updateErr.message
          );
          failed++;
        } else {
          processed++;
          console.log(
            `[hockey-sync-results] Game ${dbGame.id}: status=${providerStatus} went_to_ot=${wentToOt} home=${homeScore} away=${awayScore}`
          );
        }
      } catch (gameErr: any) {
        errors.push(`Exception game ${dbGame.id}: ${gameErr.message}`);
        console.error(
          `[hockey-sync-results] Exception on game ${dbGame.id}:`,
          gameErr.message
        );
        failed++;
      }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    const elapsed = Date.now() - startTime;
    console.log(
      `[hockey-sync-results] ═══════ COMPLETE ═══════ processed=${processed} skipped=${skipped} failed=${failed} api_calls=${apiCalls} elapsed=${elapsed}ms`
    );

    if (errors.length > 0) {
      console.warn("[hockey-sync-results] Errors (first 10):", errors.slice(0, 10));
    }

    // ── Pipeline log ──────────────────────────────────────────────────────────
    await supabase.from("pipeline_run_logs").insert({
      job_name:     "hockey-sync-results",
      run_started:  new Date(startTime).toISOString(),
      run_finished: new Date().toISOString(),
      success:      failed === 0,
      mode:         "cron",
      processed,
      failed,
      details: {
        candidates:  candidates?.length ?? 0,
        processed,
        skipped,
        failed,
        api_calls:   apiCalls,
        elapsed_ms:  elapsed,
        errors:      errors.slice(0, 20),
      },
    });

    return new Response(
      JSON.stringify({
        success:   true,
        processed,
        skipped,
        failed,
        api_calls: apiCalls,
        elapsed_ms: elapsed,
        errors:    errors.length > 0 ? errors.slice(0, 10) : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[hockey-sync-results] FATAL:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
