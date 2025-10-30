import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

// Helper to call edge functions with internal auth
async function callEdgeFunction(name: string, body: unknown) {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronKey = Deno.env.get("CRON_INTERNAL_KEY");
  
  if (!baseUrl || !serviceRoleKey || !cronKey) {
    throw new Error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or CRON_INTERNAL_KEY");
  }

  console.log(`[warmup-odds] Calling ${name} with internal auth`);
  
  const url = `${baseUrl}/functions/v1/${name}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceRoleKey}`,
      "x-cron-key": cronKey,
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
  const cronKey = Deno.env.get("CRON_INTERNAL_KEY");
  if (!baseUrl || !serviceRoleKey || !cronKey) {
    throw new Error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or CRON_INTERNAL_KEY");
  }
  const url = `${baseUrl}/functions/v1/${name}`;
  // Intentionally do not await – let the platform execute independently
  fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceRoleKey}`,
      "x-cron-key": cronKey,
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      return errorResponse("Missing environment variables", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Standardized auth: X-CRON-KEY or whitelisted user
    const cronKeyHeader = req.headers.get("x-cron-key");
    const authHeader = req.headers.get("authorization");
    
    let isAuthorized = false;

    // Check X-CRON-KEY first
    if (cronKeyHeader) {
      const { data: dbKey, error: keyError } = await supabase
        .rpc("get_cron_internal_key")
        .single();
      
      if (!keyError && dbKey && cronKeyHeader === dbKey) {
        isAuthorized = true;
        console.log("[warmup-odds] Authorized via X-CRON-KEY");
      }
    }

    // If not authorized via cron key, check user whitelist
    if (!isAuthorized && authHeader) {
      const userClient = createClient(
        supabaseUrl,
        supabaseAnonKey,
        { global: { headers: { Authorization: authHeader } } }
      );

      const { data: isWhitelisted, error: whitelistError } = await userClient
        .rpc("is_user_whitelisted")
        .single();

      if (whitelistError) {
        console.error("[warmup-odds] Whitelist check failed:", whitelistError);
        return errorResponse("Auth check failed", origin, 401, req);
      }

      if (!isWhitelisted) {
        console.warn("[warmup-odds] User not whitelisted");
        return errorResponse("Forbidden: Admin access required", origin, 403, req);
      }

      console.log("[warmup-odds] Authorized via whitelisted user");
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return errorResponse("Unauthorized: missing/invalid X-CRON-KEY or user not whitelisted", origin, 401, req);
    }

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

    let statsStatus = "failed";
    if (statsResult.ok) {
      // Check if it was skipped due to already running (mutex lock)
      if (statsResult.data?.skipped && statsResult.data?.reason?.includes("already running")) {
        statsStatus = "already-running";
        console.log(`[warmup-odds] stats-refresh already running (mutex locked), proceeding with pipeline`);
      } else if (statsResult.data?.success) {
        statsStatus = "completed";
        console.log(`[warmup-odds] stats-refresh completed: ${JSON.stringify(statsResult.data).substring(0, 200)}`);
      }
    } else {
      console.error(`[warmup-odds] stats-refresh failed: ${statsResult.status}`, statsResult.data);
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
        statsResult: statsStatus,
        message: `Warmup started for ${window_hours}h. Pipeline: stats (${statsStatus}) → odds → selections running in background.`,
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
