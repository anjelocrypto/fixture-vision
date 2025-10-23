import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const RequestSchema = z.object({
  date: z.string(),
  market: z.enum(["goals", "cards", "corners", "fouls", "offsides"]),
  line: z.number(),
  minOdds: z.number().min(1.0).optional(),
  countryCode: z.string().optional(),
  leagueIds: z.array(z.number().int().positive()).optional(),
  live: z.boolean().optional(),
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
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
      console.error("[filterizer-query] Validation error:", validation.error.format());
      return new Response(
        JSON.stringify({ error: "Invalid request parameters", details: validation.error.format() }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
      );
    }

    const { 
      date, 
      market, 
      line, 
      minOdds = 1.0, 
      countryCode, 
      leagueIds, 
      live = false 
    } = validation.data;

    console.log(`[filterizer-query] User ${user.id} querying: market=${market}, line=${line}, minOdds=${minOdds}`);

    // Calculate 7-day window from date
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const now = new Date();
    const queryStart = startDate > now ? startDate : now;
    
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 7);
    endDate.setHours(23, 59, 59, 999);

    console.log(`[filterizer-query] Window: ${queryStart.toISOString()} to ${endDate.toISOString()}`);

    // Build query
    let query = supabaseClient
      .from("optimized_selections")
      .select("*")
      .eq("market", market)
      .gte("odds", minOdds)
      .eq("is_live", live)
      .gte("utc_kickoff", queryStart.toISOString())
      .lte("utc_kickoff", endDate.toISOString());

    // Filter by line (with small tolerance)
    query = query.gte("line", line - 0.01).lte("line", line + 0.01);

    // Scope by country or leagues
    if (leagueIds && leagueIds.length > 0) {
      query = query.in("league_id", leagueIds);
    } else if (countryCode) {
      query = query.eq("country_code", countryCode);
    }

    // Sort by kickoff time (earliest first)
    query = query.order("utc_kickoff", { ascending: true });

    const { data: selections, error: selectionsError } = await query;

    if (selectionsError) {
      console.error("[filterizer-query] Error fetching selections:", selectionsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch selections" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    console.log(`[filterizer-query] Found ${selections?.length || 0} selections matching criteria`);

    return new Response(
      JSON.stringify({
        selections: selections || [],
        count: selections?.length || 0,
        window: { start: queryStart.toISOString(), end: endDate.toISOString() },
        filters: { market, line, minOdds },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[filterizer-query] Internal error:", {
      message: error instanceof Error ? error.message : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
