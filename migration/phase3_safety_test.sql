\set ON_ERROR_STOP on

SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);

-- Trial credits are reserved before work, consumed only after success, and
-- preserved when the operation releases its reservation.
DO $$
DECLARE
  v_allowed boolean;
  v_reason text;
  v_remaining integer;
  v_reservation uuid;
  v_consumed boolean;
  v_delete_request uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);

  SELECT allowed, reason, remaining_uses, reservation_id
  INTO v_allowed, v_reason, v_remaining, v_reservation
  FROM public.reserve_feature_use('bet_optimizer');
  IF NOT v_allowed OR v_reason <> 'trial_reserved' OR v_remaining <> 4 OR v_reservation IS NULL THEN
    RAISE EXCEPTION 'trial reservation failed';
  END IF;

  SELECT consumed, remaining_uses
  INTO v_consumed, v_remaining
  FROM public.finalize_feature_use(v_reservation);
  IF NOT v_consumed OR v_remaining <> 4 THEN
    RAISE EXCEPTION 'trial finalization failed';
  END IF;

  SELECT reservation_id INTO v_reservation
  FROM public.reserve_feature_use('gemini_analysis');
  IF v_reservation IS NULL OR NOT public.release_feature_use(v_reservation) THEN
    RAISE EXCEPTION 'trial release failed';
  END IF;
  IF (SELECT remaining_uses FROM public.user_trial_credits
      WHERE user_id = auth.uid()) <> 4 THEN
    RAISE EXCEPTION 'released reservation consumed a credit';
  END IF;

  UPDATE public.user_trial_credits SET remaining_uses = 1 WHERE user_id = auth.uid();
  SELECT reservation_id INTO v_reservation
  FROM public.reserve_feature_use('bet_optimizer');
  SELECT allowed, reason, remaining_uses
  INTO v_allowed, v_reason, v_remaining
  FROM public.try_use_feature('bet_optimizer');
  IF v_allowed OR v_reason <> 'no_credits' OR v_remaining <> 0 THEN
    RAISE EXCEPTION 'legacy credit path ignored an active reservation';
  END IF;
  IF NOT public.release_feature_use(v_reservation) THEN
    RAISE EXCEPTION 'interop reservation release failed';
  END IF;
  UPDATE public.user_trial_credits SET remaining_uses = 4 WHERE user_id = auth.uid();

  v_delete_request := public.request_account_deletion('DELETE MY ACCOUNT');
  IF v_delete_request IS NULL
     OR public.request_account_deletion('DELETE MY ACCOUNT') <> v_delete_request THEN
    RAISE EXCEPTION 'privacy deletion request was not idempotent';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
END;
$$;

DO $$
DECLARE
  v_allowed boolean;
  v_count integer;
  v_retry integer;
  v_token uuid;
  v_wrong_token uuid := gen_random_uuid();
  v_policy uuid;
  v_replaced integer;
  v_ticket_id uuid;
  v_leg_id uuid;
  v_claimed_token uuid;
  v_ticket_status text;
  v_alert_id bigint;
  v_legacy_leg_id uuid;
  v_queue_token uuid;
  v_queue_team bigint;
  v_unsupported_leg_id uuid;
  v_health jsonb;
BEGIN
  SELECT allowed, current_count, retry_after_seconds
  INTO v_allowed, v_count, v_retry
  FROM public.consume_rate_limit(
    '00000000-0000-0000-0000-000000000001', 'ticket_creator', 1
  );
  IF NOT v_allowed OR v_count <> 1 THEN RAISE EXCEPTION 'first rate-limit use failed'; END IF;

  SELECT allowed, current_count, retry_after_seconds
  INTO v_allowed, v_count, v_retry
  FROM public.consume_rate_limit(
    '00000000-0000-0000-0000-000000000001', 'ticket_creator', 1
  );
  IF v_allowed OR v_count <> 1 OR v_retry < 1 THEN RAISE EXCEPTION 'rate limit was not enforced'; END IF;

  v_token := public.acquire_cron_lease('test-job', 5);
  IF v_token IS NULL THEN RAISE EXCEPTION 'lease acquisition failed'; END IF;
  IF public.acquire_cron_lease('test-job', 5) IS NOT NULL THEN RAISE EXCEPTION 'active lease was stolen'; END IF;
  IF public.release_cron_lease('test-job', v_wrong_token) THEN RAISE EXCEPTION 'wrong owner released lease'; END IF;
  IF NOT public.release_cron_lease('test-job', v_token) THEN RAISE EXCEPTION 'owner could not release lease'; END IF;

  IF NOT public.acquire_cron_lock('cron-fetch-fixtures', 5) THEN
    RAISE EXCEPTION 'legacy lock acquisition failed';
  END IF;
  IF public.acquire_cron_lease('fixtures-sync', 5) IS NOT NULL THEN
    RAISE EXCEPTION 'lease bypassed a legacy alias lock';
  END IF;
  PERFORM public.release_cron_lock('cron-fetch-fixtures');
  v_token := public.acquire_cron_lease('fixtures-sync', 5);
  IF v_token IS NULL THEN RAISE EXCEPTION 'lease failed after legacy release'; END IF;
  PERFORM public.release_cron_lock('cron-fetch-fixtures');
  IF public.acquire_cron_lease('fixtures-sync', 5) IS NOT NULL THEN
    RAISE EXCEPTION 'legacy release deleted a token lease';
  END IF;
  IF NOT public.release_cron_lease('fixtures-sync', v_token) THEN
    RAISE EXCEPTION 'token lease release failed after interop check';
  END IF;

  v_policy := public.activate_green_bucket_policy(
    '[{"league_id":39,"market":"goals","side":"over","line_norm":1.5,"odds_band":"1.40-1.50","sample_size":50,"wins":35,"losses":15,"hit_rate_pct":70,"roi_pct":1}]',
    now() - interval '5 months', now(), 50,
    '{"min_sample":50,"min_hit_rate_pct":65,"min_roi_pct":-2}', '{}'
  );
  IF v_policy IS NULL THEN RAISE EXCEPTION 'policy activation failed'; END IF;

  v_replaced := public.replace_optimized_selections(
    ARRAY[1001]::bigint[], now(), now() + interval '1 day',
    jsonb_build_array(jsonb_build_object(
      'fixture_id', 1001, 'league_id', 39, 'country_code', 'GB-ENG',
      'utc_kickoff', now() + interval '2 hours', 'market', 'goals',
      'side', 'over', 'line', 1.5, 'bookmaker', 'test', 'odds', 1.45,
      'is_live', false,
      'edge_pct', 3, 'model_prob', 0.72, 'sample_size', 20,
      'combined_snapshot', '{"goals":3}'::jsonb, 'rules_version', 'test',
      'source', 'test', 'computed_at', now()
    ))
  );
  IF v_replaced <> 1 THEN RAISE EXCEPTION 'selection replacement failed'; END IF;

  BEGIN
    PERFORM public.replace_optimized_selections(
      ARRAY[1001]::bigint[], now(), now() + interval '1 day', '[]'::jsonb
    );
    RAISE EXCEPTION 'empty selection replacement was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'empty selection replacement was accepted' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.optimized_selections WHERE fixture_id = 1001) <> 1 THEN
    RAISE EXCEPTION 'failed replacement destroyed prior selections';
  END IF;

  v_ticket_id := public.persist_generated_ticket(
    '00000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'total_odds', 1.45, 'min_target', 1.4, 'max_target', 1.5,
      'used_live', false, 'legs', jsonb_build_array(jsonb_build_object('fixtureId', 1001)),
      'ticket_mode', 'balanced', 'ticket_model_prob', 0.72
    ),
    jsonb_build_array(jsonb_build_object(
      'fixture_id', 1001, 'market', 'goals', 'side', 'over', 'line', 1.5,
      'combined_value', 3, 'bookmaker', 'test', 'odds', 1.45, 'source', 'test'
    )),
    jsonb_build_array(jsonb_build_object(
      'fixture_id', 1001, 'league_id', 39, 'market', 'goals', 'side', 'over',
      'line', 1.5, 'odds', 1.45, 'selection_key', 'goals:over:1.5',
      'selection', 'Over 1.5 Goals', 'source', 'prematch',
      'picked_at', now(), 'kickoff_at', now() - interval '3 hours',
      'derived_from_selection', false, 'model_prob', 0.72
    )),
    jsonb_build_object('total_odds', 1.45, 'ticket_mode', 'balanced', 'ticket_model_prob', 0.72)
  );
  IF v_ticket_id IS NULL
     OR (SELECT count(*) FROM public.generated_tickets WHERE id = v_ticket_id) <> 1
     OR (SELECT count(*) FROM public.ticket_leg_outcomes WHERE ticket_id = v_ticket_id) <> 1
     OR (SELECT count(*) FROM public.ticket_outcomes WHERE ticket_id = v_ticket_id) <> 1 THEN
    RAISE EXCEPTION 'atomic ticket persistence failed';
  END IF;

  INSERT INTO public.fixture_results (
    fixture_id, goals_home, goals_away, corners_home, corners_away,
    cards_home, cards_away, status
  ) VALUES (1001, 2, 1, 4, 3, 2, 1, 'FT');

  SELECT leg_id INTO v_legacy_leg_id
  FROM public.get_scorable_pending_legs(10)
  LIMIT 1;
  IF v_legacy_leg_id IS NULL
     OR (SELECT score_claim_token FROM public.ticket_leg_outcomes WHERE id = v_legacy_leg_id) IS NULL THEN
    RAISE EXCEPTION 'legacy scorer path did not create a durable claim';
  END IF;
  SELECT score_claim_token INTO v_claimed_token
  FROM public.ticket_leg_outcomes WHERE id = v_legacy_leg_id;
  IF NOT public.release_ticket_leg_score_claim(v_legacy_leg_id, v_claimed_token) THEN
    RAISE EXCEPTION 'legacy scorer compatibility claim could not be released';
  END IF;

  SELECT claim_token, leg_id
  INTO v_claimed_token, v_leg_id
  FROM public.claim_scorable_ticket_legs(10)
  LIMIT 1;
  IF v_claimed_token IS NULL OR v_leg_id IS NULL THEN
    RAISE EXCEPTION 'score claim failed';
  END IF;
  IF public.finalize_scored_ticket_leg(v_leg_id, v_wrong_token, 'WIN', 3, 'test') THEN
    RAISE EXCEPTION 'wrong claim owner finalized a score';
  END IF;
  IF NOT public.finalize_scored_ticket_leg(v_leg_id, v_claimed_token, 'WIN', 3, 'test') THEN
    RAISE EXCEPTION 'claim owner could not finalize a score';
  END IF;
  v_ticket_status := public.refresh_ticket_outcome(v_ticket_id);
  IF v_ticket_status <> 'WON' THEN RAISE EXCEPTION 'ticket outcome refresh failed'; END IF;

  INSERT INTO public.fixture_results (
    fixture_id, goals_home, goals_away, corners_home, corners_away,
    cards_home, cards_away, status
  ) VALUES (1002, 1, 0, 4, 2, NULL, NULL, 'FT');
  INSERT INTO public.ticket_leg_outcomes (
    ticket_id, user_id, fixture_id, league_id, market, side, line, odds,
    selection_key, selection, kickoff_at
  ) VALUES (
    v_ticket_id, '00000000-0000-0000-0000-000000000001', 1002, 39,
    'cards', 'over', 2.5, 1.45, 'cards:over:2.5', 'Over 2.5 Cards',
    now() - interval '3 hours'
  ) RETURNING id INTO v_unsupported_leg_id;
  INSERT INTO public.ticket_leg_outcomes (
    ticket_id, user_id, fixture_id, league_id, market, side, line, odds,
    selection_key, selection, kickoff_at
  ) VALUES (
    v_ticket_id, '00000000-0000-0000-0000-000000000001', 1003, 39,
    'goals', 'over', 1.5, 1.45, 'goals:over:1.5', 'Over 1.5 Goals',
    now() - interval '3 hours'
  );

  IF EXISTS (SELECT 1 FROM public.claim_scorable_ticket_legs(10)) THEN
    RAISE EXCEPTION 'unsupported or missing-result leg was claimed';
  END IF;
  IF (SELECT score_attempts FROM public.ticket_leg_outcomes
      WHERE id = v_unsupported_leg_id) <> 0 THEN
    RAISE EXCEPTION 'unsupported leg score_attempts was incremented';
  END IF;
  v_health := public.get_ticket_pipeline_health_metrics();
  IF (v_health ->> 'pending_with_ft_results')::integer <> 0
     OR (v_health ->> 'pending_missing_fixture_results')::integer <> 1 THEN
    RAISE EXCEPTION 'pipeline health metrics do not match scorer eligibility: %', v_health;
  END IF;

  v_alert_id := public.record_pipeline_alert(
    'test:fingerprint', 'test_alert', 'warning', 'test', '{"attempt":1}'::jsonb
  );
  IF public.record_pipeline_alert(
    'test:fingerprint', 'test_alert', 'critical', 'test again', '{"attempt":2}'::jsonb
  ) <> v_alert_id THEN
    RAISE EXCEPTION 'alert was not deduplicated';
  END IF;
  IF (SELECT occurrence_count FROM public.pipeline_alerts WHERE id = v_alert_id) <> 2 THEN
    RAISE EXCEPTION 'alert occurrence count was not incremented';
  END IF;
  IF public.resolve_pipeline_alert('test:fingerprint') <> 1 THEN
    RAISE EXCEPTION 'alert recovery did not resolve the alert';
  END IF;

  IF (SELECT count(*) FROM public.pipeline_alerts
      WHERE alert_type = 'legacy_duplicate' AND resolved_at IS NULL) <> 1
     OR (SELECT sum(occurrence_count) FROM public.pipeline_alerts
         WHERE alert_type = 'legacy_duplicate' AND resolved_at IS NULL) <> 2 THEN
    RAISE EXCEPTION 'legacy alert backlog was not collapsed safely';
  END IF;
  IF (SELECT count(*) FROM public.pipeline_alerts
      WHERE alert_type = 'backfill_stalled' AND resolved_at IS NULL) <> 1
     OR (SELECT sum(occurrence_count) FROM public.pipeline_alerts
         WHERE alert_type = 'backfill_stalled' AND resolved_at IS NULL) <> 2 THEN
    RAISE EXCEPTION 'semantic legacy alert backlog was not collapsed safely';
  END IF;

  IF public.replace_football_league_roster(
    39, 2026,
    '[{"team_id":1,"team_name":"Alpha"},{"team_id":2,"team_name":"Beta"}]'::jsonb
  ) <> 2 THEN
    RAISE EXCEPTION 'authoritative roster initial replacement failed';
  END IF;
  BEGIN
    PERFORM public.replace_football_league_roster(
      39, 2026,
      '[{"team_id":2,"team_name":"Beta"},{"team_id":2,"team_name":"Duplicate"}]'::jsonb
    );
    RAISE EXCEPTION 'duplicate roster team was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'duplicate roster team was accepted' THEN RAISE; END IF;
  END;
  v_replaced := public.replace_football_league_roster(
    39, 2026,
    '[{"team_id":2,"team_name":"Beta Updated"}]'::jsonb
  );
  IF v_replaced <> 1
     OR (SELECT active FROM public.football_league_teams
         WHERE league_id = 39 AND season = 2026 AND team_id = 1) THEN
    RAISE EXCEPTION 'authoritative roster replacement did not retire missing team';
  END IF;

  IF public.enqueue_team_stats_refresh(
    '[{"team_id":101,"priority":50},{"team_id":101,"priority":10},{"team_id":102,"priority":20}]'::jsonb
  ) <> 2 THEN
    RAISE EXCEPTION 'stats queue enqueue failed';
  END IF;
  SELECT claim_token, team_id INTO v_queue_token, v_queue_team
  FROM public.claim_team_stats_refresh(1) LIMIT 1;
  IF v_queue_token IS NULL OR v_queue_team <> 101 THEN
    RAISE EXCEPTION 'stats queue priority claim failed';
  END IF;
  IF public.complete_team_stats_refresh(v_queue_team, v_wrong_token) THEN
    RAISE EXCEPTION 'wrong stats claim owner completed work';
  END IF;
  IF NOT public.complete_team_stats_refresh(v_queue_team, v_queue_token) THEN
    RAISE EXCEPTION 'stats claim owner could not complete work';
  END IF;
END;
$$;

-- Account deletion is two-step: service-only application purge, supported
-- Auth deletion, then completion of the retained privacy-request evidence.
DO $$
DECLARE
  v_user_id uuid := '00000000-0000-0000-0000-000000000002';
  v_request_id uuid;
  v_counts jsonb;
  v_completed boolean;
BEGIN
  INSERT INTO auth.users (id) VALUES (v_user_id);
  INSERT INTO public.user_entitlements (
    user_id, plan, status, current_period_end, source
  ) VALUES (v_user_id, 'free', 'canceled', now(), 'test');
  INSERT INTO public.user_trial_credits (user_id, remaining_uses)
  VALUES (v_user_id, 5);
  INSERT INTO public.prediction_markets (created_by) VALUES (v_user_id);
  INSERT INTO public.admin_market_audit_log (admin_user_id) VALUES (v_user_id);

  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, false);
  v_request_id := public.request_account_deletion('DELETE MY ACCOUNT');

  PERFORM set_config('request.jwt.claim.role', 'service_role', false);
  v_counts := public.purge_user_application_data_for_deletion(
    v_user_id, 'PURGE USER APPLICATION DATA'
  );
  IF COALESCE((v_counts ->> 'user_entitlements')::integer, -1) <> 1
     OR COALESCE((v_counts ->> 'user_trial_credits')::integer, -1) <> 1 THEN
    RAISE EXCEPTION 'account application-data purge was incomplete';
  END IF;

  DELETE FROM auth.users WHERE id = v_user_id;
  IF EXISTS (SELECT 1 FROM public.prediction_markets WHERE created_by IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.admin_market_audit_log WHERE admin_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'shared market audit references blocked account anonymization';
  END IF;
  v_completed := public.complete_account_deletion_request(v_request_id, 'test completion');
  IF NOT v_completed
     OR (SELECT status FROM public.privacy_requests WHERE id = v_request_id) <> 'completed' THEN
    RAISE EXCEPTION 'account deletion request completion failed';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
END;
$$;

-- A rejected empty policy must not retire the active version.
DO $$
BEGIN
  BEGIN
    PERFORM public.activate_green_bucket_policy(
      '[]'::jsonb, now() - interval '1 day', now(), 1, '{}'::jsonb, '{}'::jsonb
    );
    RAISE EXCEPTION 'empty policy was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'empty policy was accepted' THEN RAISE; END IF;
  END;

  IF (SELECT count(*) FROM public.green_bucket_policy_versions WHERE status = 'active') <> 1 THEN
    RAISE EXCEPTION 'active policy was not preserved';
  END IF;
END;
$$;

SELECT 'phase3_safety_test_passed' AS result;
