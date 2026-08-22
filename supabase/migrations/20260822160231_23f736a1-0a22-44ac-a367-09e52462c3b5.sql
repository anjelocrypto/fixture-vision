-- Make Stripe webhook processing concurrency-safe and reject stale entitlement
-- mutations. Existing webhook rows represent completed events.

BEGIN;

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS event_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_status_check;

ALTER TABLE public.webhook_events
  ADD CONSTRAINT webhook_events_status_check
  CHECK (status IN ('processing', 'completed', 'failed'));

UPDATE public.webhook_events
SET status = 'completed',
    processed_at = COALESCE(processed_at, created_at),
    updated_at = now()
WHERE status IS DISTINCT FROM 'completed'
   OR processed_at IS NULL;

ALTER TABLE public.user_entitlements
  ADD COLUMN IF NOT EXISTS stripe_event_id text,
  ADD COLUMN IF NOT EXISTS stripe_event_created_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed text;
  v_status text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  UPDATE public.webhook_events
  SET status = 'processing',
      event_type = p_event_type,
      event_created_at = p_event_created_at,
      attempts = attempts + 1,
      lease_expires_at = now() + interval '5 minutes',
      last_error = NULL,
      updated_at = now()
  WHERE event_id = p_event_id
    AND (
      status = 'failed'
      OR (status = 'processing' AND lease_expires_at < now())
    )
  RETURNING event_id INTO v_claimed;

  IF v_claimed IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  INSERT INTO public.webhook_events (
    event_id,
    event_type,
    event_created_at,
    status,
    attempts,
    lease_expires_at,
    updated_at
  )
  VALUES (
    p_event_id,
    p_event_type,
    p_event_created_at,
    'processing',
    1,
    now() + interval '5 minutes',
    now()
  )
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id INTO v_claimed;

  IF v_claimed IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  SELECT status
  INTO v_status
  FROM public.webhook_events
  WHERE event_id = p_event_id;

  IF v_status = 'completed' THEN
    RETURN 'already_completed';
  END IF;

  RETURN 'in_progress';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_stripe_webhook_event(p_event_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  UPDATE public.webhook_events
  SET status = 'completed',
      processed_at = now(),
      lease_expires_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE event_id = p_event_id
    AND status = 'processing';
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_stripe_webhook_event(
  p_event_id text,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  UPDATE public.webhook_events
  SET status = 'failed',
      lease_expires_at = NULL,
      last_error = left(COALESCE(p_error, 'unknown error'), 1000),
      updated_at = now()
  WHERE event_id = p_event_id
    AND status = 'processing';
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_stripe_entitlement_event(
  p_user_id uuid,
  p_event_id text,
  p_event_created_at timestamptz,
  p_patch jsonb,
  p_expected_subscription_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.user_entitlements%ROWTYPE;
  v_plan text;
  v_status text;
  v_period_end timestamptz;
  v_customer_id text;
  v_subscription_id text;
  v_source text;
  v_cancel_at_period_end boolean;
  v_canceled_at timestamptz;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  IF p_user_id IS NULL OR p_event_id IS NULL OR p_event_created_at IS NULL THEN
    RAISE EXCEPTION 'user, event id, and event timestamp are required';
  END IF;

  -- Serialize every entitlement mutation for a user, including the first
  -- insert where there is not yet a row available for SELECT ... FOR UPDATE.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT *
  INTO v_existing
  FROM public.user_entitlements
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.stripe_event_created_at IS NOT NULL
       AND v_existing.stripe_event_created_at > p_event_created_at THEN
      RETURN jsonb_build_object(
        'applied', false,
        'reason', 'stale_event',
        'latest_event_id', v_existing.stripe_event_id
      );
    END IF;

    IF p_expected_subscription_id IS NOT NULL
       AND v_existing.stripe_subscription_id IS DISTINCT FROM p_expected_subscription_id THEN
      RETURN jsonb_build_object(
        'applied', false,
        'reason', 'subscription_mismatch',
        'current_subscription_id', v_existing.stripe_subscription_id
      );
    END IF;

    v_plan := CASE WHEN p_patch ? 'plan' THEN p_patch->>'plan' ELSE v_existing.plan END;
    v_status := CASE WHEN p_patch ? 'status' THEN p_patch->>'status' ELSE v_existing.status END;
    v_period_end := CASE
      WHEN p_patch ? 'current_period_end' THEN (p_patch->>'current_period_end')::timestamptz
      ELSE v_existing.current_period_end
    END;
    v_customer_id := CASE
      WHEN p_patch ? 'stripe_customer_id' THEN p_patch->>'stripe_customer_id'
      ELSE v_existing.stripe_customer_id
    END;
    v_subscription_id := CASE
      WHEN p_patch ? 'stripe_subscription_id' THEN p_patch->>'stripe_subscription_id'
      ELSE v_existing.stripe_subscription_id
    END;
    v_source := CASE WHEN p_patch ? 'source' THEN p_patch->>'source' ELSE v_existing.source END;
    v_cancel_at_period_end := CASE
      WHEN p_patch ? 'cancel_at_period_end' THEN (p_patch->>'cancel_at_period_end')::boolean
      ELSE v_existing.cancel_at_period_end
    END;
    v_canceled_at := CASE
      WHEN p_patch ? 'canceled_at' AND p_patch->>'canceled_at' IS NOT NULL
        THEN (p_patch->>'canceled_at')::timestamptz
      WHEN p_patch ? 'canceled_at' THEN NULL
      ELSE v_existing.canceled_at
    END;

    -- A one-time pass must never shorten or replace a longer paid entitlement.
    IF v_source = 'stripe_one_time'
       AND v_existing.current_period_end > v_period_end THEN
      v_plan := v_existing.plan;
      v_status := v_existing.status;
      v_period_end := v_existing.current_period_end;
      v_subscription_id := v_existing.stripe_subscription_id;
      v_source := v_existing.source;
      v_cancel_at_period_end := v_existing.cancel_at_period_end;
      v_canceled_at := v_existing.canceled_at;
    END IF;

    UPDATE public.user_entitlements
    SET plan = v_plan,
        status = v_status,
        current_period_end = v_period_end,
        stripe_customer_id = v_customer_id,
        stripe_subscription_id = v_subscription_id,
        source = v_source,
        cancel_at_period_end = v_cancel_at_period_end,
        canceled_at = v_canceled_at,
        stripe_event_id = p_event_id,
        stripe_event_created_at = p_event_created_at,
        updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    IF NOT (p_patch ? 'plan')
       OR NOT (p_patch ? 'status')
       OR NOT (p_patch ? 'current_period_end') THEN
      RAISE EXCEPTION 'new entitlement requires plan, status, and current_period_end';
    END IF;

    INSERT INTO public.user_entitlements (
      user_id,
      plan,
      status,
      current_period_end,
      stripe_customer_id,
      stripe_subscription_id,
      source,
      cancel_at_period_end,
      canceled_at,
      stripe_event_id,
      stripe_event_created_at,
      updated_at
    )
    VALUES (
      p_user_id,
      p_patch->>'plan',
      p_patch->>'status',
      (p_patch->>'current_period_end')::timestamptz,
      p_patch->>'stripe_customer_id',
      p_patch->>'stripe_subscription_id',
      COALESCE(p_patch->>'source', 'stripe'),
      COALESCE((p_patch->>'cancel_at_period_end')::boolean, false),
      CASE
        WHEN p_patch->>'canceled_at' IS NULL THEN NULL
        ELSE (p_patch->>'canceled_at')::timestamptz
      END,
      p_event_id,
      p_event_created_at,
      now()
    );
  END IF;

  RETURN jsonb_build_object('applied', true, 'reason', 'updated');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_stripe_webhook_event(text,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_stripe_webhook_event(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_stripe_webhook_event(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_stripe_entitlement_event(uuid,text,timestamptz,jsonb,text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_stripe_webhook_event(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_stripe_webhook_event(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_stripe_entitlement_event(uuid,text,timestamptz,jsonb,text) TO service_role;

COMMIT;