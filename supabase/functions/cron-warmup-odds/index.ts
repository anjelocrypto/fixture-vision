import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const jobName = 'cron-warmup-odds';
  let lockAcquired = false;
  let supabase: any = null;

  try {
    // 1. Initialize Supabase service role client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Validate cron key from DB
    const cronKey = req.headers.get('X-CRON-KEY');
    const { data: expectedKey, error: keyError } = await supabase.rpc('get_cron_internal_key');
    
    if (keyError || !expectedKey || !cronKey || cronKey !== expectedKey) {
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

    // 4. Parse window_hours
    const { window_hours = 120 } = await req.json().catch(() => ({ window_hours: 120 }));
    console.log(`[cron-warmup-odds] Warming up odds for next ${window_hours}h`);

    // 5. Call backfill-odds (don't throw on error, capture it)
    console.log('[cron-warmup-odds] Step 1: Calling backfill-odds...');
    let backfillOk = false;
    let backfillData: any = null;
    let backfillError: string | null = null;

    try {
      const backfillResponse = await supabase.functions.invoke('backfill-odds', {
        body: { window_hours }
      });

      if (backfillResponse.error) {
        backfillError = `backfill-odds error: ${JSON.stringify(backfillResponse.error)}`;
        console.error('[cron-warmup-odds]', backfillError);
      } else {
        backfillOk = true;
        backfillData = backfillResponse.data;
        console.log('[cron-warmup-odds] backfill-odds success:', backfillData);
      }
    } catch (err: any) {
      backfillError = `backfill-odds exception: ${err.message}`;
      console.error('[cron-warmup-odds]', backfillError);
    }

    // 6. Call optimize-selections-refresh (don't throw on error, capture it)
    console.log('[cron-warmup-odds] Step 2: Calling optimize-selections-refresh...');
    let optimizeOk = false;
    let optimizeData: any = null;
    let optimizeError: string | null = null;

    try {
      const optimizeResponse = await supabase.functions.invoke('optimize-selections-refresh', {
        body: { window_hours }
      });

      if (optimizeResponse.error) {
        optimizeError = `optimize-selections-refresh error: ${JSON.stringify(optimizeResponse.error)}`;
        console.error('[cron-warmup-odds]', optimizeError);
      } else {
        optimizeOk = true;
        optimizeData = optimizeResponse.data;
        console.log('[cron-warmup-odds] optimize-selections-refresh success:', optimizeData);
      }
    } catch (err: any) {
      optimizeError = `optimize-selections-refresh exception: ${err.message}`;
      console.error('[cron-warmup-odds]', optimizeError);
    }

    const finishTime = Date.now();
    const durationMs = finishTime - startTime;

    const totalFailed = (backfillOk ? 0 : 1) + (optimizeOk ? 0 : 1);
    console.log(`[cron-warmup-odds] Complete in ${durationMs}ms (backfill: ${backfillOk ? 'OK' : 'FAIL'}, optimize: ${optimizeOk ? 'OK' : 'FAIL'})`);

    // 7. Log run to optimizer_run_logs (ALWAYS, even on partial failure)
    const now = new Date(startTime);
    const windowEnd = new Date(now.getTime() + window_hours * 60 * 60 * 1000);

    await supabase.from('optimizer_run_logs').insert({
      run_type: 'cron-warmup-odds',
      window_start: now.toISOString(),
      window_end: windowEnd.toISOString(),
      scanned: (backfillData?.scanned || 0) + (optimizeData?.scanned || 0),
      with_odds: backfillData?.fetched || 0,
      upserted: optimizeData?.upserted || 0,
      skipped: (backfillData?.skipped || 0) + (optimizeData?.skipped || 0),
      failed: totalFailed,
      started_at: now.toISOString(),
      finished_at: new Date(finishTime).toISOString(),
      duration_ms: durationMs,
      notes: backfillError || optimizeError 
        ? `Errors: ${backfillError || ''} ${optimizeError || ''}`.trim()
        : null,
      scope: {
        window_hours,
        trigger: 'cron',
        backfill_ok: backfillOk,
        optimize_ok: optimizeOk,
      }
    });

    // 8. ALWAYS return 200 to keep pg_cron happy
    return new Response(
      JSON.stringify({
        ok: backfillOk && optimizeOk,
        window_hours,
        steps: {
          backfill: { ok: backfillOk, data: backfillData, error: backfillError },
          optimize: { ok: optimizeOk, data: optimizeData, error: optimizeError }
        },
        duration_ms: durationMs,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
