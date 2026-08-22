// ============================================================================
// Warmup Odds Edge Function
// ============================================================================
// Uses shared auth helper for consistent cron/admin authentication
// Triggers stats-refresh, backfill-odds, and optimize-selections-refresh
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { UPCOMING_WINDOW_HOURS } from "../_shared/config.ts";
import { checkCronOrAdminAuth } from "../_shared/auth.ts";

interface PipelineStepResult {
  name: string;
  status: number;
  body: unknown;
}

// Await each stage so selections never run against an odds/stats refresh that
// is merely scheduled but has not completed yet.
async function callEdgeFunction(name: string, body: unknown): Promise<PipelineStepResult> {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!baseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  // Get cron key from database (not from an environment literal).
  const supabase = createClient(baseUrl, serviceRoleKey);
  const { data: cronKey, error: keyError } = await supabase.rpc("get_cron_internal_key");
  
  if (keyError || !cronKey) {
    console.error(`[warmup-odds] Failed to get cron key:`, keyError);
    throw new Error("Failed to get cron internal key from database");
  }

  const url = `${baseUrl}/functions/v1/${name}`;
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceRoleKey}`,
      "x-cron-key": cronKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text.slice(0, 500) };
  }
  console.log(`[warmup-odds] ${name} -> ${response.status}`);
  if (!response.ok) {
    throw new Error(`${name} failed with HTTP ${response.status}`);
  }
  return { name, status: response.status, body: parsed };
}

serve(async (req) => {
  const origin = req.headers.get('origin');
  
  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const jobName = "optimizer-refresh";
  let lockToken: string | null = null;
  let lockClient: any = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse("Missing environment variables", origin, 500, req);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    lockClient = supabase;

    // Use shared auth helper (NO .single() on scalar RPCs, case-insensitive headers)
    const authResult = await checkCronOrAdminAuth(req, supabase, supabaseServiceKey, "[warmup-odds]");
    
    if (!authResult.authorized) {
      return errorResponse("Unauthorized: missing/invalid X-CRON-KEY or user not whitelisted", origin, 401, req);
    }

    const requestBody = await req.json().catch(() => ({}));
    const window_hours = Math.min(
      Math.max(Number(requestBody?.window_hours) || UPCOMING_WINDOW_HOURS, 1),
      168,
    );
    const force = requestBody?.force === true;

    const { data: acquiredToken, error: leaseError } = await supabase.rpc("acquire_cron_lease", {
      p_job_name: jobName,
      p_duration_minutes: 120,
    });
    if (leaseError) {
      return errorResponse("Failed to acquire optimizer lease", origin, 500, req);
    }
    if (!acquiredToken) {
      return jsonResponse(
        { success: false, busy: true, message: "Optimizer refresh already running" },
        origin,
        409,
        req,
      );
    }
    lockToken = acquiredToken;
    
    console.log(`[warmup-odds] Admin initiated ${window_hours}h warmup (force=${force})`);

    // Execute the pipeline in strict dependency order.
    console.log(`[warmup-odds] Step 1: Running stats-refresh (${window_hours}h, force=${force})`);
    const stats = await callEdgeFunction("stats-refresh", {
      window_hours, 
      stats_ttl_hours: 24,
      force 
    });

    console.log(`[warmup-odds] Step 2: Running backfill-odds (${window_hours}h)`);
    const odds = await callEdgeFunction("backfill-odds", { window_hours });

    console.log(`[warmup-odds] Step 3: Running optimize-selections-refresh (${window_hours}h)`);
    const selections = await callEdgeFunction("optimize-selections-refresh", { window_hours });

    return jsonResponse(
      {
        success: true,
        completed: true,
        window_hours,
        force,
        steps: [stats, odds, selections],
        message: `Warmup pipeline completed for ${window_hours}h in dependency order.`,
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
  } finally {
    if (lockToken && lockClient) {
      const { data: released, error: releaseError } = await lockClient.rpc("release_cron_lease", {
        p_job_name: jobName,
        p_lock_token: lockToken,
      });
      if (releaseError || released !== true) {
        console.error("[warmup-odds] Failed to release owned lease", releaseError);
      }
    }
  }
});
