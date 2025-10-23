-- Set up cron job for stats refresh (runs every 30 minutes)
SELECT cron.schedule(
  'stats-refresh-job',
  '*/30 * * * *', -- Every 30 minutes
  $$
  SELECT
    net.http_post(
      url:=concat(current_setting('app.settings.supabase_url'), '/functions/v1/stats-refresh'),
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', concat('Bearer ', current_setting('app.settings.service_role_key'))
      ),
      body:=jsonb_build_object('time', now())
    ) as request_id;
  $$
);

-- Store required settings for cron job
DO $$
BEGIN
  -- These will be populated automatically by Supabase
  PERFORM set_config('app.settings.supabase_url', current_setting('SUPABASE_URL', true), false);
  PERFORM set_config('app.settings.service_role_key', current_setting('SUPABASE_SERVICE_ROLE_KEY', true), false);
EXCEPTION
  WHEN others THEN
    -- Settings will be available at runtime
    NULL;
END $$;