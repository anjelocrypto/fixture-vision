REVOKE EXECUTE ON FUNCTION public.acquire_cron_lock(text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.acquire_cron_lock(text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.acquire_cron_lock(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_cron_lock(text, integer) TO service_role;