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
