// ============================================================================
// Warmup Odds Edge Function
// ============================================================================
// Uses shared auth helper for consistent cron/admin authentication
// Triggers stats-refresh, backfill-odds, and optimize-selections-refresh
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { UPCOMING_WINDOW_HOURS } from "../_shared/config.ts";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";

// Fire-and-forget trigger for long-running Edge Functions to avoid browser timeouts
async function triggerEdgeFunction(name: string, body: unknown) {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!baseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  // Get cron key from database (NOT from env var!)
  const supabase = createClient(baseUrl, serviceRoleKey);
  const { data: cronKey, error: keyError } = await supabase.rpc("get_cron_internal_key");
  
  if (keyError || !cronKey) {
    console.error(`[warmup-odds] Failed to get cron key:`, keyError);
    throw new Error("Failed to get cron internal key from database");
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

    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse("Missing environment variables", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Use shared auth helper (NO .single() on scalar RPCs, case-insensitive headers)
    const authResult = await checkCronOrAdminAuth(req, supabase, supabaseServiceKey, "[warmup-odds]");
    
    if (!authResult.authorized) {
      return errorResponse("Unauthorized: missing/invalid X-CRON-KEY or user not whitelisted", origin, 401, req);
    }

    const { window_hours = UPCOMING_WINDOW_HOURS, force = false } = await req.json().catch(() => ({}));
    
    console.log(`[warmup-odds] Admin initiated ${window_hours}h warmup (force=${force})`);

    // Execute pipeline in proper sequence - all fire-and-forget to avoid browser timeout
    // Step 1: Refresh stats first (teams need stats for selections)
    console.log(`[warmup-odds] Step 1: Triggering stats-refresh (${window_hours}h, force=${force})`);
    await triggerEdgeFunction("stats-refresh", { 
      window_hours, 
      stats_ttl_hours: 24,
      force 
    });

    // Step 2: Backfill odds (can run after stats start)
    console.log(`[warmup-odds] Step 2: Triggering backfill-odds (${window_hours}h)`);
    await triggerEdgeFunction("backfill-odds", { window_hours });

    // Step 3: Generate optimized selections (needs both stats and odds)
    console.log(`[warmup-odds] Step 3: Triggering optimize-selections-refresh (${window_hours}h)`);
    await triggerEdgeFunction("optimize-selections-refresh", { window_hours });

    // Respond immediately – all steps running in background
    return jsonResponse(
      {
        success: true,
        started: true,
        window_hours,
        force,
        message: `Warmup pipeline started for ${window_hours}h. Stats → Odds → Selections running in background. Monitor progress via logs or badges.`,
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
