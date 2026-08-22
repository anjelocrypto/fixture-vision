-- 1. app_settings: remove broad table grants from anon/authenticated
REVOKE ALL ON TABLE public.app_settings FROM anon;
REVOKE ALL ON TABLE public.app_settings FROM authenticated;
REVOKE ALL ON TABLE public.app_settings FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_settings TO service_role;

-- 2. Trigger-only functions: not directly callable by clients
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

REVOKE ALL ON FUNCTION public.update_fixtures_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_fixtures_updated_at() FROM anon;
REVOKE ALL ON FUNCTION public.update_fixtures_updated_at() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_fixtures_updated_at() TO service_role;

-- 3. Leftover from Phase 2A: release_cron_lock still callable by authenticated
REVOKE ALL ON FUNCTION public.release_cron_lock(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_cron_lock(text) FROM anon;
REVOKE ALL ON FUNCTION public.release_cron_lock(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_cron_lock(text) TO service_role;

-- 4. Pause (do not delete) zero-output / stale-season schedules
SELECT cron.alter_job(54, active := false); -- basketball-backfill
SELECT cron.alter_job(56, active := false); -- basketball-sync-fixtures
SELECT cron.alter_job(57, active := false); -- basketball-sync-results
SELECT cron.alter_job(58, active := false); -- basketball-stats-refresh
SELECT cron.alter_job(47, active := false); -- smoke-test-analytics-6h