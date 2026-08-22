BEGIN;

-- During a rolling Edge Function deployment, old and new workers can overlap.
-- Normalize aliases so fixture and optimizer entrypoints coordinate on the
-- same physical lock row.
CREATE OR REPLACE FUNCTION public.canonical_cron_job_name(p_job_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public
AS $$
  SELECT CASE btrim(p_job_name)
    WHEN 'cron-fetch-fixtures' THEN 'fixtures-sync'
    WHEN 'fetch-fixtures-admin' THEN 'fixtures-sync'
    WHEN 'fixtures-sync' THEN 'fixtures-sync'
    WHEN 'cron-warmup-odds' THEN 'optimizer-refresh'
    WHEN 'warmup-odds' THEN 'optimizer-refresh'
    WHEN 'optimizer-refresh' THEN 'optimizer-refresh'
    ELSE btrim(p_job_name)
  END;
$$;

CREATE OR REPLACE FUNCTION public.acquire_cron_lease(
  p_job_name text,
  p_duration_minutes integer DEFAULT 15
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_token uuid := gen_random_uuid();
  v_job_name text := public.canonical_cron_job_name(p_job_name);
BEGIN
  IF auth.role() <> 'service_role' OR v_job_name = ''
     OR length(v_job_name) > 120
     OR p_duration_minutes < 1 OR p_duration_minutes > 120 THEN
    RAISE EXCEPTION 'invalid cron lease request';
  END IF;

  INSERT INTO public.cron_job_locks (
    job_name, locked_until, locked_by, locked_at, lock_token
  )
  VALUES (
    v_job_name, v_now + make_interval(mins => p_duration_minutes),
    'lease', v_now, v_token
  )
  ON CONFLICT (job_name) DO UPDATE
  SET locked_until = excluded.locked_until,
      locked_by = excluded.locked_by,
      locked_at = excluded.locked_at,
      lock_token = excluded.lock_token
  WHERE public.cron_job_locks.locked_until < v_now;

  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_cron_lease(
  p_job_name text,
  p_lock_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' OR p_lock_token IS NULL THEN
    RAISE EXCEPTION 'service role and lock token required';
  END IF;

  DELETE FROM public.cron_job_locks
  WHERE job_name = public.canonical_cron_job_name(p_job_name)
    AND lock_token = p_lock_token;
  RETURN FOUND;
END;
$$;

-- Legacy boolean locks remain rollback-compatible, but now use the same
-- canonical rows as token leases. A legacy release can never delete a token
-- lease belonging to a newer worker.
CREATE OR REPLACE FUNCTION public.acquire_cron_lock(
  p_job_name text,
  p_duration_minutes integer DEFAULT 15
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_job_name text := public.canonical_cron_job_name(p_job_name);
BEGIN
  IF auth.role() <> 'service_role' OR v_job_name = ''
     OR length(v_job_name) > 120
     OR p_duration_minutes < 1 OR p_duration_minutes > 120 THEN
    RAISE EXCEPTION 'invalid legacy cron lock request';
  END IF;

  INSERT INTO public.cron_job_locks (
    job_name, locked_until, locked_by, locked_at, lock_token
  )
  VALUES (
    v_job_name, v_now + make_interval(mins => p_duration_minutes),
    'legacy', v_now, NULL
  )
  ON CONFLICT (job_name) DO UPDATE
  SET locked_until = excluded.locked_until,
      locked_by = excluded.locked_by,
      locked_at = excluded.locked_at,
      lock_token = NULL
  WHERE public.cron_job_locks.locked_until < v_now;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_cron_lock(p_job_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  DELETE FROM public.cron_job_locks
  WHERE job_name = public.canonical_cron_job_name(p_job_name)
    AND lock_token IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.canonical_cron_job_name(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acquire_cron_lease(text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_cron_lease(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acquire_cron_lock(text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_cron_lock(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_cron_job_name(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_cron_lease(text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cron_lease(text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_cron_lock(text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cron_lock(text) TO service_role;

-- The old immediate-consumption RPC remains available for rollback, but it
-- now counts active two-phase reservations before decrementing a credit.
CREATE OR REPLACE FUNCTION public.try_use_feature(feature_key text)
RETURNS TABLE(allowed boolean, reason text, remaining_uses integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_remaining integer;
  v_reserved integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'unauthenticated', NULL::integer;
    RETURN;
  END IF;
  IF public.is_user_whitelisted() THEN
    RETURN QUERY SELECT true, 'admin', NULL::integer;
    RETURN;
  END IF;
  IF public.user_has_access() THEN
    RETURN QUERY SELECT true, 'entitled', NULL::integer;
    RETURN;
  END IF;
  IF feature_key NOT IN ('bet_optimizer', 'gemini_analysis') THEN
    RETURN QUERY SELECT false, 'paywalled_feature', NULL::integer;
    RETURN;
  END IF;

  PERFORM public.ensure_trial_row();
  SELECT utc.remaining_uses INTO v_remaining
  FROM public.user_trial_credits utc
  WHERE utc.user_id = v_uid
  FOR UPDATE;

  UPDATE public.feature_usage_reservations fur
  SET status = 'expired', finalized_at = now()
  WHERE fur.user_id = v_uid
    AND fur.status = 'reserved'
    AND fur.expires_at <= now();

  SELECT count(*)::integer INTO v_reserved
  FROM public.feature_usage_reservations fur
  WHERE fur.user_id = v_uid
    AND fur.status = 'reserved'
    AND fur.expires_at > now();

  IF v_remaining IS NULL THEN
    RETURN QUERY SELECT false, 'no_trial_row', 0;
    RETURN;
  END IF;
  IF v_remaining <= v_reserved THEN
    RETURN QUERY SELECT false, 'no_credits', GREATEST(v_remaining - v_reserved, 0);
    RETURN;
  END IF;

  UPDATE public.user_trial_credits utc
  SET remaining_uses = utc.remaining_uses - 1,
      updated_at = now()
  WHERE utc.user_id = v_uid
  RETURNING utc.remaining_uses INTO v_remaining;

  RETURN QUERY SELECT true, 'trial_legacy', v_remaining;
END;
$$;

REVOKE ALL ON FUNCTION public.try_use_feature(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.try_use_feature(text) TO authenticated;

-- The old scorer RPC now creates durable claims through the new claim path.
-- Old code can continue its direct update during rollback, while new workers
-- cannot receive the same rows until the claim expires or the old update wins.
CREATE OR REPLACE FUNCTION public.get_scorable_pending_legs(batch_limit integer DEFAULT 500)
RETURNS TABLE (
  leg_id uuid,
  ticket_id uuid,
  user_id uuid,
  fixture_id bigint,
  market text,
  side text,
  line numeric,
  goals_home smallint,
  goals_away smallint,
  corners_home smallint,
  corners_away smallint,
  cards_home smallint,
  cards_away smallint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    claimed.leg_id,
    claimed.ticket_id,
    claimed.user_id,
    claimed.fixture_id,
    claimed.market,
    claimed.side,
    claimed.line,
    claimed.goals_home,
    claimed.goals_away,
    claimed.corners_home,
    claimed.corners_away,
    claimed.cards_home,
    claimed.cards_away
  FROM public.claim_scorable_ticket_legs(batch_limit) claimed;
$$;

REVOKE ALL ON FUNCTION public.get_scorable_pending_legs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_scorable_pending_legs(integer) TO service_role;

COMMIT;