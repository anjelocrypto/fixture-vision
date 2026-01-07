-- Fix: Add LIMIT 1 to get_cron_internal_key for deterministic results
CREATE OR REPLACE FUNCTION public.get_cron_internal_key()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT value FROM public.app_settings WHERE key = 'CRON_INTERNAL_KEY' LIMIT 1;
$$;

-- Ensure proper grants for cron usage
REVOKE ALL ON FUNCTION public.get_cron_internal_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cron_internal_key() TO postgres, service_role, authenticated;