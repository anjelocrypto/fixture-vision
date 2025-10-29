-- Fix permissions on get_cron_internal_key function
-- First revoke all permissions
REVOKE ALL ON FUNCTION public.get_cron_internal_key() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cron_internal_key() FROM anon;
REVOKE ALL ON FUNCTION public.get_cron_internal_key() FROM authenticated;

-- Grant ONLY to postgres and service_role
GRANT EXECUTE ON FUNCTION public.get_cron_internal_key() TO postgres;
GRANT EXECUTE ON FUNCTION public.get_cron_internal_key() TO service_role;