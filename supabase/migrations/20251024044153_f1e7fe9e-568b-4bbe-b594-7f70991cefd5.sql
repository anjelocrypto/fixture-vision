-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop all existing cron jobs to avoid conflicts
DO $$
DECLARE
  job RECORD;
BEGIN
  FOR job IN SELECT jobname FROM cron.job
  LOOP
    PERFORM cron.unschedule(job.jobname);
  END LOOP;
END $$;

-- ============================================================================
-- TIER 1: Full 72-hour window (runs every 60 minutes)
-- ============================================================================

-- Stats refresh: 72-hour window, every 60 minutes
SELECT cron.schedule(
  'stats-refresh-72h',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/stats-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('window_hours', 72)
  );
  $$
);

-- Backfill odds: 72-hour window, every 60 minutes
SELECT cron.schedule(
  'backfill-72h-full',
  '2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/backfill-odds',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('window_hours', 72)
  );
  $$
);

-- Optimize selections: 72-hour window, every 60 minutes (offset +5 min)
SELECT cron.schedule(
  'optimize-72h-full',
  '7 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/optimize-selections-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('window_hours', 72)
  );
  $$
);

-- ============================================================================
-- TIER 2: Near-term (≤6h), runs every 15 minutes
-- ============================================================================

-- Backfill odds: 6-hour window, every 15 minutes
SELECT cron.schedule(
  'backfill-6h-near',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/backfill-odds',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('window_hours', 6)
  );
  $$
);

-- Optimize selections: 6-hour window, every 15 minutes (offset +5 min)
SELECT cron.schedule(
  'optimize-6h-near',
  '5,20,35,50 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/optimize-selections-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('window_hours', 6)
  );
  $$
);

-- ============================================================================
-- TIER 3: Imminent (≤1h), runs every 3 minutes
-- ============================================================================

-- Backfill odds: 1-hour window, every 3 minutes
SELECT cron.schedule(
  'backfill-1h-imminent',
  '*/3 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/backfill-odds',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('window_hours', 1)
  );
  $$
);

-- Optimize selections: 1-hour window, every 3 minutes (offset +1 min)
SELECT cron.schedule(
  'optimize-1h-imminent',
  '1,4,7,10,13,16,19,22,25,28,31,34,37,40,43,46,49,52,55,58 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/optimize-selections-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('window_hours', 1)
  );
  $$
);

-- Set the service role key as a PostgreSQL setting (for cron jobs to use)
-- This must be run separately by an admin or in a migration that has access to the service role key
-- For now, we'll document this requirement
COMMENT ON EXTENSION pg_cron IS 'Requires: ALTER DATABASE postgres SET app.settings.service_role_key = ''<SUPABASE_SERVICE_ROLE_KEY>'';';