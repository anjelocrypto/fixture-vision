-- TICKET AI post-restore validation gate
-- Run after data import and hardening migrations. Any raised exception blocks
-- staging approval or production cutover.

BEGIN READ ONLY;

DO $$
DECLARE
  v_count bigint;
  v_missing text;
BEGIN
  SELECT string_agg(required_table, ', ' ORDER BY required_table)
  INTO v_missing
  FROM unnest(ARRAY[
    'profiles',
    'user_roles',
    'user_entitlements',
    'user_tickets',
    'user_trial_credits',
    'prediction_markets',
    'market_coins',
    'market_positions',
    'webhook_events'
  ]) AS required_table
  WHERE to_regclass('public.' || required_table) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing required public tables: %', v_missing;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relrowsecurity;

  IF v_count <> 0 THEN
    RAISE EXCEPTION '% public tables do not have RLS enabled', v_count;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) setting
      WHERE setting LIKE 'search_path=%'
    );

  IF v_count <> 0 THEN
    RAISE EXCEPTION '% SECURITY DEFINER functions lack explicit search_path', v_count;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND (
      p.prosrc ~* 'dutkpzrisvqgxadxbkxo'
      OR p.prosrc ~* 'yjtsitqoghbimnnbtdjt'
      OR p.prosrc ~* 'https://[a-z]{20}\.supabase\.co'
      OR p.prosrc ~ 'eyJ[A-Za-z0-9_-]{30,}\.'
    );

  IF v_count <> 0 THEN
    RAISE EXCEPTION '% public routines contain environment-specific URLs or JWT-like literals', v_count;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE u.id IS NULL;

  IF v_count <> 0 THEN
    RAISE EXCEPTION '% profile rows have no matching auth user', v_count;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.user_entitlements e
  LEFT JOIN auth.users u ON u.id = e.user_id
  WHERE u.id IS NULL;

  IF v_count <> 0 THEN
    RAISE EXCEPTION '% entitlement rows have no matching auth user', v_count;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM (
    SELECT stripe_customer_id
    FROM public.user_entitlements
    WHERE stripe_customer_id IS NOT NULL
    GROUP BY stripe_customer_id
    HAVING count(*) > 1
  ) duplicates;

  IF v_count <> 0 THEN
    RAISE EXCEPTION '% Stripe customer IDs are mapped to multiple users', v_count;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM (
    SELECT stripe_subscription_id
    FROM public.user_entitlements
    WHERE stripe_subscription_id IS NOT NULL
    GROUP BY stripe_subscription_id
    HAVING count(*) > 1
  ) duplicates;

  IF v_count <> 0 THEN
    RAISE EXCEPTION '% Stripe subscription IDs are mapped to multiple users', v_count;
  END IF;

  IF to_regprocedure('public.claim_stripe_webhook_event(text,text,timestamptz)') IS NULL
     OR to_regprocedure('public.complete_stripe_webhook_event(text)') IS NULL
     OR to_regprocedure('public.fail_stripe_webhook_event(text,text)') IS NULL
     OR to_regprocedure('public.apply_stripe_entitlement_event(uuid,text,timestamptz,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'Stripe webhook safety RPCs are missing';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'claim_stripe_webhook_event',
      'complete_stripe_webhook_event',
      'fail_stripe_webhook_event',
      'apply_stripe_entitlement_event'
    )
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Stripe webhook safety RPCs are callable by anon/authenticated';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.webhook_events
  WHERE status NOT IN ('processing', 'completed', 'failed')
     OR attempts < 1;

  IF v_count <> 0 THEN
    RAISE EXCEPTION '% webhook event rows have invalid lifecycle state', v_count;
  END IF;
END;
$$;

SELECT
  (SELECT count(*) FROM auth.users) AS auth_users,
  (SELECT count(*) FROM auth.identities) AS auth_identities,
  (SELECT count(*) FROM public.profiles) AS profiles,
  (SELECT count(*) FROM public.user_entitlements) AS entitlements,
  (SELECT count(*) FROM public.user_roles) AS roles,
  (SELECT count(*) FROM public.user_tickets) AS user_tickets,
  (SELECT count(*) FROM public.market_positions) AS market_positions,
  (SELECT count(*) FROM public.webhook_events) AS webhook_events;

SELECT
  status,
  plan,
  count(*) AS entitlement_count,
  min(current_period_end) AS earliest_period_end,
  max(current_period_end) AS latest_period_end
FROM public.user_entitlements
GROUP BY status, plan
ORDER BY status, plan;

SELECT
  schemaname,
  tablename,
  count(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY schemaname, tablename
ORDER BY tablename;

ROLLBACK;
