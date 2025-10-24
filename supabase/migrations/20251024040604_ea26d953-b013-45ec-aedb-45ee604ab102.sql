-- Enable pg_cron and pg_net extensions for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Get environment variables (note: these will be replaced with actual values during execution)
-- Supabase URL: https://dutkpzrisvqgxadxbkxo.supabase.co
-- Service key is available in environment

-- Drop any existing cron jobs to avoid duplicates
SELECT cron.unschedule('stats-refresh-72h') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'stats-refresh-72h');
SELECT cron.unschedule('backfill-48h-full') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'backfill-48h-full');
SELECT cron.unschedule('optimize-48h-full') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'optimize-48h-full');
SELECT cron.unschedule('backfill-6h-near') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'backfill-6h-near');
SELECT cron.unschedule('optimize-6h-near') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'optimize-6h-near');
SELECT cron.unschedule('backfill-1h-imminent') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'backfill-1h-imminent');
SELECT cron.unschedule('optimize-1h-imminent') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'optimize-1h-imminent');

-- Schedule stats refresh every 2 hours
SELECT cron.schedule(
  'stats-refresh-72h',
  '0 */2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/stats-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGtwenJpc3ZxZ3hhZHhia3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjU5MzcsImV4cCI6MjA3Njc0MTkzN30.EnyLh7gSyeldcQo5qJBr5O_D55p_IM52x2xIBmIZlpE'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Every 2h: warm odds and optimize for next 48h
SELECT cron.schedule(
  'backfill-48h-full',
  '0 */2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/backfill-odds',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGtwenJpc3ZxZ3hhZHhia3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjU5MzcsImV4cCI6MjA3Njc0MTkzN30.EnyLh7gSyeldcQo5qJBr5O_D55p_IM52x2xIBmIZlpE'
    ),
    body := '{"window_hours":48}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'optimize-48h-full',
  '5 */2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/optimize-selections-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGtwenJpc3ZxZ3hhZHhia3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjU5MzcsImV4cCI6MjA3Njc0MTkzN30.EnyLh7gSyeldcQo5qJBr5O_D55p_IM52x2xIBmIZlpE'
    ),
    body := '{"window_hours":48}'::jsonb
  );
  $$
);

-- Every 30m: fixtures within 6h
SELECT cron.schedule(
  'backfill-6h-near',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/backfill-odds',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGtwenJpc3ZxZ3hhZHhia3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjU5MzcsImV4cCI6MjA3Njc0MTkzN30.EnyLh7gSyeldcQo5qJBr5O_D55p_IM52x2xIBmIZlpE'
    ),
    body := '{"window_hours":6}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'optimize-6h-near',
  '5,35 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/optimize-selections-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGtwenJpc3ZxZ3hhZHhia3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjU5MzcsImV4cCI6MjA3Njc0MTkzN30.EnyLh7gSyeldcQo5qJBr5O_D55p_IM52x2xIBmIZlpE'
    ),
    body := '{"window_hours":6}'::jsonb
  );
  $$
);

-- Every 10m: fixtures within 1h
SELECT cron.schedule(
  'backfill-1h-imminent',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/backfill-odds',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGtwenJpc3ZxZ3hhZHhia3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjU5MzcsImV4cCI6MjA3Njc0MTkzN30.EnyLh7gSyeldcQo5qJBr5O_D55p_IM52x2xIBmIZlpE'
    ),
    body := '{"window_hours":1}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'optimize-1h-imminent',
  '2,12,22,32,42,52 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/optimize-selections-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGtwenJpc3ZxZ3hhZHhia3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjU5MzcsImV4cCI6MjA3Njc0MTkzN30.EnyLh7gSyeldcQo5qJBr5O_D55p_IM52x2xIBmIZlpE'
    ),
    body := '{"window_hours":1}'::jsonb
  );
  $$
);