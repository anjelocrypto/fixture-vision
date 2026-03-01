// ============================================================================
// Safe Zone Chat — Query endpoint for Safe Zone Ticket Bot
// ============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BLACKLISTED_LEAGUES = [172, 71, 143, 235, 271, 129, 136, 48];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1) Auth: verify JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userId = claimsData.claims.sub;

  // 2) Entitlement check: user_entitlements (plan <> 'free' AND current_period_end > now)
  //    OR is_user_whitelisted() = true
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: entitlement } = await serviceClient
    .from("user_entitlements")
    .select("plan, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  const hasPaidAccess =
    entitlement &&
    entitlement.plan !== "free" &&
    entitlement.current_period_end &&
    new Date(entitlement.current_period_end) > new Date();

  // Check whitelist as fallback
  let isAdmin = false;
  if (!hasPaidAccess) {
    const { data: wl } = await userClient.rpc("is_user_whitelisted");
    isAdmin = wl === true;
  }

  if (!hasPaidAccess && !isAdmin) {
    return new Response(
      JSON.stringify({
        status: "error",
        code: "PAYWALL",
        message: "Safe Zone Bot requires a premium subscription.",
      }),
      { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 3) Rate limit: 10 req/min (simple in-memory per request — real rate limit via DB)
  const { checkUserRateLimit, buildRateLimitResponse } = await import("../_shared/rate_limit.ts");
  const rlResult = await checkUserRateLimit({
    supabase: serviceClient,
    userId,
    feature: "safe_zone_chat" as any,
    maxPerMinute: 10,
  });

  if (!rlResult.allowed) {
    return buildRateLimitResponse("safe_zone_chat" as any, rlResult.retryAfterSeconds || 30, corsHeaders);
  }

  // 4) Parse request
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const query = (body.query || "").toLowerCase().trim();
  const filters = body.filters || {};

  // Parse "top N" from query
  const topMatch = query.match(/top\s*(\d+)/);
  let limit = topMatch ? parseInt(topMatch[1]) : (filters.limit || 10);
  limit = Math.max(1, Math.min(50, limit));

  // Parse market from query or filters
  let marketFilter: string | null = filters.market || null;
  if (!marketFilter) {
    if (query.includes("corner")) marketFilter = "corners";
    else if (query.includes("goal")) marketFilter = "goals";
  }
  if (marketFilter === "all") marketFilter = null;

  // Parse date from query or filters
  const dateFilter = filters.date || 
    (query.includes("today") ? "today" : 
     query.includes("tomorrow") ? "tomorrow" : "48h");

  const now = new Date();
  let dateEnd: Date;
  if (dateFilter === "today") {
    dateEnd = new Date(now);
    dateEnd.setHours(23, 59, 59, 999);
  } else if (dateFilter === "tomorrow") {
    dateEnd = new Date(now);
    dateEnd.setDate(dateEnd.getDate() + 1);
    dateEnd.setHours(23, 59, 59, 999);
  } else {
    dateEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  }

  const minConfidence = filters.min_confidence ?? 0;

  // 5) Query safe_zone_picks
  let qb = serviceClient
    .from("safe_zone_picks")
    .select("*")
    .gte("utc_kickoff", now.toISOString())
    .lte("utc_kickoff", dateEnd.toISOString())
    .gte("confidence_score", minConfidence)
    .order("confidence_score", { ascending: false })
    .limit(limit);

  if (marketFilter) {
    qb = qb.eq("market", marketFilter);
  }

  if (filters.league_ids && Array.isArray(filters.league_ids) && filters.league_ids.length > 0) {
    qb = qb.in("league_id", filters.league_ids);
  }

  const { data: picks, error: pickErr } = await qb;

  if (pickErr) {
    console.error("[safe-zone-chat] Query error:", pickErr);
    return new Response(
      JSON.stringify({ status: "error", message: "Failed to fetch picks" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 6) Get data freshness
  const { data: freshnessRow } = await serviceClient
    .from("safe_zone_picks")
    .select("computed_at")
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 7) Build response
  const response: any = {
    status: "ok",
    count: picks?.length || 0,
    generated_at: now.toISOString(),
    data_freshness: freshnessRow?.computed_at || null,
    picks: picks || [],
    meta: {
      markets_included: ["corners", "goals"],
      markets_excluded: ["cards"],
      odds_bands: { corners: [1.40, 2.30], goals: [1.50, 1.60] },
      min_sample_size: 50,
      blacklisted_leagues: BLACKLISTED_LEAGUES,
    },
  };

  // If no picks, add breakdown
  if (!picks || picks.length === 0) {
    response.status = "empty";
    response.message = `No qualifying Safe Zone picks found for ${dateFilter}. This can happen when: (1) no upcoming fixtures pass our strict odds/confidence filters, (2) insufficient historical data for leagues in play, or (3) no fixtures scheduled in the time window.`;
  }

  return new Response(JSON.stringify(response), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
