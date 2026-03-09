import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { checkUserRateLimit, buildRateLimitResponse } from "../_shared/rate_limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const RequestSchema = z.object({
  fixtureId: z.number().int().positive(),
});

// Poisson probability mass function
function poissonPMF(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}

function logFactorial(n: number): number {
  if (n <= 1) return 0;
  let result = 0;
  for (let i = 2; i <= n; i++) {
    result += Math.log(i);
  }
  return result;
}

// Poisson CDF P(X <= k)
function poissonCDF(lambda: number, k: number): number {
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    sum += poissonPMF(lambda, i);
  }
  return Math.min(1, sum);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // 1) Auth: verify JWT via getClaims
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const userId = claimsData.claims.sub;

    // 2) Premium entitlement check (no trial credits consumed)
    const supabaseClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: entitlement } = await supabaseClient
      .from("user_entitlements")
      .select("plan, current_period_end")
      .eq("user_id", userId)
      .maybeSingle();

    const hasPaidAccess =
      entitlement &&
      entitlement.plan !== "free" &&
      entitlement.current_period_end &&
      new Date(entitlement.current_period_end) > new Date();

    let isAdmin = false;
    if (!hasPaidAccess) {
      const { data: wl } = await userClient.rpc("is_user_whitelisted");
      isAdmin = wl === true;
    }

    if (!hasPaidAccess && !isAdmin) {
      return new Response(
        JSON.stringify({ error: "Premium subscription required", code: "PAYWALL" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 402 }
      );
    }

    // 3) Rate limiting (10 req/min)
    const rateLimitResult = await checkUserRateLimit({
      supabase: supabaseClient,
      userId,
      feature: "calculate_value",
      maxPerMinute: 10,
    });

    if (!rateLimitResult.allowed) {
      return buildRateLimitResponse("calculate_value", rateLimitResult.retryAfterSeconds || 60, corsHeaders);
    }

    // Validate input
    const bodyRaw = await req.json().catch(() => null);
    if (!bodyRaw) {
      return new Response(
        JSON.stringify({ error: "Invalid request body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const validation = RequestSchema.safeParse(bodyRaw);
    if (!validation.success) {
      console.error("[calculate-value] Validation error:", validation.error.format());
      return new Response(
        JSON.stringify({ error: "Invalid request parameters" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
      );
    }

    const { fixtureId } = validation.data;

    // Fetch fixture stats
    const { data: fixture, error: fixtureError } = await supabaseClient
      .from("fixtures")
      .select("*")
      .eq("id", fixtureId)
      .single();

    if (fixtureError) {
      console.error("[calculate-value] Error fetching fixture:", fixtureError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch fixture" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    if (!fixture) {
      return new Response(
        JSON.stringify({ error: "Fixture not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    const homeTeamId = fixture.teams_home.id;
    const awayTeamId = fixture.teams_away.id;

    const [homeStatsRes, awayStatsRes] = await Promise.all([
      supabaseClient.from("stats_cache").select("*").eq("team_id", homeTeamId).maybeSingle(),
      supabaseClient.from("stats_cache").select("*").eq("team_id", awayTeamId).maybeSingle(),
    ]);

    if (!homeStatsRes.data || !awayStatsRes.data) {
      return new Response(
        JSON.stringify({ error: "Team stats not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    const HOME_ADVANTAGE = 1.06;
    const SHRINKAGE_TAU = 10;
    const LEAGUE_MEAN_GOALS = 1.4;

    const homeWeight = homeStatsRes.data.sample_size / (homeStatsRes.data.sample_size + SHRINKAGE_TAU);
    const awayWeight = awayStatsRes.data.sample_size / (awayStatsRes.data.sample_size + SHRINKAGE_TAU);

    const lambdaHome = (homeStatsRes.data.goals * homeWeight + LEAGUE_MEAN_GOALS * (1 - homeWeight)) * HOME_ADVANTAGE;
    const lambdaAway = awayStatsRes.data.goals * awayWeight + LEAGUE_MEAN_GOALS * (1 - awayWeight);
    const lambdaTotal = lambdaHome + lambdaAway;

    const prob0Goals = poissonPMF(lambdaTotal, 0);
    const prob1Goals = poissonPMF(lambdaTotal, 1);
    const prob2Goals = poissonPMF(lambdaTotal, 2);
    const prob3Goals = poissonPMF(lambdaTotal, 3);
    const prob4Goals = poissonPMF(lambdaTotal, 4);

    const cdf0 = poissonCDF(lambdaTotal, 0);
    const cdf1 = poissonCDF(lambdaTotal, 1);
    const cdf2 = poissonCDF(lambdaTotal, 2);
    const cdf3 = poissonCDF(lambdaTotal, 3);

    return new Response(
      JSON.stringify({
        fixture_id: fixtureId,
        lambda_home: lambdaHome,
        lambda_away: lambdaAway,
        lambda_total: lambdaTotal,
        poisson_0: prob0Goals,
        poisson_1: prob1Goals,
        poisson_2: prob2Goals,
        poisson_3: prob3Goals,
        poisson_4: prob4Goals,
        cdf_0: cdf0,
        cdf_1: cdf1,
        cdf_2: cdf2,
        cdf_3: cdf3,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[calculate-value] Internal error:", {
      message: error instanceof Error ? error.message : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
