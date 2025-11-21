-- Grant execute permission on release_cron_lock to authenticated users
-- The function is already SECURITY DEFINER, so it runs with elevated privileges
GRANT EXECUTE ON FUNCTION public.release_cron_lock(text) TO authenticated;

-- Also grant execute on acquire_cron_lock for consistency
GRANT EXECUTE ON FUNCTION public.acquire_cron_lock(text, integer) TO authenticated;

-- Add admin check to release_cron_lock for safety
CREATE OR REPLACE FUNCTION public.release_cron_lock(p_job_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow admins or service role to release locks
  IF NOT (public.is_user_whitelisted() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Only administrators can release cron locks';
  END IF;
  
  DELETE FROM public.cron_job_locks WHERE job_name = p_job_name;
END;
$$;