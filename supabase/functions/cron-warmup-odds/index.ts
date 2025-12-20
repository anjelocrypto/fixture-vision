// Deployment trigger: 2025-11-22 16:24:45 UTC
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { UPCOMING_WINDOW_HOURS } from "../_shared/config.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  // ============================================================================
  // cron-warmup-odds: Production cron job for automated odds & selections refresh
  // ============================================================================
  // Called by pg_cron every 30 minutes
  // Runs batched backfill-odds → optimize-selections-refresh pipeline
  // Always returns HTTP 200 for pg_cron stability
  // ============================================================================
  
  const jobName = 'cron-warmup-odds';
  let lockAcquired = false;
  let supabase: any = null;

  try {
    // 1. Initialize Supabase service role client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Validate cron key from DB (case-insensitive header, NO .single() on scalar RPC)
    const cronKey = req.headers.get('x-cron-key') ?? req.headers.get('X-CRON-KEY');
    const { data: expectedKey, error: keyError } = await supabase.rpc('get_cron_internal_key');
    
    // Safe string comparison with trim
    const expectedKeyStr = String(expectedKey || "").trim();
    const providedKeyStr = String(cronKey || "").trim();
    
    if (keyError || !expectedKeyStr || !providedKeyStr || providedKeyStr !== expectedKeyStr) {
      console.error('[cron-warmup-odds] Unauthorized: Invalid or missing X-CRON-KEY');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Try to acquire lock
    const { data: lockResult, error: lockError } = await supabase.rpc('acquire_cron_lock', {
      p_job_name: jobName,
      p_duration_minutes: 60
    });

    if (lockError) {
      console.error('[cron-warmup-odds] Lock error:', lockError);
      return new Response(
        JSON.stringify({ error: 'Failed to acquire lock', details: lockError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!lockResult) {
      console.log('[cron-warmup-odds] Job already running, skipping');
      return new Response(
        JSON.stringify({ status: 'skipped', reason: 'Job already running' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    lockAcquired = true;
    console.log('[cron-warmup-odds] Lock acquired, starting job');

    // 4. Parse window_hours (default 48h for cron)
    const { window_hours = UPCOMING_WINDOW_HOURS } = await req.json().catch(() => ({ window_hours: UPCOMING_WINDOW_HOURS }));
    console.log(`[cron-warmup-odds] Processing ${window_hours}h window`);

    // 5. Call batched backfill-odds once (processes up to 30 fixtures)
    console.log(`[cron-warmup-odds] Step 1: Calling backfill-odds (batch mode, window=${window_hours}h)...`);
    let backfillOk = false;
    let backfillError = null;
    let backfillData: any = null;
    let backfillScanned = 0;
    let backfillFetched = 0;
    
    try {
      const backfillUrl = `${supabaseUrl}/functions/v1/backfill-odds`;
      const backfillResponse = await fetch(backfillUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ window_hours })
      });
      
      if (!backfillResponse.ok) {
        const errorText = await backfillResponse.text().catch(() => 'No response body');
        backfillError = `backfill-odds failed with status ${backfillResponse.status}: ${errorText.substring(0, 200)}`;
        console.error('[cron-warmup-odds]', backfillError);
      } else {
        backfillData = await backfillResponse.json();
        backfillOk = true;
        backfillScanned = backfillData.scanned || 0;
        backfillFetched = backfillData.fetched || 0;
        console.log(`[cron-warmup-odds] backfill-odds success: scanned=${backfillScanned}, fetched=${backfillFetched}`);
      }
    } catch (err: any) {
      backfillError = `backfill-odds exception: ${err.message}`;
      console.error('[cron-warmup-odds]', backfillError);
    }

    // 6. Call optimize-selections-refresh once (uses latest stats + odds)
    console.log(`[cron-warmup-odds] Step 2: Calling optimize-selections-refresh (window=${window_hours}h)...`);
    let optimizeOk = false;
    let optimizeError = null;
    let optimizeData: any = null;
    let optimizeScanned = 0;
    let optimizeUpserted = 0;
    
    try {
      const optimizeUrl = `${supabaseUrl}/functions/v1/optimize-selections-refresh`;
      const optimizeResponse = await fetch(optimizeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ window_hours })
      });
      
      if (!optimizeResponse.ok) {
        const errorText = await optimizeResponse.text().catch(() => 'No response body');
        optimizeError = `optimize-selections-refresh failed with status ${optimizeResponse.status}: ${errorText.substring(0, 200)}`;
        console.error('[cron-warmup-odds]', optimizeError);
      } else {
        optimizeData = await optimizeResponse.json();
        optimizeOk = true;
        optimizeScanned = optimizeData.scanned || 0;
        optimizeUpserted = optimizeData.upserted || 0;
        console.log(`[cron-warmup-odds] optimize-selections-refresh success: scanned=${optimizeScanned}, upserted=${optimizeUpserted}`);
      }
    } catch (err: any) {
      optimizeError = `optimize-selections-refresh exception: ${err.message}`;
      console.error('[cron-warmup-odds]', optimizeError);
    }

    // 7. Log comprehensive run details with metrics from both steps
    const durationMs = Date.now() - startTime;
    const totalFailed = (backfillOk ? 0 : 1) + (optimizeOk ? 0 : 1);
    const overallSuccess = backfillOk && optimizeOk;
    
    console.log(`[cron-warmup-odds] Complete in ${durationMs}ms (backfill: ${backfillOk ? 'OK' : 'FAIL'}, optimize: ${optimizeOk ? 'OK' : 'FAIL'})`);
    console.log(`[cron-warmup-odds] Metrics: backfill=${backfillScanned} scanned/${backfillFetched} fetched, optimize=${optimizeScanned} scanned/${optimizeUpserted} upserted`);
    
    // Log to optimizer_run_logs (existing behavior)
    const { error: logError } = await supabase.from('optimizer_run_logs').insert({
      id: crypto.randomUUID(),
      run_type: 'cron-warmup-odds',
      window_start: new Date().toISOString(),
      window_end: new Date(Date.now() + window_hours * 60 * 60 * 1000).toISOString(),
      scope: {
        trigger: 'cron',
        window_hours,
        backfill_ok: backfillOk,
        optimize_ok: optimizeOk,
        backfill_scanned: backfillScanned,
        backfill_fetched: backfillFetched,
        optimize_scanned: optimizeScanned,
        optimize_upserted: optimizeUpserted
      },
      scanned: optimizeScanned,
      upserted: optimizeUpserted,
      with_odds: backfillFetched,
      failed: totalFailed,
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: durationMs
    });

    if (logError) {
      console.error('[cron-warmup-odds] Failed to log to optimizer_run_logs:', logError.message);
    }

    // NEW: Also log to pipeline_run_logs for unified monitoring dashboard
    const { error: pipelineLogError } = await supabase.from('pipeline_run_logs').insert({
      job_name: 'cron-warmup-odds',
      run_started: new Date(startTime).toISOString(),
      run_finished: new Date().toISOString(),
      success: overallSuccess,
      mode: 'cron',
      processed: optimizeUpserted + backfillFetched,
      failed: totalFailed,
      leagues_covered: [],
      details: {
        backfill_ok: backfillOk,
        backfill_scanned: backfillScanned,
        backfill_fetched: backfillFetched,
        backfill_error: backfillError,
        optimize_ok: optimizeOk,
        optimize_scanned: optimizeScanned,
        optimize_upserted: optimizeUpserted,
        optimize_error: optimizeError,
        window_hours,
        duration_ms: durationMs
      },
      error_message: !overallSuccess ? [backfillError, optimizeError].filter(Boolean).join(' | ') : null
    });

    if (pipelineLogError) {
      console.error('[cron-warmup-odds] Failed to log to pipeline_run_logs:', pipelineLogError.message);
    } else {
      console.log('[cron-warmup-odds] ✅ Logged to pipeline_run_logs');
    }

    // 7b. Clean up stale results-refresh entries older than 1 hour
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: staleRuns, error: staleError } = await supabase
        .from('pipeline_run_logs')
        .update({
          run_finished: new Date().toISOString(),
          success: false,
          error_message: 'stale_run_cleanup: job exceeded 1 hour without completion'
        })
        .eq('job_name', 'results-refresh')
        .is('run_finished', null)
        .lt('run_started', oneHourAgo)
        .select('id');
      
      if (staleError) {
        console.warn('[cron-warmup-odds] Failed to cleanup stale results-refresh runs:', staleError.message);
      } else if (staleRuns && staleRuns.length > 0) {
        console.log(`[cron-warmup-odds] 🧹 Cleaned up ${staleRuns.length} stale results-refresh entries`);
      }
    } catch (cleanupErr: any) {
      console.warn('[cron-warmup-odds] Exception during stale run cleanup:', cleanupErr.message);
    }

    // 8. Always return HTTP 200 for pg_cron stability (even if steps failed)
    return new Response(
      JSON.stringify({
        ok: true,
        job: 'cron-warmup-odds',
        window_hours,
        backfill: {
          status: backfillOk ? 'success' : 'failed',
          scanned: backfillScanned,
          fetched: backfillFetched,
          error: backfillError
        },
        optimize: {
          status: optimizeOk ? 'success' : 'failed',
          scanned: optimizeScanned,
          upserted: optimizeUpserted,
          error: optimizeError
        },
        duration_ms: durationMs
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  } catch (error: any) {
    console.error('[cron-warmup-odds] Unexpected error:', error);
    
    // Log failed run
    if (supabase) {
      try {
        const finishTime = Date.now();
        await supabase.from('optimizer_run_logs').insert({
          run_type: 'cron-warmup-odds',
          window_start: new Date(startTime).toISOString(),
          window_end: new Date(startTime).toISOString(),
          scanned: 0,
          with_odds: 0,
          upserted: 0,
          skipped: 0,
          failed: 1,
          started_at: new Date(startTime).toISOString(),
          finished_at: new Date(finishTime).toISOString(),
          duration_ms: finishTime - startTime,
          notes: `Critical error: ${error.message}`,
          scope: { trigger: 'cron', crashed: true }
        });
      } catch (logErr) {
        console.error('[cron-warmup-odds] Failed to log error run:', logErr);
      }
    }

    // STILL return 200 to avoid killing cron
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } finally {
    // ALWAYS release lock in finally block
    if (lockAcquired && supabase) {
      try {
        await supabase.rpc('release_cron_lock', { p_job_name: jobName });
        console.log('[cron-warmup-odds] Lock released');
      } catch (releaseErr) {
        console.error('[cron-warmup-odds] Failed to release lock:', releaseErr);
      }
    }
  }
});
