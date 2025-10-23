
-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension for HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule optimize-selections-refresh to run every 2 hours
SELECT cron.schedule(
  'refresh-optimized-selections',
  '0 */2 * * *', -- Every 2 hours
  $$
  SELECT
    net.http_post(
      url:='https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/optimize-selections-refresh',
      headers:=jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGtwenJpc3ZxZ3hhZHhia3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjU5MzcsImV4cCI6MjA3Njc0MTkzN30.EnyLh7gSyeldcQo5qJBr5O_D55p_IM52x2xIBmIZlpE'
      ),
      body:=jsonb_build_object('time', now()::text)
    ) as request_id;
  $$
);

-- Also trigger an immediate backfill by calling the job once
SELECT
  net.http_post(
    url:='https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/optimize-selections-refresh',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGtwenJpc3ZxZ3hhZHhia3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjU5MzcsImV4cCI6MjA3Njc0MTkzN30.EnyLh7gSyeldcQo5qJBr5O_D55p_IM52x2xIBmIZlpE'
    ),
    body:=jsonb_build_object('time', now()::text)
  ) as request_id;
