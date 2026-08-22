-- Transactional staging test for the Stripe webhook RPCs.
-- Prerequisite: at least one migrated auth user. Every write is rolled back.

BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_user_id uuid;
  v_event_id text := 'evt_ticket_ai_test_' || replace(gen_random_uuid()::text, '-', '');
  v_newer_id text := 'evt_ticket_ai_newer_' || replace(gen_random_uuid()::text, '-', '');
  v_stale_id text := 'evt_ticket_ai_stale_' || replace(gen_random_uuid()::text, '-', '');
  v_result text;
  v_apply jsonb;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Billing safety test requires at least one staging auth user';
  END IF;

  v_result := public.claim_stripe_webhook_event(
    v_event_id,
    'ticket_ai.test',
    now()
  );
  IF v_result <> 'claimed' THEN
    RAISE EXCEPTION 'First webhook claim returned %, expected claimed', v_result;
  END IF;

  v_result := public.claim_stripe_webhook_event(
    v_event_id,
    'ticket_ai.test',
    now()
  );
  IF v_result <> 'in_progress' THEN
    RAISE EXCEPTION 'Concurrent webhook claim returned %, expected in_progress', v_result;
  END IF;

  v_apply := public.apply_stripe_entitlement_event(
    v_user_id,
    v_newer_id,
    timestamptz '2100-01-02 00:00:00+00',
    jsonb_build_object(
      'plan', 'monthly',
      'status', 'active',
      'current_period_end', '2100-02-01T00:00:00Z',
      'source', 'stripe_test'
    ),
    NULL
  );
  IF NOT coalesce((v_apply->>'applied')::boolean, false) THEN
    RAISE EXCEPTION 'New entitlement event was not applied: %', v_apply;
  END IF;

  v_apply := public.apply_stripe_entitlement_event(
    v_user_id,
    v_stale_id,
    timestamptz '2100-01-01 00:00:00+00',
    jsonb_build_object('status', 'past_due'),
    NULL
  );
  IF coalesce((v_apply->>'applied')::boolean, false)
     OR v_apply->>'reason' <> 'stale_event' THEN
    RAISE EXCEPTION 'Stale entitlement event was not rejected: %', v_apply;
  END IF;

  PERFORM public.complete_stripe_webhook_event(v_event_id);
  v_result := public.claim_stripe_webhook_event(
    v_event_id,
    'ticket_ai.test',
    now()
  );
  IF v_result <> 'already_completed' THEN
    RAISE EXCEPTION 'Completed webhook replay returned %, expected already_completed', v_result;
  END IF;
END;
$$;

ROLLBACK;
