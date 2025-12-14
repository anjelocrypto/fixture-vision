-- ============================================================================
-- ZERO MANUAL BACKFILL AUTOMATION: Database Functions & Tables
-- ============================================================================

-- 1) Function: find fixtures that are missing results (for auto-backfill)
CREATE OR REPLACE FUNCTION public.get_fixtures_missing_results(
  lookback_days int DEFAULT 14,
  supported_leagues int[] DEFAULT ARRAY[39,40,78,140,135,61,2,3,848,45,48,66,81,137,143],
  batch_limit int DEFAULT 50
)
RETURNS TABLE (
  fixture_id bigint,
  fixture_league_id int,
  fixture_timestamp bigint,
  fixture_status text,
  fixture_teams_home jsonb,
  fixture_teams_away jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.id::bigint          AS fixture_id,
    f.league_id::int      AS fixture_league_id,
    f.timestamp::bigint   AS fixture_timestamp,
    f.status::text        AS fixture_status,
    f.teams_home          AS fixture_teams_home,
    f.teams_away          AS fixture_teams_away
  FROM fixtures f
  LEFT JOIN fixture_results fr
    ON f.id = fr.fixture_id
  WHERE
    -- kicked off more than 3 hours ago
    f.timestamp < EXTRACT(EPOCH FROM (now() - interval '3 hours'))
    -- but within the lookback window
    AND f.timestamp > EXTRACT(EPOCH FROM (now() - (lookback_days || ' days')::interval))
    -- only supported leagues
    AND f.league_id = ANY(supported_leagues)
    -- no fixture_results row yet
    AND fr.fixture_id IS NULL
  ORDER BY f.timestamp DESC
  LIMIT batch_limit;
$$;

-- 2) Table: pipeline_alerts for storing pipeline / data alerts
CREATE TABLE IF NOT EXISTS public.pipeline_alerts (
  id SERIAL PRIMARY KEY,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

-- Indexes for alerts
CREATE INDEX IF NOT EXISTS idx_pipeline_alerts_severity
  ON public.pipeline_alerts (severity)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_alerts_created
  ON public.pipeline_alerts (created_at DESC);

-- Enable RLS on alerts
ALTER TABLE public.pipeline_alerts ENABLE ROW LEVEL SECURITY;

-- RLS: admins can read alerts
CREATE POLICY "Admins can read pipeline alerts"
  ON public.pipeline_alerts
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS: service_role can fully manage alerts
CREATE POLICY "Service role can manage pipeline alerts"
  ON public.pipeline_alerts
  FOR ALL
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

-- Grants for alerts table + sequence
GRANT ALL ON public.pipeline_alerts TO service_role;
GRANT SELECT ON public.pipeline_alerts TO authenticated;

-- sequence name created by SERIAL; ensure service_role can use it
GRANT USAGE, SELECT ON SEQUENCE public.pipeline_alerts_id_seq TO service_role;

-- 3) Function: auto-release stuck cron locks (and log the action)
CREATE OR REPLACE FUNCTION public.auto_release_stuck_locks(max_age_minutes int DEFAULT 30)
RETURNS TABLE (
  released_job_name text,
  released_locked_at timestamptz,
  released_locked_until timestamptz,
  was_released boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lock_record RECORD;
BEGIN
  -- Find and delete locks older than max_age_minutes
  FOR lock_record IN 
    SELECT cjl.job_name, cjl.locked_at, cjl.locked_until
    FROM cron_job_locks cjl
    WHERE cjl.locked_until < now() - (max_age_minutes || ' minutes')::interval
  LOOP
    -- Delete the stuck lock
    DELETE FROM cron_job_locks
    WHERE cron_job_locks.job_name = lock_record.job_name;

    -- Log the release into pipeline_run_logs (table already exists)
    INSERT INTO pipeline_run_logs (
      job_name,
      run_started,
      run_finished,
      success,
      mode,
      processed,
      failed,
      details
    )
    VALUES (
      'auto-lock-release',
      now(),
      now(),
      true,
      'auto',
      1,
      0,
      jsonb_build_object(
        'released_lock', lock_record.job_name,
        'was_locked_until', lock_record.locked_until
      )
    );

    -- Return released lock info
    RETURN QUERY
      SELECT
        lock_record.job_name,
        lock_record.locked_at,
        lock_record.locked_until,
        true;
  END LOOP;

  RETURN;
END;
$$;

-- 4) View: pipeline_health_dashboard for aggregated pipeline status
CREATE OR REPLACE VIEW public.pipeline_health_dashboard AS
WITH missing_by_league AS (
  SELECT 
    f.league_id,
    l.name AS league_name,
    COUNT(*) AS total_fixtures,
    COUNT(fr.fixture_id) AS with_results,
    COUNT(*) - COUNT(fr.fixture_id) AS missing_results
  FROM fixtures f
  LEFT JOIN fixture_results fr
    ON f.id = fr.fixture_id
  LEFT JOIN leagues l
    ON f.league_id = l.id
  WHERE
    f.timestamp < EXTRACT(EPOCH FROM (now() - interval '3 hours'))
    AND f.timestamp > EXTRACT(EPOCH FROM (now() - interval '30 days'))
    AND f.league_id IN (39,40,78,140,135,61,2,3,848,45,48,66,81,137,143)
  GROUP BY f.league_id, l.name
),
job_status AS (
  SELECT 
    job_name,
    MAX(run_started) AS last_run,
    MAX(CASE WHEN success = true THEN run_started END) AS last_success,
    COUNT(*) FILTER (WHERE run_started > now() - interval '24 hours') AS runs_24h,
    COUNT(*) FILTER (WHERE success = false AND run_started > now() - interval '24 hours') AS failures_24h
  FROM pipeline_run_logs
  WHERE job_name IN ('results-refresh', 'stats-refresh', 'cron-warmup-odds', 'auto-backfill-results')
  GROUP BY job_name
),
lock_status AS (
  SELECT 
    COUNT(*) AS active_locks,
    COUNT(*) FILTER (WHERE locked_until < now() - interval '30 minutes') AS stuck_locks
  FROM cron_job_locks
),
alert_status AS (
  SELECT 
    COUNT(*) FILTER (WHERE severity = 'critical' AND resolved_at IS NULL) AS critical_alerts,
    COUNT(*) FILTER (WHERE severity = 'warning' AND resolved_at IS NULL) AS warning_alerts
  FROM pipeline_alerts
)
SELECT 
  now() AS checked_at,
  CASE 
    WHEN (SELECT COALESCE(SUM(missing_results), 0) FROM missing_by_league) > 10 THEN 'CRITICAL'
    WHEN (SELECT stuck_locks FROM lock_status) > 0 THEN 'CRITICAL'
    WHEN (SELECT critical_alerts FROM alert_status) > 0 THEN 'CRITICAL'
    WHEN (SELECT COALESCE(SUM(missing_results), 0) FROM missing_by_league) > 0 THEN 'WARNING'
    WHEN (SELECT warning_alerts FROM alert_status) > 0 THEN 'WARNING'
    ELSE 'OK'
  END AS overall_status,
  (SELECT COALESCE(SUM(missing_results), 0) FROM missing_by_league) AS total_missing_results,
  (SELECT jsonb_agg(
      jsonb_build_object(
        'league_id', league_id,
        'league_name', league_name,
        'total', total_fixtures,
        'with_results', with_results,
        'missing', missing_results
      )
    )
   FROM missing_by_league
   WHERE missing_results > 0
  ) AS missing_by_league,
  (SELECT jsonb_agg(
      jsonb_build_object(
        'job', job_name,
        'last_run', last_run,
        'last_success', last_success,
        'runs_24h', runs_24h,
        'failures_24h', failures_24h
      )
    )
   FROM job_status
  ) AS job_status,
  (SELECT jsonb_build_object(
      'active', active_locks,
      'stuck', stuck_locks
    )
   FROM lock_status
  ) AS locks,
  (SELECT jsonb_build_object(
      'critical', critical_alerts,
      'warning', warning_alerts
    )
   FROM alert_status
  ) AS alerts;

-- 5) Grants for functions and view
GRANT EXECUTE ON FUNCTION public.get_fixtures_missing_results(int, int[], int) TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_release_stuck_locks(int) TO service_role;

GRANT SELECT ON public.pipeline_health_dashboard TO authenticated, service_role;