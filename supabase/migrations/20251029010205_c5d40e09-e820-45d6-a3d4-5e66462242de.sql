-- 1) Create app_settings table for secure key storage
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Only service role may read
DROP POLICY IF EXISTS "service read app_settings" ON public.app_settings;
CREATE POLICY "service read app_settings"
  ON public.app_settings FOR SELECT
  USING (auth.role() = 'service_role');

-- Insert the CRON_INTERNAL_KEY
INSERT INTO public.app_settings (key, value)
VALUES ('CRON_INTERNAL_KEY', 'crk_8F3xN2wGQeY5pK1rT7uV9b4M6aZ0sD2H')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value, updated_at = now();

-- 2) SECURITY DEFINER getter (bypasses RLS safely)
CREATE OR REPLACE FUNCTION public.get_cron_internal_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT value FROM public.app_settings WHERE key = 'CRON_INTERNAL_KEY';
$$;

-- Lock down execution of the definer function (VERY IMPORTANT)
REVOKE ALL ON FUNCTION public.get_cron_internal_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cron_internal_key() TO service_role;

-- 3) Ensure extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 4) Unschedule old jobs if they exist (using DO block for error handling)
DO $$
BEGIN
  PERFORM cron.unschedule('fetch-fixtures-72h-every-12h');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('warmup-odds-72h-every-12h');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 5) Schedule: Fetch fixtures every 12h (72h window)
SELECT cron.schedule(
  'fetch-fixtures-72h-every-12h',
  '0 */12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/cron-fetch-fixtures',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'X-CRON-KEY', public.get_cron_internal_key()
    ),
    body := jsonb_build_object('window_hours',72)
  );
  $$
);

-- 6) Schedule: Warmup odds 30 minutes later (72h window)
SELECT cron.schedule(
  'warmup-odds-72h-every-12h',
  '30 */12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/cron-warmup-odds',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'X-CRON-KEY', public.get_cron_internal_key()
    ),
    body := jsonb_build_object('window_hours',72)
  );
  $$
);