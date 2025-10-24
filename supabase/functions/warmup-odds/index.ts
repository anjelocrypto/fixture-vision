import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
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

    // Verify admin role
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    // Check if user has admin role
    const { data: roleData } = await supabaseClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
      );
    }

    console.log(`[warmup-odds] Admin ${user.id} initiated 48h warmup`);

    const { window_hours = 48 } = await req.json().catch(() => ({}));

    // Step 1: Backfill odds
    console.log(`[warmup-odds] Step 1/2: Calling backfill-odds (${window_hours}h)`);
    
    const backfillResponse = await supabaseClient.functions.invoke("backfill-odds", {
      body: { window_hours },
    });

    if (backfillResponse.error) {
      console.error("[warmup-odds] Backfill failed:", backfillResponse.error);
      return new Response(
        JSON.stringify({ 
          error: "Backfill failed", 
          details: backfillResponse.error 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const backfillData = backfillResponse.data || {};
    console.log("[warmup-odds] Backfill complete:", backfillData);

    // Step 2: Optimize selections
    console.log(`[warmup-odds] Step 2/2: Calling optimize-selections-refresh (${window_hours}h)`);
    
    const optimizeResponse = await supabaseClient.functions.invoke("optimize-selections-refresh", {
      body: { window_hours },
    });

    if (optimizeResponse.error) {
      console.error("[warmup-odds] Optimize failed:", optimizeResponse.error);
      return new Response(
        JSON.stringify({ 
          error: "Optimize failed", 
          details: optimizeResponse.error,
          backfill: backfillData 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    const optimizeData = optimizeResponse.data || {};
    console.log("[warmup-odds] Optimize complete:", optimizeData);

    // Return combined results
    return new Response(
      JSON.stringify({
        success: true,
        window_hours,
        backfill: backfillData,
        optimize: optimizeData,
        message: `Successfully warmed ${window_hours}h window: ${backfillData.fetched || 0} odds fetched, ${optimizeData.inserted || 0} selections created`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[warmup-odds] Internal error:", {
      message: error instanceof Error ? error.message : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
