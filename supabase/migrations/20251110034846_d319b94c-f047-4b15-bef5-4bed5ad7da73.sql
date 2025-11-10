-- SAFER: lock down SECURITY DEFINER & admin helpers only if present
DO $$
BEGIN
  -- helper to (re)grant safely
  PERFORM 1 FROM pg_proc WHERE oid = 'public.is_user_subscriber(uuid)'::regprocedure;
  IF FOUND THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.is_user_subscriber(uuid) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_user_subscriber(uuid) TO authenticated, service_role';
  END IF;

  PERFORM 1 FROM pg_proc WHERE oid = 'public.is_user_whitelisted()'::regprocedure;
  IF FOUND THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.is_user_whitelisted() FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_user_whitelisted() TO authenticated, service_role';
  END IF;

  PERFORM 1 FROM pg_proc WHERE oid = 'public.user_has_access()'::regprocedure;
  IF FOUND THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.user_has_access() FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.user_has_access() TO authenticated, service_role';
  END IF;

  -- note: app_role is usually a custom enum in public schema
  PERFORM 1 FROM pg_proc WHERE oid = 'public.has_role(uuid, public.app_role)'::regprocedure;
  IF FOUND THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role';
  END IF;

  PERFORM 1 FROM pg_proc WHERE oid = 'public.get_trial_credits()'::regprocedure;
  IF FOUND THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_trial_credits() FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_trial_credits() TO authenticated, service_role';
  END IF;

  PERFORM 1 FROM pg_proc WHERE oid = 'public.ensure_trial_row()'::regprocedure;
  IF FOUND THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.ensure_trial_row() FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ensure_trial_row() TO authenticated, service_role';
  END IF;

  PERFORM 1 FROM pg_proc WHERE oid = 'public.try_use_feature(text)'::regprocedure;
  IF FOUND THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.try_use_feature(text) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.try_use_feature(text) TO authenticated, service_role';
  END IF;

  -- cron helpers should be service_role only
  PERFORM 1 FROM pg_proc WHERE oid = 'public.acquire_cron_lock(text, integer)'::regprocedure;
  IF FOUND THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.acquire_cron_lock(text, integer) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.acquire_cron_lock(text, integer) TO service_role';
  END IF;

  PERFORM 1 FROM pg_proc WHERE oid = 'public.release_cron_lock(text)'::regprocedure;
  IF FOUND THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.release_cron_lock(text) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.release_cron_lock(text) TO service_role';
  END IF;

  PERFORM 1 FROM pg_proc WHERE oid = 'public.get_cron_internal_key()'::regprocedure;
  IF FOUND THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_cron_internal_key() FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_cron_internal_key() TO service_role';
  END IF;
END
$$;