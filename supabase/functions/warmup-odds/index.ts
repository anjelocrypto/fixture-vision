import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// Helper to call edge functions with service role key
async function callEdgeFunction(name: string, body: unknown) {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!baseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  console.log(`[warmup-odds] Calling ${name} with service role auth`);
  
  const url = `${baseUrl}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.substring(0, 200) };
  }

  console.log(`[warmup-odds] ${name} responded with status ${res.status}`);
  
  if (!res.ok) {
    console.error(`[warmup-odds] ${name} error body:`, JSON.stringify(json).substring(0, 200));
    return { ok: false, status: res.status, data: json };
  }

  return { ok: true, status: res.status, data: json };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      console.log("[warmup-odds] No auth header provided");
      return new Response(
        JSON.stringify({ 
          success: false,
          error: "Authentication required" 
        }),
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
      console.log("[warmup-odds] Invalid token:", authError?.message);
      return new Response(
        JSON.stringify({ 
          success: false,
          error: "Invalid authentication token" 
        }),
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
      console.log(`[warmup-odds] User ${user.id} is not an admin`);
      return new Response(
        JSON.stringify({ 
          success: false,
          error: "Admin access required" 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
      );
    }

    const { window_hours = 48 } = await req.json().catch(() => ({}));
    
    console.log(`[warmup-odds] Admin ${user.id} initiated ${window_hours}h warmup`);

    // Step 1: Backfill odds with service role auth
    console.log(`[warmup-odds] Step 1/2: Calling backfill-odds (${window_hours}h)`);
    
    const backfillResponse = await callEdgeFunction("backfill-odds", { window_hours });

    if (!backfillResponse.ok) {
      console.error(`[warmup-odds] Backfill failed with status ${backfillResponse.status}`);
      return new Response(
        JSON.stringify({ 
          success: false,
          error: "Backfill failed", 
          status: backfillResponse.status,
          details: backfillResponse.data,
          backfill: backfillResponse.data
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const backfillData = backfillResponse.data || {};
    console.log("[warmup-odds] Backfill complete:", JSON.stringify(backfillData).substring(0, 200));

    // Step 2: Optimize selections with service role auth
    console.log(`[warmup-odds] Step 2/2: Calling optimize-selections-refresh (${window_hours}h)`);
    
    const optimizeResponse = await callEdgeFunction("optimize-selections-refresh", { window_hours });

    if (!optimizeResponse.ok) {
      console.error(`[warmup-odds] Optimize failed with status ${optimizeResponse.status}`);
      return new Response(
        JSON.stringify({ 
          success: false,
          error: "Optimize failed", 
          status: optimizeResponse.status,
          details: optimizeResponse.data,
          backfill: backfillData,
          optimize: optimizeResponse.data
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const optimizeData = optimizeResponse.data || {};
    console.log("[warmup-odds] Optimize complete:", JSON.stringify(optimizeData).substring(0, 200));

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
      JSON.stringify({ 
        success: false,
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
