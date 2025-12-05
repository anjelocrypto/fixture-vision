import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ALLOWED_LEAGUE_IDS, getCountryIdForLeague } from '../_shared/leagues.ts';
import { apiHeaders, API_BASE } from '../_shared/api.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
};

const FETCH_TTL_HOURS = 2;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const jobName = 'cron-fetch-fixtures';

  try {
    // 1. Initialize Supabase service role client (needed for key validation)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Validate cron key from DB
    const cronKey = req.headers.get('X-CRON-KEY');
    const { data: expectedKey, error: keyError } = await supabase.rpc('get_cron_internal_key');
    
    if (keyError || !expectedKey || !cronKey || cronKey !== expectedKey) {
      console.error('[cron-fetch-fixtures] Unauthorized: Invalid or missing X-CRON-KEY');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // 3. Try to acquire lock
    const { data: lockAcquired, error: lockError } = await supabase.rpc('acquire_cron_lock', {
      p_job_name: jobName,
      p_duration_minutes: 30
    });

    if (lockError) {
      console.error('[cron-fetch-fixtures] Lock error:', lockError);
      return new Response(
        JSON.stringify({ error: 'Failed to acquire lock', details: lockError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!lockAcquired) {
      console.log('[cron-fetch-fixtures] Job already running, skipping');
      return new Response(
        JSON.stringify({ status: 'skipped', reason: 'Job already running' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[cron-fetch-fixtures] Lock acquired, starting job');

    // 4. Parse window_hours (default to 48h per UPCOMING_WINDOW_HOURS)
    const { window_hours = 48 } = await req.json().catch(() => ({ window_hours: 48 }));
    const now = new Date();
    const windowEnd = new Date(now.getTime() + window_hours * 60 * 60 * 1000);

    console.log(`[cron-fetch-fixtures] Fetching fixtures for next ${window_hours}h (${now.toISOString()} to ${windowEnd.toISOString()})`);

    // 5. Fetch existing fixtures to avoid redundant fetches
    const fetchCutoff = new Date(now.getTime() - FETCH_TTL_HOURS * 60 * 60 * 1000);
    const { data: existingFixtures } = await supabase
      .from('fixtures')
      .select('id, updated_at')
      .gte('updated_at', fetchCutoff.toISOString());

    const recentFixtureIds = new Set(existingFixtures?.map(f => f.id) || []);

    // 6. Fetch fixtures from API
    let totalApiCalls = 0;
    let leaguesProcessed = 0;
    let fixturesInserted = 0;
    let fixturesUpdated = 0;
    let fixturesSkipped = 0;
    let fixturesFailed = 0;
    const failureReasons: Record<string, number> = {};

    const dates = [];
    for (let i = 0; i <= 3; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }

    for (const leagueId of ALLOWED_LEAGUE_IDS) {
      leaguesProcessed++;

      for (const dateStr of dates) {
        try {
          const url = `${API_BASE}/fixtures?league=${leagueId}&season=2025&date=${dateStr}`;
          const response = await fetch(url, { headers: apiHeaders() });
          totalApiCalls++;

          if (!response.ok) {
            console.error(`[cron-fetch-fixtures] API error ${response.status} for league ${leagueId} on ${dateStr}`);
            failureReasons[`api_${response.status}`] = (failureReasons[`api_${response.status}`] || 0) + 1;
            continue;
          }

          const apiResponse = await response.json();

          if (!apiResponse?.response || apiResponse.response.length === 0) {
            continue;
          }

          // Filter fixtures within window
          const relevantFixtures = apiResponse.response.filter((f: any) => {
            const fixtureDate = new Date(f.fixture.date);
            return fixtureDate >= now && fixtureDate <= windowEnd &&
              (f.fixture.status.short === 'NS' || f.fixture.status.short === 'TBD');
          });

          console.log(`[cron-fetch-fixtures] League ${leagueId} on ${dateStr}: ${relevantFixtures.length} fixtures`);

          // Upsert league WITH CORRECT COUNTRY_ID using deterministic mapping
          const leagueData = apiResponse.response[0]?.league;
          if (leagueData) {
            // ⚠️ CRITICAL: Use deterministic country mapping to prevent country_id being overwritten to NULL
            const countryId = await getCountryIdForLeague(leagueData.id, supabase);
            
            await supabase.from('leagues').upsert({
              id: leagueData.id,
              name: leagueData.name,
              logo: leagueData.logo,
              season: leagueData.season,
              country_id: countryId,
            }, { onConflict: 'id' });
          }

          // Upsert fixtures
          for (const f of relevantFixtures) {
            const fixtureId = f.fixture.id;

            if (recentFixtureIds.has(fixtureId)) {
              fixturesSkipped++;
              continue;
            }

            try {
              const { error: upsertError } = await supabase.from('fixtures').upsert({
                id: fixtureId,
                date: f.fixture.date.split('T')[0],
                timestamp: Math.floor(new Date(f.fixture.date).getTime() / 1000),
                league_id: f.league.id,
                status: f.fixture.status.short,
                teams_home: f.teams.home,
                teams_away: f.teams.away,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'id' });

              if (upsertError) {
                fixturesFailed++;
                failureReasons[upsertError.message] = (failureReasons[upsertError.message] || 0) + 1;
              } else {
                if (recentFixtureIds.has(fixtureId)) {
                  fixturesUpdated++;
                } else {
                  fixturesInserted++;
                }
              }
            } catch (err: any) {
              fixturesFailed++;
              failureReasons[err.message] = (failureReasons[err.message] || 0) + 1;
            }
          }

          // Rate limit: 30 RPM
          await new Promise(resolve => setTimeout(resolve, 2100));
        } catch (err: any) {
          console.error(`[cron-fetch-fixtures] Error fetching league ${leagueId} on ${dateStr}:`, err.message);
        }
      }
    }

    const finishTime = Date.now();
    const durationMs = finishTime - startTime;

    console.log(`[cron-fetch-fixtures] Complete: ${totalApiCalls} API calls, ${leaguesProcessed} leagues, ${fixturesInserted} inserted, ${fixturesUpdated} updated, ${fixturesSkipped} skipped, ${fixturesFailed} failed in ${durationMs}ms`);

    // 7. Log run
    await supabase.from('optimizer_run_logs').insert({
      run_type: 'cron-fetch-fixtures',
      window_start: now.toISOString(),
      window_end: windowEnd.toISOString(),
      scanned: totalApiCalls,
      with_odds: 0,
      upserted: fixturesInserted + fixturesUpdated,
      skipped: fixturesSkipped,
      failed: fixturesFailed,
      started_at: new Date(startTime).toISOString(),
      finished_at: new Date(finishTime).toISOString(),
      duration_ms: durationMs,
      notes: JSON.stringify({
        api_calls: totalApiCalls,
        leagues: leaguesProcessed,
        inserted: fixturesInserted,
        updated: fixturesUpdated,
        failure_reasons: failureReasons,
      }),
    });

    // 8. Release lock
    await supabase.rpc('release_cron_lock', { p_job_name: jobName });

    return new Response(
      JSON.stringify({
        success: true,
        window_hours,
        api_calls: totalApiCalls,
        leagues: leaguesProcessed,
        inserted: fixturesInserted,
        updated: fixturesUpdated,
        skipped: fixturesSkipped,
        failed: fixturesFailed,
        duration_ms: durationMs,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[cron-fetch-fixtures] Unexpected error:', error);
    
    // Attempt to release lock on error
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      await supabase.rpc('release_cron_lock', { p_job_name: jobName });
    } catch (releaseErr) {
      console.error('[cron-fetch-fixtures] Failed to release lock on error:', releaseErr);
    }

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
