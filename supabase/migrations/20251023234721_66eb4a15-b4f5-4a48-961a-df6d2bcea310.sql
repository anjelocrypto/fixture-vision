
-- Schedule the full refresh pipeline
-- Every 2 hours: stats → odds → selections
SELECT cron.schedule(
  'full-refresh-pipeline',
  '0 */2 * * *',
  $$
  -- First stats-refresh
  SELECT net.http_post(
    url:='https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/stats-refresh',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGtwenJpc3ZxZ3hhZHhia3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjU5MzcsImV4cCI6MjA3Njc0MTkzN30.EnyLh7gSyeldcQo5qJBr5O_D55p_IM52x2xIBmIZlpE'
    ),
    body:='{}'::jsonb
  );
  $$
);

-- 5 minutes after stats: backfill odds
SELECT cron.schedule(
  'backfill-odds-job',
  '5 */2 * * *',
  $$
  SELECT net.http_post(
    url:='https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/backfill-odds',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGtwenJpc3ZxZ3hhZHhia3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjU5MzcsImV4cCI6MjA3Njc0MTkzN30.EnyLh7gSyeldcQo5qJBr5O_D55p_IM52x2xIBmIZlpE'
    ),
    body:='{}'::jsonb,
    timeout_milliseconds:=300000
  );
  $$
);

-- 10 minutes after stats: optimize selections  
SELECT cron.schedule(
  'optimize-selections-job',
  '10 */2 * * *',
  $$
  SELECT net.http_post(
    url:='https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/optimize-selections-refresh',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGtwenJpc3ZxZ3hhZHhia3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjU5MzcsImV4cCI6MjA3Njc0MTkzN30.EnyLh7gSyeldcQo5qJBr5O_D55p_IM52x2xIBmIZlpE'
    ),
    body:='{}'::jsonb
  );
  $$
);

-- Frequent refresh for near-term fixtures (every 15 minutes for fixtures within 3 hours)
SELECT cron.schedule(
  'nearterm-refresh',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url:='https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/optimize-selections-refresh',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1dGtwenJpc3ZxZ3hhZHhia3hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjExNjU5MzcsImV4cCI6MjA3Njc0MTkzN30.EnyLh7gSyeldcQo5qJBr5O_D55p_IM52x2xIBmIZlpE'
    ),
    body:='{}'::jsonb
  );
  $$
);
