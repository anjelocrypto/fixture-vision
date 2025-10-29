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

  try {
    // 1. Validate cron key
    const cronKey = req.headers.get('X-CRON-KEY');
    const expectedKey = Deno.env.get('CRON_INTERNAL_KEY');
    
    if (!cronKey || cronKey !== expectedKey) {
      console.error('[cron-warmup-odds] Unauthorized: Invalid or missing X-CRON-KEY');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Initialize Supabase service role client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 3. Try to acquire lock
    const { data: lockAcquired, error: lockError } = await supabase.rpc('acquire_cron_lock', {
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

    if (!lockAcquired) {
      console.log('[cron-warmup-odds] Job already running, skipping');
      return new Response(
        JSON.stringify({ status: 'skipped', reason: 'Job already running' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[cron-warmup-odds] Lock acquired, starting job');

    // 4. Parse window_hours
    const { window_hours = 72 } = await req.json().catch(() => ({ window_hours: 72 }));

    console.log(`[cron-warmup-odds] Warming up odds for next ${window_hours}h`);

    // 5. Call backfill-odds
    console.log('[cron-warmup-odds] Step 1: Calling backfill-odds...');
    const backfillResponse = await supabase.functions.invoke('backfill-odds', {
      body: { window_hours }
    });

    if (backfillResponse.error) {
      throw new Error(`backfill-odds failed: ${backfillResponse.error.message}`);
    }

    console.log('[cron-warmup-odds] backfill-odds result:', backfillResponse.data);

    // 6. Call optimize-selections-refresh
    console.log('[cron-warmup-odds] Step 2: Calling optimize-selections-refresh...');
    const optimizeResponse = await supabase.functions.invoke('optimize-selections-refresh', {
      body: { window_hours }
    });

    if (optimizeResponse.error) {
      throw new Error(`optimize-selections-refresh failed: ${optimizeResponse.error.message}`);
    }

    console.log('[cron-warmup-odds] optimize-selections-refresh result:', optimizeResponse.data);

    const finishTime = Date.now();
    const durationMs = finishTime - startTime;

    console.log(`[cron-warmup-odds] Complete in ${durationMs}ms`);

    // 7. Log run
    const now = new Date();
    const windowEnd = new Date(now.getTime() + window_hours * 60 * 60 * 1000);

    await supabase.from('optimizer_run_logs').insert({
      run_type: 'cron-warmup-odds',
      window_start: now.toISOString(),
      window_end: windowEnd.toISOString(),
      scanned: (backfillResponse.data?.scanned || 0) + (optimizeResponse.data?.scanned || 0),
      with_odds: backfillResponse.data?.fetched || 0,
      upserted: optimizeResponse.data?.upserted || 0,
      skipped: (backfillResponse.data?.skipped || 0) + (optimizeResponse.data?.skipped || 0),
      failed: (backfillResponse.data?.failed || 0) + (optimizeResponse.data?.failed || 0),
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date(finishTime).toISOString(),
      duration_ms: durationMs,
      notes: JSON.stringify({
        backfill: backfillResponse.data,
        optimize: optimizeResponse.data,
      }),
    });

    // 8. Release lock
    await supabase.rpc('release_cron_lock', { p_job_name: jobName });

    return new Response(
      JSON.stringify({
        success: true,
        window_hours,
        backfill: backfillResponse.data,
        optimize: optimizeResponse.data,
        duration_ms: durationMs,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[cron-warmup-odds] Unexpected error:', error);
    
    // Attempt to release lock on error
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      await supabase.rpc('release_cron_lock', { p_job_name: jobName });
    } catch (releaseErr) {
      console.error('[cron-warmup-odds] Failed to release lock on error:', releaseErr);
    }

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
