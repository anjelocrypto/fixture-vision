-- Create mutex table for cron job locking
CREATE TABLE IF NOT EXISTS public.cron_job_locks (
  job_name TEXT PRIMARY KEY,
  locked_until TIMESTAMPTZ NOT NULL,
  locked_by TEXT,
  locked_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cron_job_locks ENABLE ROW LEVEL SECURITY;

-- Service role can manage locks (for edge/cron functions)
DROP POLICY IF EXISTS "Service role can manage cron locks" ON public.cron_job_locks;
CREATE POLICY "Service role can manage cron locks"
  ON public.cron_job_locks
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Admins can view locks (use your whitelist helper)
DROP POLICY IF EXISTS "Admins can view cron locks" ON public.cron_job_locks;
CREATE POLICY "Admins can view cron locks"
  ON public.cron_job_locks
  FOR SELECT
  USING (public.is_user_whitelisted());

-- Acquire lock (true if acquired, false if someone else holds it)
CREATE OR REPLACE FUNCTION public.acquire_cron_lock(
  p_job_name TEXT,
  p_duration_minutes INTEGER DEFAULT 15
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
BEGIN
  INSERT INTO public.cron_job_locks (job_name, locked_until, locked_by, locked_at)
  VALUES (p_job_name, v_now + (p_duration_minutes || ' minutes')::INTERVAL, 'cron', v_now)
  ON CONFLICT (job_name) DO UPDATE
  SET locked_until = v_now + (p_duration_minutes || ' minutes')::INTERVAL,
      locked_by = 'cron',
      locked_at = v_now
  WHERE cron_job_locks.locked_until < v_now;

  -- FOUND = true only if INSERT or UPDATE actually happened
  RETURN FOUND;
END;
$$;

-- Release lock
CREATE OR REPLACE FUNCTION public.release_cron_lock(p_job_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.cron_job_locks WHERE job_name = p_job_name;
END;
$$;