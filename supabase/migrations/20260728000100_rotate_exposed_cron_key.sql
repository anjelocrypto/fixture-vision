-- Rotate the cron credential that appeared in the public repository history.
-- Scheduled jobs call get_cron_internal_key() at execution time, so they begin
-- using this new value without embedding it in cron.job.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'CRON_INTERNAL_KEY',
  encode(gen_random_bytes(32), 'hex'),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = EXCLUDED.updated_at;

REVOKE ALL ON FUNCTION public.get_cron_internal_key() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_internal_key() TO service_role;
