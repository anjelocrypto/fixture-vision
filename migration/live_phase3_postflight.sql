-- TICKET AI Phase 3 production postflight. Read-only and safe to rerun.
-- Run only after all eleven approved expand migrations have committed.

BEGIN READ ONLY;

DO $$
DECLARE
  v_missing text;
  v_count bigint;
BEGIN
  SELECT string_agg(object_name, ', ' ORDER BY object_name)
  INTO v_missing
  FROM unnest(ARRAY[
    'public.feature_usage_reservations',
    'public.green_bucket_policy_versions',
    'public.green_bucket_policy_entries',
    'public.football_league_teams',
    'public.team_stats_refresh_queue',
    'public.privacy_requests'
  ]) object_name
  WHERE to_regclass(object_name) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 3 tables missing: %', v_missing;
  END IF;

  SELECT string_agg(signature, ', ' ORDER BY signature)
  INTO v_missing
  FROM unnest(ARRAY[
    'public.reserve_feature_use(text)',
    'public.finalize_feature_use(uuid)',
    'public.release_feature_use(uuid)',
    'public.consume_rate_limit(uuid,text,integer)',
    'public.persist_generated_ticket(uuid,jsonb,jsonb,jsonb,jsonb)',
    'public.replace_optimized_selections(bigint[],timestamp with time zone,timestamp with time zone,jsonb)',
    'public.acquire_cron_lease(text,integer)',
    'public.release_cron_lease(text,uuid)',
    'public.claim_scorable_ticket_legs(integer)',
    'public.record_pipeline_alert(text,text,text,text,jsonb)',
    'public.resolve_pipeline_alert(text)',
    'public.prune_resolved_pipeline_alerts(integer,integer)',
    'public.canonical_cron_job_name(text)',
    'public.replace_football_league_roster(integer,integer,jsonb)',
    'public.enqueue_team_stats_refresh(jsonb)',
    'public.claim_team_stats_refresh(integer)',
    'public.complete_team_stats_refresh(bigint,uuid)',
    'public.fail_team_stats_refresh(bigint,uuid,text)',
    'public.release_team_stats_refresh_claims(uuid)',
    'public.request_account_deletion(text)',
    'public.purge_user_application_data_for_deletion(uuid,text)',
    'public.complete_account_deletion_request(uuid,text)'
  ]) signature
  WHERE to_regprocedure(signature) IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 3 functions missing: %', v_missing;
  END IF;

  SELECT count(*) INTO v_count
  FROM (
    SELECT stripe_customer_id
    FROM public.user_entitlements
    WHERE stripe_customer_id IS NOT NULL
    GROUP BY stripe_customer_id HAVING count(*) > 1
  ) duplicates;
  IF v_count > 0 THEN RAISE EXCEPTION '% duplicate Stripe customer IDs remain', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM (
    SELECT stripe_subscription_id
    FROM public.user_entitlements
    WHERE stripe_subscription_id IS NOT NULL
    GROUP BY stripe_subscription_id HAVING count(*) > 1
  ) duplicates;
  IF v_count > 0 THEN RAISE EXCEPTION '% duplicate Stripe subscription IDs remain', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM public.pipeline_alerts
  WHERE resolved_at IS NULL AND fingerprint IS NULL;
  IF v_count > 0 THEN RAISE EXCEPTION '% open alerts lack fingerprints', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM (
    SELECT fingerprint
    FROM public.pipeline_alerts
    WHERE resolved_at IS NULL
    GROUP BY fingerprint HAVING count(*) > 1
  ) duplicate_alerts;
  IF v_count > 0 THEN RAISE EXCEPTION '% duplicate open alert fingerprints remain', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'acquire_cron_lease', 'release_cron_lease', 'acquire_cron_lock',
      'release_cron_lock', 'claim_scorable_ticket_legs',
      'get_scorable_pending_legs', 'replace_football_league_roster',
      'record_pipeline_alert', 'resolve_pipeline_alert',
      'prune_resolved_pipeline_alerts', 'canonical_cron_job_name',
      'enqueue_team_stats_refresh', 'claim_team_stats_refresh',
      'complete_team_stats_refresh', 'fail_team_stats_refresh',
      'release_team_stats_refresh_claims',
      'purge_user_application_data_for_deletion',
      'complete_account_deletion_request'
    )
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );
  IF v_count > 0 THEN
    RAISE EXCEPTION '% internal worker functions are exposed to anon/authenticated', v_count;
  END IF;

  IF has_column_privilege('authenticated', 'public.privacy_requests', 'handled_by', 'SELECT')
     OR has_column_privilege('authenticated', 'public.privacy_requests', 'resolution_notes', 'SELECT') THEN
    RAISE EXCEPTION 'internal privacy-request handling fields are exposed to authenticated users';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.team_stats_refresh_queue
  WHERE (status = 'processing' AND (claim_token IS NULL OR claimed_at IS NULL))
     OR (status = 'pending' AND (claim_token IS NOT NULL OR claimed_at IS NOT NULL));
  IF v_count > 0 THEN
    RAISE EXCEPTION '% stats queue rows have inconsistent claim state', v_count;
  END IF;

  IF to_regclass('public.prediction_markets') IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = to_regclass('public.prediction_markets')
      AND contype = 'f'
      AND confrelid = 'auth.users'::regclass
      AND confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'prediction market creator reference still blocks Auth deletion';
  END IF;

  IF to_regclass('public.admin_market_audit_log') IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = to_regclass('public.admin_market_audit_log')
      AND contype = 'f'
      AND confrelid = 'auth.users'::regclass
      AND confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'admin market audit reference still blocks Auth deletion';
  END IF;
END;
$$;

SELECT
  (SELECT count(*) FROM public.pipeline_alerts WHERE resolved_at IS NULL) AS open_alerts,
  (SELECT count(*) FROM public.pipeline_alerts
    WHERE resolved_by = 'phase3_exact_duplicate_collapse') AS collapsed_legacy_duplicates,
  (SELECT count(*) FROM public.feature_usage_reservations
    WHERE status = 'reserved' AND expires_at > now()) AS active_feature_reservations,
  (SELECT count(*) FROM public.team_stats_refresh_queue WHERE status = 'pending') AS pending_stats_queue,
  (SELECT count(*) FROM public.team_stats_refresh_queue WHERE status = 'processing') AS processing_stats_queue,
  (SELECT count(*) FROM public.football_league_teams WHERE active) AS active_roster_rows;

SELECT league_id, season, count(*) AS active_teams, max(last_seen_at) AS last_seen_at
FROM public.football_league_teams
WHERE active
GROUP BY league_id, season
ORDER BY league_id, season;

SELECT alert_type, severity, count(*) AS open_rows, sum(occurrence_count) AS occurrences
FROM public.pipeline_alerts
WHERE resolved_at IS NULL
GROUP BY alert_type, severity
ORDER BY occurrences DESC, alert_type;

ROLLBACK;
