import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

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
  const origin = req.headers.get('origin');
  
  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  try {
    // Admin gate: verify user is whitelisted
    const authHeader = req.headers.get("authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");

    if (!jwt) {
      console.error("[warmup-odds] No authorization token provided");
      return errorResponse("authentication_required", origin, 401, req);
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${jwt}` } } }
    );

    const { data: isWhitelisted, error: whitelistError } = await supabaseUser.rpc("is_user_whitelisted");

    if (whitelistError) {
      console.error("[warmup-odds] is_user_whitelisted error:", whitelistError);
      return errorResponse("auth_check_failed", origin, 401, req);
    }

    if (!isWhitelisted) {
      console.warn("[warmup-odds] Non-admin user attempted access");
      return errorResponse("forbidden_admin_only", origin, 403, req);
    }

    console.log("[warmup-odds] Admin access verified");

    const { window_hours = 48 } = await req.json().catch(() => ({}));
    
    console.log(`[warmup-odds] Admin initiated ${window_hours}h warmup`);

    // Step 1: Backfill odds with service role auth
    console.log(`[warmup-odds] Step 1/2: Calling backfill-odds (${window_hours}h)`);
    
    const backfillResponse = await callEdgeFunction("backfill-odds", { window_hours });

    if (!backfillResponse.ok) {
      console.error(`[warmup-odds] Backfill failed with status ${backfillResponse.status}`);
      return jsonResponse(
        { 
          success: false,
          error: "Backfill failed", 
          status: backfillResponse.status,
          details: backfillResponse.data,
          backfill: backfillResponse.data
        },
        origin,
        200,
        req
      );
    }

    const backfillData = backfillResponse.data || {};
    console.log("[warmup-odds] Backfill complete:", JSON.stringify(backfillData).substring(0, 200));

    // Step 2: Optimize selections with service role auth
    console.log(`[warmup-odds] Step 2/2: Calling optimize-selections-refresh (${window_hours}h)`);
    
    const optimizeResponse = await callEdgeFunction("optimize-selections-refresh", { window_hours });

    if (!optimizeResponse.ok) {
      console.error(`[warmup-odds] Optimize failed with status ${optimizeResponse.status}`);
      return jsonResponse(
        { 
          success: false,
          error: "Optimize failed", 
          status: optimizeResponse.status,
          details: optimizeResponse.data,
          backfill: backfillData,
          optimize: optimizeResponse.data
        },
        origin,
        200,
        req
      );
    }

    const optimizeData = optimizeResponse.data || {};
    console.log("[warmup-odds] Optimize complete:", JSON.stringify(optimizeData).substring(0, 200));

    // Return combined results
    return jsonResponse(
      {
        success: true,
        window_hours,
        backfill: backfillData,
        optimize: optimizeData,
        message: `Successfully warmed ${window_hours}h window: ${backfillData.fetched || 0} odds fetched, ${optimizeData.inserted || 0} selections created`
      },
      origin,
      200,
      req
    );

  } catch (error) {
    console.error("[warmup-odds] Internal error:", {
      message: error instanceof Error ? error.message : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return errorResponse(
      error instanceof Error ? error.message : "Internal server error",
      origin,
      500,
      req
    );
  }
});
