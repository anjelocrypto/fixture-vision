-- Enable required extensions for cron jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Unschedule existing job if it exists (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('stats-refresh-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Schedule daily stats refresh at 03:05 UTC
SELECT cron.schedule(
  'stats-refresh-daily',
  '5 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/stats-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-CRON-KEY', public.get_cron_internal_key()
    ),
    body := jsonb_build_object(
      'window_hours', 120,
      'stats_ttl_hours', 24
    )
  );
  $$
);