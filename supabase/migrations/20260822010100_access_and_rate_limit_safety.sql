BEGIN;

-- Canonical paid-access predicate. Keep legacy plan aliases during the
-- transition so this expand migration cannot revoke valid existing access.
CREATE OR REPLACE FUNCTION public.user_has_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_entitlements ue
    WHERE ue.user_id = auth.uid()
      AND ue.status = 'active'
      AND ue.current_period_end > now()
      AND ue.plan IN (
        'day_pass', 'test_pass', 'monthly', 'three_month', 'annual',
        'daypass', 'quarterly', 'yearly', 'premium_monthly'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_access() TO authenticated, service_role;

-- Trial uses are reserved before expensive work and consumed only after the
-- user receives a successful result. Abandoned reservations expire without
-- decrementing the credit balance.
CREATE TABLE IF NOT EXISTS public.feature_usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'consumed', 'released', 'expired')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feature_usage_reservations_active_idx
  ON public.feature_usage_reservations (user_id, feature_key, expires_at)
  WHERE status = 'reserved';

ALTER TABLE public.feature_usage_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feature_usage_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.feature_usage_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_feature_use(p_feature_key text)
RETURNS TABLE(
  allowed boolean,
  reason text,
  remaining_uses integer,
  reservation_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_remaining integer;
  v_reserved integer;
  v_reservation_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT false, 'unauthenticated', NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  IF public.is_user_whitelisted() THEN
    RETURN QUERY SELECT true, 'admin', NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  IF public.user_has_access() THEN
    RETURN QUERY SELECT true, 'entitled', NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  IF p_feature_key NOT IN ('bet_optimizer', 'gemini_analysis') THEN
    RETURN QUERY SELECT false, 'paywalled_feature', NULL::integer, NULL::uuid;
    RETURN;
  END IF;

  PERFORM public.ensure_trial_row();

  SELECT utc.remaining_uses
    INTO v_remaining
  FROM public.user_trial_credits utc
  WHERE utc.user_id = v_uid
  FOR UPDATE;

  IF v_remaining IS NULL THEN
    RETURN QUERY SELECT false, 'no_trial_row', 0, NULL::uuid;
    RETURN;
  END IF;

  UPDATE public.feature_usage_reservations fur
     SET status = 'expired', finalized_at = now()
   WHERE fur.user_id = v_uid
     AND fur.status = 'reserved'
     AND fur.expires_at <= now();

  SELECT count(*)::integer
    INTO v_reserved
  FROM public.feature_usage_reservations fur
  WHERE fur.user_id = v_uid
    AND fur.status = 'reserved'
    AND fur.expires_at > now();

  IF v_remaining <= v_reserved THEN
    RETURN QUERY SELECT false, 'no_credits', GREATEST(v_remaining - v_reserved, 0), NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.feature_usage_reservations (user_id, feature_key)
  VALUES (v_uid, p_feature_key)
  RETURNING id INTO v_reservation_id;

  RETURN QUERY
    SELECT true, 'trial_reserved', v_remaining - v_reserved - 1, v_reservation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_feature_use(p_reservation_id uuid)
RETURNS TABLE(consumed boolean, remaining_uses integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reservation public.feature_usage_reservations%ROWTYPE;
  v_remaining integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  -- Every credit path locks user_trial_credits before touching a reservation.
  -- A single lock order prevents reserve/finalize and legacy/finalize deadlocks.
  SELECT utc.remaining_uses INTO v_remaining
  FROM public.user_trial_credits utc
  WHERE utc.user_id = v_uid
  FOR UPDATE;

  SELECT * INTO v_reservation
  FROM public.feature_usage_reservations
  WHERE id = p_reservation_id AND user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation not found';
  END IF;

  IF v_reservation.status = 'consumed' THEN
    RETURN QUERY SELECT true, v_remaining;
    RETURN;
  END IF;

  IF v_reservation.status <> 'reserved' OR v_reservation.expires_at <= now() THEN
    IF v_reservation.status = 'reserved' THEN
      UPDATE public.feature_usage_reservations
      SET status = 'expired', finalized_at = now()
      WHERE id = p_reservation_id;
    END IF;
    RETURN QUERY SELECT false, NULL::integer;
    RETURN;
  END IF;

  UPDATE public.user_trial_credits utc
     SET remaining_uses = utc.remaining_uses - 1,
         updated_at = now()
   WHERE utc.user_id = v_uid
     AND utc.remaining_uses > 0
  RETURNING utc.remaining_uses INTO v_remaining;

  IF v_remaining IS NULL THEN
    RAISE EXCEPTION 'trial credit unavailable at finalization';
  END IF;

  UPDATE public.feature_usage_reservations
  SET status = 'consumed', finalized_at = now()
  WHERE id = p_reservation_id;

  RETURN QUERY SELECT true, v_remaining;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_feature_use(p_reservation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;

  UPDATE public.feature_usage_reservations
  SET status = 'released', finalized_at = now()
  WHERE id = p_reservation_id
    AND user_id = v_uid
    AND status = 'reserved';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_feature_use(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_feature_use(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_feature_use(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_feature_use(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_feature_use(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_feature_use(uuid) TO authenticated;

-- A single transaction now owns the read/increment/check operation. The
-- service role is the only caller because Edge Functions authenticate users
-- before supplying p_user_id.
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_user_id uuid,
  p_feature text,
  p_max_per_minute integer
)
RETURNS TABLE(allowed boolean, current_count integer, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF p_user_id IS NULL OR p_feature IS NULL OR length(p_feature) > 80
     OR p_max_per_minute < 1 OR p_max_per_minute > 10000 THEN
    RAISE EXCEPTION 'invalid rate-limit arguments';
  END IF;

  INSERT INTO public.user_rate_limits (user_id, feature, window_start, count)
  VALUES (p_user_id, p_feature, v_window, 0)
  ON CONFLICT (user_id, feature, window_start) DO NOTHING;

  SELECT url.count INTO v_count
  FROM public.user_rate_limits url
  WHERE url.user_id = p_user_id
    AND url.feature = p_feature
    AND url.window_start = v_window
  FOR UPDATE;

  IF v_count >= p_max_per_minute THEN
    RETURN QUERY SELECT false, v_count, GREATEST(1, 60 - extract(second FROM now())::integer);
    RETURN;
  END IF;

  UPDATE public.user_rate_limits url
     SET count = url.count + 1
   WHERE url.user_id = p_user_id
     AND url.feature = p_feature
     AND url.window_start = v_window
  RETURNING url.count INTO v_count;

  RETURN QUERY SELECT true, v_count, 0;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(uuid,text,integer) TO service_role;

COMMIT;
