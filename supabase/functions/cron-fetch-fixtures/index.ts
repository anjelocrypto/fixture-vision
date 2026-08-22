import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { ALLOWED_LEAGUE_IDS, getCountryIdForLeague } from '../_shared/leagues.ts';
import { apiHeaders, API_BASE } from '../_shared/api.ts';
import { UPCOMING_WINDOW_HOURS } from '../_shared/config.ts';
import { getFootballSeasonForLeague } from '../_shared/season.ts';
import { checkCronOrAdminAuth } from '../_shared/auth.ts';
import { readJsonWithLimit } from '../_shared/request.ts';
import {
  boundedRotatingSelection,
  clampProviderCallLimit,
  fetchWithProviderBudget,
  ProviderCallBudget,
  ProviderControlError,
} from '../_shared/provider_budget.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
};

const FETCH_TTL_HOURS = 2;
const MAX_PROVIDER_CALLS_PER_RUN = 12;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const jobName = 'fixtures-sync';
  let lockToken: string | null = null;
  let lockClient: any = null;

  try {
    // 1. Initialize Supabase service role client (needed for key validation)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    lockClient = supabase;

    const auth = await checkCronOrAdminAuth(
      req,
      supabase,
      supabaseServiceKey,
      '[cron-fetch-fixtures]',
    );
    if (!auth.authorized) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = (await readJsonWithLimit(req, 16_384).catch(() => null) ?? {}) as Record<string, unknown>;
    if (auth.method !== 'cron_key' && body.confirm_provider_calls !== true) {
      return new Response(
        JSON.stringify({ error: 'Manual provider calls require confirm_provider_calls=true' }),
        { status: 412, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const requestedLeagues = Array.isArray(body.league_ids)
      ? [...new Set(body.league_ids.map(Number).filter((id) => ALLOWED_LEAGUE_IDS.includes(id)))]
      : ALLOWED_LEAGUE_IDS;
    const providerBudget = new ProviderCallBudget(
      clampProviderCallLimit(body.max_provider_calls, MAX_PROVIDER_CALLS_PER_RUN),
    );
    // 3. Try to acquire lock
    const { data: acquiredToken, error: lockError } = await supabase.rpc('acquire_cron_lease', {
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

    if (!acquiredToken) {
      console.log('[cron-fetch-fixtures] Job already running, skipping');
      return new Response(
        JSON.stringify({ status: 'skipped', reason: 'Job already running' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    lockToken = acquiredToken;
    console.log('[cron-fetch-fixtures] Lock acquired, starting job');

    // 4. ALWAYS use UPCOMING_WINDOW_HOURS from config (ignores any body override)
    // This ensures 48h is the single source of truth even if cron passes 120
    const window_hours = UPCOMING_WINDOW_HOURS;
    const now = new Date();
    const windowEnd = new Date(now.getTime() + window_hours * 60 * 60 * 1000);

    console.log(`[cron-fetch-fixtures] Fetching fixtures for next ${window_hours}h (${now.toISOString()} to ${windowEnd.toISOString()}) [forced from UPCOMING_WINDOW_HOURS]`);

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

    const dates: string[] = [];
    const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const finalInstant = new Date(Math.max(now.getTime(), windowEnd.getTime() - 1));
    const finalDate = new Date(Date.UTC(
      finalInstant.getUTCFullYear(),
      finalInstant.getUTCMonth(),
      finalInstant.getUTCDate(),
    ));
    while (cursor <= finalDate) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const fullPlan = requestedLeagues.flatMap((leagueId) =>
      dates.map((date) => ({ leagueId, date }))
    );
    const rotationBucket = Math.floor(now.getTime() / (10 * 60 * 1000));
    const runPlan = boundedRotatingSelection(fullPlan, providerBudget.limit, rotationBucket);
    const processedLeagues = new Set<number>();

    for (const { leagueId, date: dateStr } of runPlan) {
      processedLeagues.add(leagueId);
      const season = getFootballSeasonForLeague(leagueId, now);
      try {
          const url = `${API_BASE}/fixtures?league=${leagueId}&season=${season}&date=${dateStr}`;
          const response = await fetchWithProviderBudget(url, { headers: apiHeaders() }, providerBudget);
          totalApiCalls = providerBudget.used;

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

          await new Promise(resolve => setTimeout(resolve, 1200));
        } catch (err: any) {
          totalApiCalls = providerBudget.used;
          if (err instanceof ProviderControlError) {
            failureReasons[err.reason] = (failureReasons[err.reason] || 0) + 1;
            console.warn(`[cron-fetch-fixtures] Provider stop: ${err.reason}`);
            break;
          }
          failureReasons.network_error = (failureReasons.network_error || 0) + 1;
          console.error(`[cron-fetch-fixtures] Error fetching league ${leagueId} on ${dateStr}:`, err.message);
        }
    }
    leaguesProcessed = processedLeagues.size;

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
        provider: providerBudget.snapshot(),
        plan_items_total: fullPlan.length,
        plan_items_selected: runPlan.length,
      }),
    });

    return new Response(
      JSON.stringify({
        success: providerBudget.failures === 0 && !providerBudget.stoppedReason,
        window_hours,
        api_calls: totalApiCalls,
        leagues: leaguesProcessed,
        inserted: fixturesInserted,
        updated: fixturesUpdated,
        skipped: fixturesSkipped,
        failed: fixturesFailed,
        provider: providerBudget.snapshot(),
        work_remaining: fullPlan.length > runPlan.length,
        duration_ms: durationMs,
      }),
      {
        status: providerBudget.failures === 0 && !providerBudget.stoppedReason ? 200 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('[cron-fetch-fixtures] Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } finally {
    if (lockToken && lockClient) {
      const { data: released, error: releaseError } = await lockClient.rpc('release_cron_lease', {
        p_job_name: jobName,
        p_lock_token: lockToken,
      });
      if (releaseError || released !== true) {
        console.error('[cron-fetch-fixtures] Failed to release owned lease:', releaseError);
      }
    }
  }
});
