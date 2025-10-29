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

// Fire-and-forget trigger for long-running Edge Functions to avoid browser timeouts
function triggerEdgeFunction(name: string, body: unknown) {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!baseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const url = `${baseUrl}/functions/v1/${name}`;
  // Intentionally do not await – let the platform execute independently
  fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  })
    .then(async (res) => {
      const text = await res.text().catch(() => "");
      console.log(`[warmup-odds] trigger ${name} -> ${res.status}`);
      if (!res.ok) {
        console.error(`[warmup-odds] trigger error ${name}:`, text.substring(0, 200));
      }
    })
    .catch((e) => {
      console.error(`[warmup-odds] trigger failed ${name}:`, e?.message || e);
    });
}

serve(async (req) => {
  const origin = req.headers.get('origin');
  
  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  try {
    // Admin gate: verify user is whitelisted
    const authHeader = req.headers.get("authorization") ?? "";
    console.log("[warmup-odds] Auth header present:", !!authHeader);
    
    const jwt = authHeader.replace(/^Bearer\s+/i, "");

    if (!jwt) {
      console.error("[warmup-odds] No authorization token provided");
      console.log("[warmup-odds] Headers:", Array.from(req.headers.entries()));
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

    const { window_hours = 48, force = false } = await req.json().catch(() => ({}));
    
    console.log(`[warmup-odds] Admin initiated ${window_hours}h warmup (force=${force})`);

    // Execute pipeline in proper sequence to avoid browser 60s CORS timeout
    // Step 1: Refresh stats first (teams need stats for selections)
    console.log(`[warmup-odds] Step 1: Calling stats-refresh (${window_hours}h, force=${force})`);
    const statsResult = await callEdgeFunction("stats-refresh", { 
      window_hours, 
      stats_ttl_hours: 24,
      force 
    });

    if (!statsResult.ok) {
      console.error(`[warmup-odds] stats-refresh failed: ${statsResult.status}`, statsResult.data);
    } else {
      console.log(`[warmup-odds] stats-refresh completed: ${JSON.stringify(statsResult.data).substring(0, 200)}`);
    }

    // Step 2: Backfill odds (can run after stats)
    console.log(`[warmup-odds] Step 2: Triggering backfill-odds (${window_hours}h)`);
    triggerEdgeFunction("backfill-odds", { window_hours });

    // Small delay to let odds start populating
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 3: Generate optimized selections (needs both stats and odds)
    console.log(`[warmup-odds] Step 3: Triggering optimize-selections-refresh (${window_hours}h)`);
    triggerEdgeFunction("optimize-selections-refresh", { window_hours });

    // Respond immediately – progress can be observed via badges/logs
    return jsonResponse(
      {
        success: true,
        started: true,
        window_hours,
        force,
        statsResult: statsResult.ok ? "completed" : "failed",
        message: `Warmup started for ${window_hours}h. Pipeline: stats (awaited) → odds → selections running in background.`,
      },
      origin,
      202,
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
