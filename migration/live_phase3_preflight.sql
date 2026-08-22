-- TICKET AI Phase 3 production preflight.
-- Read-only: returns aggregate/schema evidence and raises on an incompatible
-- live schema. Do not replace this with migration-history assumptions.

BEGIN READ ONLY;

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(required_table, ', ' ORDER BY required_table)
  INTO v_missing
  FROM unnest(ARRAY[
    'cron_job_locks',
    'fixture_results',
    'generated_tickets',
    'green_buckets',
    'optimized_selections',
    'optimizer_cache',
    'pipeline_alerts',
    'ticket_leg_outcomes',
    'ticket_outcomes',
    'user_entitlements',
    'user_rate_limits',
    'user_trial_credits',
    'webhook_events'
  ]) AS required_table
  WHERE to_regclass('public.' || required_table) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 3 prerequisite tables are missing: %', v_missing;
  END IF;

  WITH required(table_name, column_name) AS (
    VALUES
      ('cron_job_locks', 'job_name'),
      ('cron_job_locks', 'locked_until'),
      ('fixture_results', 'fixture_id'),
      ('fixture_results', 'status'),
      ('generated_tickets', 'legs'),
      ('optimized_selections', 'fixture_id'),
      ('optimized_selections', 'is_live'),
      ('pipeline_alerts', 'resolved_at'),
      ('ticket_leg_outcomes', 'id'),
      ('ticket_leg_outcomes', 'kickoff_at'),
      ('ticket_leg_outcomes', 'result_status'),
      ('ticket_outcomes', 'ticket_id'),
      ('user_entitlements', 'cancel_at_period_end'),
      ('user_entitlements', 'canceled_at'),
      ('user_entitlements', 'current_period_end'),
      ('user_entitlements', 'plan'),
      ('user_entitlements', 'status'),
      ('user_entitlements', 'stripe_customer_id'),
      ('user_entitlements', 'stripe_subscription_id'),
      ('user_rate_limits', 'window_start'),
      ('user_trial_credits', 'remaining_uses'),
      ('webhook_events', 'event_id'),
      ('webhook_events', 'created_at')
  )
  SELECT string_agg(required.table_name || '.' || required.column_name, ', '
                    ORDER BY required.table_name, required.column_name)
  INTO v_missing
  FROM required
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public'
   AND c.table_name = required.table_name
   AND c.column_name = required.column_name
  WHERE c.column_name IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 3 prerequisite columns are missing: %', v_missing;
  END IF;

  IF to_regprocedure('public.is_user_whitelisted()') IS NULL
     OR to_regprocedure('public.ensure_trial_row()') IS NULL THEN
    RAISE EXCEPTION 'Feature-access prerequisite functions are missing';
  END IF;
END;
$$;

DO $$
DECLARE
  v_duplicates bigint;
BEGIN
  SELECT count(*) INTO v_duplicates
  FROM (
    SELECT stripe_customer_id
    FROM public.user_entitlements
    WHERE stripe_customer_id IS NOT NULL
    GROUP BY stripe_customer_id
    HAVING count(*) > 1
  ) duplicate_customers;
  IF v_duplicates > 0 THEN
    RAISE EXCEPTION '% duplicate Stripe customer mappings block the release', v_duplicates;
  END IF;

  SELECT count(*) INTO v_duplicates
  FROM (
    SELECT stripe_subscription_id
    FROM public.user_entitlements
    WHERE stripe_subscription_id IS NOT NULL
    GROUP BY stripe_subscription_id
    HAVING count(*) > 1
  ) duplicate_subscriptions;
  IF v_duplicates > 0 THEN
    RAISE EXCEPTION '% duplicate Stripe subscription mappings block the release', v_duplicates;
  END IF;
END;
$$;

SELECT
  (SELECT count(*) FROM auth.users) AS auth_users,
  (SELECT count(*) FROM public.user_entitlements) AS entitlements,
  (SELECT count(*) FROM public.webhook_events) AS webhook_events,
  (SELECT count(*) FROM public.generated_tickets) AS generated_tickets,
  (SELECT count(*) FROM public.ticket_leg_outcomes) AS ticket_leg_outcomes,
  (SELECT count(*) FROM public.green_buckets) AS legacy_green_buckets,
  (SELECT count(*) FROM public.optimized_selections) AS optimized_selections,
  (SELECT count(*) FROM public.pipeline_alerts WHERE resolved_at IS NULL) AS open_pipeline_alerts;

SELECT
  plan,
  status,
  count(*) AS entitlement_count,
  count(*) FILTER (WHERE current_period_end IS NULL) AS null_period_end_count,
  count(*) FILTER (WHERE current_period_end <= now()) AS expired_count
FROM public.user_entitlements
GROUP BY plan, status
ORDER BY plan, status;

SELECT
  to_regprocedure('public.claim_stripe_webhook_event(text,text,timestamptz)') IS NOT NULL
    AS stripe_claim_already_present,
  to_regprocedure('public.persist_generated_ticket(uuid,jsonb,jsonb,jsonb,jsonb)') IS NOT NULL
    AS ticket_persistence_already_present,
  to_regprocedure('public.consume_rate_limit(uuid,text,integer)') IS NOT NULL
    AS atomic_rate_limit_already_present,
  to_regclass('public.green_bucket_policy_versions') IS NOT NULL
    AS green_policy_tables_already_present;

ROLLBACK;
