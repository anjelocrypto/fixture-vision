/**
 * Allowlist Compliance Check — Admin diagnostic endpoint
 * Verifies that safe_zone_picks, generated_tickets, and optimized_selections
 * conform to the GREEN allowlist.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";
import {
  ALLOWED_LEAGUE_IDS,
  ALLOWED_MARKET_LINES,
  BANNED_MARKETS,
  GLOBAL_ODDS_CAP,
} from "../_shared/green_allowlist.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const auth = await checkCronOrAdminAuth(req, supabase, serviceRoleKey, "[allowlist-compliance]");
  if (!auth.authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const now = new Date().toISOString();
    const leagueList = ALLOWED_LEAGUE_IDS.join(",");
    const allowedMarkets = ALLOWED_MARKET_LINES.map(ml => ml.market);
    const allowedLines = ALLOWED_MARKET_LINES.map(ml => ml.line);

    // 1) Safe zone picks outside allowlist
    const { data: szViolations, count: szCount } = await supabase
      .from("safe_zone_picks")
      .select("fixture_id, league_id, market, side, line, odds", { count: "exact" })
      .or(
        `league_id.not.in.(${leagueList}),` +
        `market.in.(${BANNED_MARKETS.join(",")}),` +
        `odds.gt.${GLOBAL_ODDS_CAP},` +
        `side.neq.over`
      )
      .limit(20);

    // 2) Ticket leg outcomes outside allowlist (created after deploy — use last 7 days as proxy)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: tloViolations, count: tloCount } = await supabase
      .from("ticket_leg_outcomes")
      .select("ticket_id, fixture_id, league_id, market, side, line, odds, created_at", { count: "exact" })
      .gte("created_at", sevenDaysAgo)
      .or(
        `league_id.not.in.(${leagueList}),` +
        `market.in.(${BANNED_MARKETS.join(",")}),` +
        `odds.gt.${GLOBAL_ODDS_CAP}`
      )
      .order("created_at", { ascending: false })
      .limit(20);

    // 3) Optimized selections outside allowlist (upcoming window)
    const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const { data: osViolations, count: osCount } = await supabase
      .from("optimized_selections")
      .select("fixture_id, league_id, market, side, line, odds, utc_kickoff", { count: "exact" })
      .gte("utc_kickoff", now)
      .lte("utc_kickoff", in48h)
      .or(
        `league_id.not.in.(${leagueList}),` +
        `market.in.(${BANNED_MARKETS.join(",")}),` +
        `odds.gt.${GLOBAL_ODDS_CAP}`
      )
      .limit(20);

    const allClean = (szCount || 0) === 0 && (tloCount || 0) === 0 && (osCount || 0) === 0;

    return new Response(
      JSON.stringify({
        status: allClean ? "COMPLIANT" : "VIOLATIONS_FOUND",
        allowlist: {
          leagues: ALLOWED_LEAGUE_IDS,
          markets: ALLOWED_MARKET_LINES,
          banned: BANNED_MARKETS,
          odds_cap: GLOBAL_ODDS_CAP,
        },
        safe_zone_picks: {
          violations: szCount || 0,
          samples: szViolations || [],
        },
        ticket_leg_outcomes_7d: {
          violations: tloCount || 0,
          samples: tloViolations || [],
        },
        optimized_selections_upcoming: {
          violations: osCount || 0,
          samples: osViolations || [],
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[allowlist-compliance] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
