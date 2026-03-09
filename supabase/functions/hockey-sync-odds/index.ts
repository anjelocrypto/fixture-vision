/**
 * hockey-sync-odds
 *
 * Fetches odds for upcoming hockey games and normalizes into hockey_odds_cache.
 * 
 * Unique constraint: (game_id, bookmaker, market, selection, line)
 *
 * Canonical market mapping:
 *   Provider bet name          → market         | selection      | line
 *   ─────────────────────────────────────────────────────────────────────
 *   "Match Winner"             → "match_winner" | "home"/"away"  | 0
 *   "Home/Away" (reg time)     → "reg_winner"   | "home"/"draw"/"away" | 0
 *   "Over/Under"               → "total"        | "over"/"under" | X.5
 *   "Over/Under First Period"  → "p1_total"     | "over"/"under" | X.5
 *   "Handicap"                 → "handicap"     | "home"/"away"  | ±X.5
 *   "Home Total" / "Away Total"→ "home_total"/"away_total" | "over"/"under" | X.5
 *
 * Provider: api-sports.io  /odds endpoint
 * Auth key: API_HOCKEY_KEY env secret
 *
 * IMPORTANT: The hockey odds API requires &season= parameter.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-key",
};

const HOCKEY_BASE = "https://v1.hockey.api-sports.io";

/**
 * Normalize a bet name from the API into our canonical market string.
 * Returns null if we don't support this market.
 */
function normalizeMarket(betName: string): string | null {
  const n = betName.toLowerCase().trim();
  if (n === "3way result" || n === "match result" || n === "1x2") return "reg_winner";
  if (n === "home/away" || n === "match winner" || n === "match winner (incl. ot and penalties)") return "match_winner";
  if (n === "over/under" || n === "total goals" || n === "total") return "total";
  if (n === "asian handicap" || n === "handicap" || n === "puck line") return "handicap";
  if (n.includes("1st period") || n.includes("first period")) {
    if (n.includes("over") || n.includes("under") || n.includes("total")) return "p1_total";
  }
  if (n.includes("2nd period") || n.includes("second period")) {
    if (n.includes("over") || n.includes("under") || n.includes("total")) return "p2_total";
  }
  if (n.includes("3rd period") || n.includes("third period")) {
    if (n.includes("over") || n.includes("under") || n.includes("total")) return "p3_total";
  }
  if (n.includes("home total")) return "home_total";
  if (n.includes("away total")) return "away_total";
  return null;
}

/**
 * Normalize a selection value from the API.
 * Examples: "Home", "Away", "Draw", "Over 5.5", "Under 5.5", "Home -1.5"
 * Returns { selection, line }
 */
function normalizeSelection(
  market: string,
  rawValue: string
): { selection: string; line: number } | null {
  const v = rawValue.trim();

  // Match Winner / Reg Winner
  if (market === "match_winner" || market === "reg_winner") {
    const vl = v.toLowerCase();
    if (vl === "home" || vl === "1") return { selection: "home", line: 0 };
    if (vl === "away" || vl === "2") return { selection: "away", line: 0 };
    if (vl === "draw" || vl === "x") return { selection: "draw", line: 0 };
    return null;
  }

  // Over/Under markets (total, p1_total, home_total, away_total)
  if (["total", "p1_total", "p2_total", "p3_total", "home_total", "away_total"].includes(market)) {
    const match = v.match(/^(over|under)\s+([\d.]+)$/i);
    if (match) {
      return {
        selection: match[1].toLowerCase(),
        line: parseFloat(match[2]),
      };
    }
    return null;
  }

  // Handicap
  if (market === "handicap") {
    // "Home -1.5", "Away +1.5", etc.
    const match = v.match(/^(home|away|1|2)\s*([+-]?[\d.]+)$/i);
    if (match) {
      const side = match[1].toLowerCase();
      const line = parseFloat(match[2]);
      return {
        selection: side === "1" ? "home" : side === "2" ? "away" : side,
        line,
      };
    }
    return null;
  }

  return null;
}

// Trusted bookmakers (normalized to lowercase for matching)
const TRUSTED_BOOKMAKERS = new Set([
  "bet365", "1xbet", "pinnacle", "unibet", "williamhill",
  "betway", "bwin", "888sport", "marathonbet", "betfair",
  "dafabet", "betcris", "bovada", "fanduel", "draftkings",
]);

function normalizeBookmaker(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log("[hockey-sync-odds] ===== START =====");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("API_HOCKEY_KEY");

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "API_HOCKEY_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── Auth ────────────────────────────────────────────────────────────────
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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Params ──────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const batchLimit = body.limit ?? 20;
    const debugProbe = body.debug_probe === true;
    const probeGameId = body.probe_game_id ?? null;

    // ── Debug probe: raw API inspection ─────────────────────────────────────
    if (debugProbe && probeGameId) {
      const probeUrl = `${HOCKEY_BASE}/odds?game=${probeGameId}`;
      console.log(`[hockey-sync-odds] DEBUG PROBE: ${probeUrl}`);
      const probeRes = await fetch(probeUrl, {
        headers: { "x-apisports-key": apiKey },
      });
      const probeJson = await probeRes.json();

      return new Response(
        JSON.stringify({
          debug: true,
          probe_url: probeUrl,
          http_status: probeRes.status,
          results_count: Array.isArray(probeJson.response) ? probeJson.response.length : null,
          errors: probeJson.errors,
          parameters: probeJson.parameters,
          // Show raw structure for mapping
          sample: Array.isArray(probeJson.response) ? probeJson.response.slice(0, 2) : null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Find upcoming games needing odds ─────────────────────────────────────
    const windowHours = body.window_hours ?? 48;
    const now = new Date();
    const cutoff = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

    // For testing with historical data, allow override
    const overrideGameIds: number[] | null = body.game_ids ?? null;

    let gameIds: number[] = [];

    if (overrideGameIds && overrideGameIds.length > 0) {
      gameIds = overrideGameIds;
      console.log(`[hockey-sync-odds] Using override game_ids: ${gameIds.join(", ")}`);
    } else {
      const { data: upcoming, error: upErr } = await supabase
        .from("hockey_games")
        .select("id")
        .eq("status", "NS")
        .gte("puck_drop", now.toISOString())
        .lte("puck_drop", cutoff.toISOString())
        .order("puck_drop", { ascending: true })
        .limit(batchLimit);

      if (upErr) {
        return new Response(
          JSON.stringify({ error: upErr.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      gameIds = (upcoming ?? []).map((g: any) => g.id);
      console.log(`[hockey-sync-odds] Found ${gameIds.length} upcoming games in ${windowHours}h window`);
    }

    if (gameIds.length === 0) {
      return new Response(
        JSON.stringify({ success: true, odds_upserted: 0, api_calls: 0, message: "No upcoming games" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Fetch odds per game ─────────────────────────────────────────────────
    let oddsUpserted = 0;
    let oddsSkipped = 0;
    let apiCalls = 0;
    const errors: string[] = [];
    const normalizedSamples: any[] = [];

    for (const gameId of gameIds) {
      try {
        const url = `${HOCKEY_BASE}/odds?game=${gameId}`;
        const response = await fetch(url, {
          headers: { "x-apisports-key": apiKey },
        });
        apiCalls++;

        if (!response.ok) {
          errors.push(`API ${response.status} for game ${gameId}`);
          continue;
        }

        const json = await response.json();

        if (json.errors && Object.keys(json.errors).length > 0) {
          errors.push(`API errors game ${gameId}: ${JSON.stringify(json.errors)}`);
          continue;
        }

        const results = json.response ?? [];
        if (!Array.isArray(results) || results.length === 0) {
          console.log(`[hockey-sync-odds] No odds data for game ${gameId}`);
          continue;
        }

        // results[0].bookmakers is the array of bookmakers
        const bookmakers = results[0]?.bookmakers ?? [];

        for (const bm of bookmakers) {
          const rawBookmaker = bm.name ?? "";
          const normBookmaker = normalizeBookmaker(rawBookmaker);

          // Skip untrusted bookmakers
          if (!TRUSTED_BOOKMAKERS.has(normBookmaker)) continue;

          const bets = bm.bets ?? [];
          for (const bet of bets) {
            const betName = bet.name ?? "";
            const market = normalizeMarket(betName);
            if (!market) continue; // unsupported market

            const values = bet.values ?? [];
            for (const val of values) {
              const rawValue = val.value ?? "";
              const odds = parseFloat(val.odd);
              if (isNaN(odds) || odds <= 1) continue;

              const parsed = normalizeSelection(market, rawValue);
              if (!parsed) {
                oddsSkipped++;
                continue;
              }

              const row = {
                game_id: gameId,
                bookmaker: normBookmaker,
                market,
                selection: parsed.selection,
                line: parsed.line,
                odds,
              };

              const { error: upsertErr } = await supabase
                .from("hockey_odds_cache")
                .upsert(row, {
                  onConflict: "game_id,bookmaker,market,selection,line",
                });

              if (upsertErr) {
                errors.push(`Odds upsert game=${gameId} ${market}/${parsed.selection}: ${upsertErr.message}`);
              } else {
                oddsUpserted++;
                if (normalizedSamples.length < 15) {
                  normalizedSamples.push({ ...row, raw_bet_name: betName, raw_value: rawValue });
                }
              }
            }
          }
        }

        console.log(`[hockey-sync-odds] Game ${gameId}: processed ${bookmakers.length} bookmakers`);
      } catch (gameErr: any) {
        errors.push(`Exception game ${gameId}: ${gameErr.message}`);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `[hockey-sync-odds] ═══════ COMPLETE ═══════ upserted=${oddsUpserted} skipped=${oddsSkipped} api_calls=${apiCalls} errors=${errors.length} elapsed=${elapsed}ms`
    );

    await supabase.from("pipeline_run_logs").insert({
      job_name: "hockey-sync-odds",
      run_started: new Date(startTime).toISOString(),
      run_finished: new Date().toISOString(),
      success: errors.length === 0,
      mode: "cron",
      processed: oddsUpserted,
      failed: errors.length,
      details: {
        games_queried: gameIds.length,
        odds_upserted: oddsUpserted,
        odds_skipped: oddsSkipped,
        api_calls: apiCalls,
        errors: errors.slice(0, 20),
        elapsed_ms: elapsed,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        odds_upserted: oddsUpserted,
        odds_skipped: oddsSkipped,
        api_calls: apiCalls,
        games_queried: gameIds.length,
        elapsed_ms: elapsed,
        normalized_samples: normalizedSamples.slice(0, 10),
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[hockey-sync-odds] FATAL:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
