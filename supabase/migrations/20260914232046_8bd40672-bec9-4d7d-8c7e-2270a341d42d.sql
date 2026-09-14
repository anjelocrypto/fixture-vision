-- ============================================================
-- GATE D RC3.1 CORRECTION (forward-only)
-- Blockers 2, 4, 5, 7, 8(SQL), 9(SQL)
-- ============================================================

-- ---------- 2. SETTLEMENT HOLD REASON CONSTRAINT ----------
ALTER TABLE public.ticket_leg_outcomes
  DROP CONSTRAINT IF EXISTS tlo_settlement_hold_reason_chk;

ALTER TABLE public.ticket_leg_outcomes
  ADD CONSTRAINT tlo_settlement_hold_reason_chk
  CHECK (
    settlement_hold_reason IS NULL
    OR settlement_hold_reason = ANY (ARRAY[
      'kickoff_drift',
      'team_direction_mismatch',
      'identity_unverifiable',
      'kickoff_unverifiable',
      'manual_review_non_terminal'
    ])
  ) NOT VALID;

ALTER TABLE public.ticket_leg_outcomes
  VALIDATE CONSTRAINT tlo_settlement_hold_reason_chk;

-- ---------- V1 EVALUATOR RETIREMENT ----------
CREATE OR REPLACE FUNCTION public.evaluate_leg_hold(
  p_leg_kickoff timestamptz, p_fixture_kickoff timestamptz,
  p_leg_home_id bigint, p_leg_away_id bigint,
  p_fx_home_id bigint, p_fx_away_id bigint,
  p_leg_home_name text, p_leg_away_name text,
  p_fx_home_name text, p_fx_away_name text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'retired: use public.evaluate_leg_hold_v3 (canonical settlement policy reschedule-integrity-v3)';
END;
$function$;
REVOKE ALL ON FUNCTION public.evaluate_leg_hold(timestamptz,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text) FROM PUBLIC, anon, authenticated;

-- ---------- EVIDENCE VIEW WITH RESULT EVIDENCE + PER-LEG EVIDENCE HASH ----------
DROP VIEW IF EXISTS public.v_leg_settlement_evidence;
CREATE VIEW public.v_leg_settlement_evidence AS
SELECT
  tlo.id                AS leg_id,
  tlo.ticket_id,
  tlo.user_id,
  tlo.fixture_id,
  tlo.market,
  tlo.side,
  tlo.line,
  tlo.result_status,
  tlo.settlement_hold_reason,
  tlo.score_claim_token,
  tlo.score_claimed_at,
  tlo.kickoff_at        AS leg_kickoff,
  CASE WHEN fx.timestamp IS NULL THEN NULL ELSE to_timestamp(fx.timestamp) END AS fixture_kickoff,
  COALESCE(tlo.home_team_id_snapshot, tj.home_id) AS leg_home_id,
  COALESCE(tlo.away_team_id_snapshot, tj.away_id) AS leg_away_id,
  NULLIF(fx.teams_home->>'id','')::bigint         AS fixture_home_id,
  NULLIF(fx.teams_away->>'id','')::bigint         AS fixture_away_id,
  fr.status                                       AS result_status_provider,
  fr.goals_home, fr.goals_away,
  fr.corners_home, fr.corners_away,
  fr.cards_home, fr.cards_away,
  fr.fetched_at                                   AS result_fetched_at,
  md5(
    COALESCE(fr.status,'-') || '|' ||
    COALESCE(fr.goals_home::text,'-') || '|' || COALESCE(fr.goals_away::text,'-') || '|' ||
    COALESCE(fr.corners_home::text,'-') || '|' || COALESCE(fr.corners_away::text,'-') || '|' ||
    COALESCE(fr.cards_home::text,'-') || '|' || COALESCE(fr.cards_away::text,'-') || '|' ||
    COALESCE(fr.kickoff_at::text,'-')
  ) AS result_fingerprint,
  public.evaluate_leg_hold_v3(
    tlo.kickoff_at,
    CASE WHEN fx.timestamp IS NULL THEN NULL ELSE to_timestamp(fx.timestamp) END,
    COALESCE(tlo.home_team_id_snapshot, tj.home_id),
    COALESCE(tlo.away_team_id_snapshot, tj.away_id),
    NULLIF(fx.teams_home->>'id','')::bigint,
    NULLIF(fx.teams_away->>'id','')::bigint,
    tj.home_name,
    tj.away_name,
    fx.teams_home->>'name',
    fx.teams_away->>'name'
  ) AS hold_reason,
  CASE
    WHEN fx.timestamp IS NULL OR tlo.kickoff_at IS NULL THEN NULL
    ELSE EXTRACT(epoch FROM (to_timestamp(fx.timestamp) - tlo.kickoff_at))::bigint
  END AS drift_seconds,
  md5(
    tlo.id::text || '|' ||
    COALESCE(public.evaluate_leg_hold_v3(
      tlo.kickoff_at,
      CASE WHEN fx.timestamp IS NULL THEN NULL ELSE to_timestamp(fx.timestamp) END,
      COALESCE(tlo.home_team_id_snapshot, tj.home_id),
      COALESCE(tlo.away_team_id_snapshot, tj.away_id),
      NULLIF(fx.teams_home->>'id','')::bigint,
      NULLIF(fx.teams_away->>'id','')::bigint,
      tj.home_name, tj.away_name,
      fx.teams_home->>'name', fx.teams_away->>'name'
    ), 'safe') || '|' ||
    COALESCE(tlo.settlement_hold_reason, '-') || '|' ||
    COALESCE(tlo.kickoff_at::text, '-') || '|' ||
    COALESCE(to_timestamp(fx.timestamp)::text, '-') || '|' ||
    COALESCE(COALESCE(tlo.home_team_id_snapshot, tj.home_id)::text, '-') || '|' ||
    COALESCE(COALESCE(tlo.away_team_id_snapshot, tj.away_id)::text, '-') || '|' ||
    COALESCE(NULLIF(fx.teams_home->>'id','')::text, '-') || '|' ||
    COALESCE(NULLIF(fx.teams_away->>'id','')::text, '-') || '|' ||
    COALESCE(public.normalize_team_name(tj.home_name), '-') || '|' ||
    COALESCE(public.normalize_team_name(tj.away_name), '-') || '|' ||
    COALESCE(public.normalize_team_name(fx.teams_home->>'name'), '-') || '|' ||
    COALESCE(public.normalize_team_name(fx.teams_away->>'name'), '-') || '|' ||
    COALESCE(fr.status, '-') || '|' ||
    COALESCE(fr.goals_home::text, '-') || '|' || COALESCE(fr.goals_away::text, '-') || '|' ||
    COALESCE(fr.corners_home::text, '-') || '|' || COALESCE(fr.corners_away::text, '-') || '|' ||
    COALESCE(fr.cards_home::text, '-') || '|' || COALESCE(fr.cards_away::text, '-')
  ) AS evidence_hash
FROM public.ticket_leg_outcomes tlo
LEFT JOIN public.fixtures fx ON fx.id = tlo.fixture_id
LEFT JOIN public.fixture_results fr ON fr.fixture_id = tlo.fixture_id
LEFT JOIN LATERAL (
  SELECT l->>'homeTeam' AS home_name,
         l->>'awayTeam' AS away_name,
         CASE WHEN jsonb_typeof(l->'homeTeamId') = 'number' THEN (l->>'homeTeamId')::bigint END AS home_id,
         CASE WHEN jsonb_typeof(l->'awayTeamId') = 'number' THEN (l->>'awayTeamId')::bigint END AS away_id
  FROM public.generated_tickets gt
  CROSS JOIN LATERAL jsonb_array_elements(gt.legs) AS l
  WHERE gt.id = tlo.ticket_id
    AND jsonb_typeof(l->'fixtureId') = 'number'
    AND (l->>'fixtureId')::bigint = tlo.fixture_id
  LIMIT 1
) tj ON true;

REVOKE ALL ON public.v_leg_settlement_evidence FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_leg_settlement_evidence TO service_role;

-- ---------- 4. HOLD V3: TRANSACTIONALLY SAFE PREVIEW / APPLY / RELEASE ----------
CREATE OR REPLACE FUNCTION public.preview_settlement_holds_v3(
  p_fixture_id bigint,
  p_after_leg_id uuid DEFAULT NULL,
  p_page_size integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_size integer;
  v_total bigint;
  v_rows jsonb;
  v_count integer;
  v_hash text;
  v_last uuid;
  v_more boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF p_fixture_id IS NULL OR p_fixture_id <= 0 THEN
    RAISE EXCEPTION 'fixture_id required';
  END IF;
  v_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 50);

  SELECT count(*) INTO v_total
  FROM public.v_leg_settlement_evidence ev
  WHERE ev.fixture_id = p_fixture_id
    AND ev.result_status = 'PENDING'
    AND ev.settlement_hold_reason IS NULL
    AND ev.hold_reason IS NOT NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'leg_id', t.leg_id, 'ticket_id', t.ticket_id, 'reason', t.hold_reason,
           'drift_seconds', t.drift_seconds) ORDER BY t.leg_id), '[]'::jsonb),
         count(*)::int,
         md5(COALESCE(string_agg(t.evidence_hash, '|' ORDER BY t.leg_id), '')),
         max(t.leg_id)
  INTO v_rows, v_count, v_hash, v_last
  FROM (
    SELECT ev.leg_id, ev.ticket_id, ev.hold_reason, ev.drift_seconds, ev.evidence_hash
    FROM public.v_leg_settlement_evidence ev
    WHERE ev.fixture_id = p_fixture_id
      AND ev.result_status = 'PENDING'
      AND ev.settlement_hold_reason IS NULL
      AND ev.hold_reason IS NOT NULL
      AND (p_after_leg_id IS NULL OR ev.leg_id > p_after_leg_id)
    ORDER BY ev.leg_id
    LIMIT v_size
  ) t;

  SELECT EXISTS (
    SELECT 1 FROM public.v_leg_settlement_evidence ev
    WHERE ev.fixture_id = p_fixture_id
      AND ev.result_status = 'PENDING'
      AND ev.settlement_hold_reason IS NULL
      AND ev.hold_reason IS NOT NULL
      AND ev.leg_id > COALESCE(v_last, p_after_leg_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) INTO v_more;

  RETURN jsonb_build_object(
    'fixture_id', p_fixture_id,
    'total_candidates', v_total,
    'page_size', v_size,
    'returned', v_count,
    'legs', v_rows,
    'has_more', v_more,
    'next_after_leg_id', v_last,
    'snapshot_hash', v_hash,
    'policy_version', 'reschedule-integrity-v3'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_settlement_holds_v3(
  p_fixture_id bigint,
  p_expected_leg_ids uuid[],
  p_expected_snapshot_hash text,
  p_confirmation text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hash text;
  v_applied integer := 0;
  v_ids uuid[];
  v_expected integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF p_confirmation IS DISTINCT FROM 'APPLY_SETTLEMENT_HOLDS_V3' THEN
    RAISE EXCEPTION 'confirmation_required';
  END IF;
  IF p_fixture_id IS NULL OR p_fixture_id <= 0 THEN
    RAISE EXCEPTION 'fixture_id required';
  END IF;
  IF p_expected_leg_ids IS NULL OR array_length(p_expected_leg_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'expected_leg_ids_required';
  END IF;
  IF array_position(p_expected_leg_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'expected_leg_ids_malformed';
  END IF;
  v_expected := array_length(p_expected_leg_ids, 1);
  IF v_expected > 50 THEN
    RAISE EXCEPTION 'expected_leg_ids_too_large';
  END IF;
  IF (SELECT count(DISTINCT id) FROM unnest(p_expected_leg_ids) AS id) <> v_expected THEN
    RAISE EXCEPTION 'expected_leg_ids_duplicated';
  END IF;

  PERFORM 1 FROM public.fixtures WHERE id = p_fixture_id FOR UPDATE;
  PERFORM 1 FROM public.fixture_results WHERE fixture_id = p_fixture_id FOR UPDATE;
  PERFORM 1
  FROM public.ticket_leg_outcomes tlo
  WHERE tlo.id = ANY(p_expected_leg_ids)
  ORDER BY tlo.id
  FOR UPDATE;

  SELECT array_agg(ev.leg_id ORDER BY ev.leg_id),
         md5(COALESCE(string_agg(ev.evidence_hash, '|' ORDER BY ev.leg_id), ''))
  INTO v_ids, v_hash
  FROM public.v_leg_settlement_evidence ev
  WHERE ev.leg_id = ANY(p_expected_leg_ids)
    AND ev.fixture_id = p_fixture_id
    AND ev.result_status = 'PENDING'
    AND ev.settlement_hold_reason IS NULL
    AND ev.hold_reason IS NOT NULL
    AND ev.score_claim_token IS NULL;

  IF v_ids IS NULL OR array_length(v_ids, 1) <> v_expected THEN
    RAISE EXCEPTION 'snapshot_mismatch: expected % legs, % remain unsafe/unclaimed',
      v_expected, COALESCE(array_length(v_ids, 1), 0);
  END IF;
  IF v_hash IS DISTINCT FROM p_expected_snapshot_hash THEN
    RAISE EXCEPTION 'snapshot_hash_mismatch';
  END IF;

  WITH upd AS (
    UPDATE public.ticket_leg_outcomes tlo
    SET settlement_hold_reason = ev.hold_reason,
        settlement_held_at = now(),
        settlement_policy_version = 'reschedule-integrity-v3',
        kickoff_drift_seconds = ev.drift_seconds
    FROM public.v_leg_settlement_evidence ev
    WHERE tlo.id = ev.leg_id AND tlo.id = ANY(p_expected_leg_ids)
    RETURNING tlo.id, tlo.ticket_id, tlo.fixture_id, ev.hold_reason, ev.drift_seconds
  ), aud AS (
    INSERT INTO public.settlement_hold_audit (leg_id, ticket_id, fixture_id, reason, drift_seconds, policy_version, actor, source)
    SELECT u.id, u.ticket_id, u.fixture_id, u.hold_reason, u.drift_seconds, 'reschedule-integrity-v3', 'service_role', 'apply_settlement_holds_v3'
    FROM upd u
    RETURNING 1
  )
  SELECT count(*) INTO v_applied FROM aud;

  IF v_applied <> v_expected THEN
    RAISE EXCEPTION 'apply_count_mismatch: expected %, applied %', v_expected, v_applied;
  END IF;

  PERFORM public.record_pipeline_alert(
    'settlement:hold:fixture:' || p_fixture_id,
    'settlement_hold',
    'warning',
    'Settlement holds applied for fixture ' || p_fixture_id,
    jsonb_build_object('fixture_id', p_fixture_id, 'applied', v_applied, 'snapshot_hash', v_hash)
  );

  RETURN jsonb_build_object('fixture_id', p_fixture_id, 'applied', v_applied, 'snapshot_hash', v_hash);
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_settlement_releases_v3(
  p_fixture_id bigint,
  p_after_leg_id uuid DEFAULT NULL,
  p_page_size integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_size integer;
  v_total bigint;
  v_rows jsonb;
  v_count integer;
  v_hash text;
  v_last uuid;
  v_more boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF p_fixture_id IS NULL OR p_fixture_id <= 0 THEN
    RAISE EXCEPTION 'fixture_id required';
  END IF;
  v_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 50);

  SELECT count(*) INTO v_total
  FROM public.v_leg_settlement_evidence ev
  WHERE ev.fixture_id = p_fixture_id
    AND ev.result_status = 'PENDING'
    AND ev.settlement_hold_reason IS NOT NULL
    AND ev.hold_reason IS NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('leg_id', t.leg_id, 'ticket_id', t.ticket_id,
           'current_reason', t.settlement_hold_reason, 'drift_seconds', t.drift_seconds) ORDER BY t.leg_id), '[]'::jsonb),
         count(*)::int,
         md5(COALESCE(string_agg(t.evidence_hash, '|' ORDER BY t.leg_id), '')),
         max(t.leg_id)
  INTO v_rows, v_count, v_hash, v_last
  FROM (
    SELECT ev.leg_id, ev.ticket_id, ev.settlement_hold_reason, ev.drift_seconds, ev.evidence_hash
    FROM public.v_leg_settlement_evidence ev
    WHERE ev.fixture_id = p_fixture_id
      AND ev.result_status = 'PENDING'
      AND ev.settlement_hold_reason IS NOT NULL
      AND ev.hold_reason IS NULL
      AND (p_after_leg_id IS NULL OR ev.leg_id > p_after_leg_id)
    ORDER BY ev.leg_id
    LIMIT v_size
  ) t;

  SELECT EXISTS (
    SELECT 1 FROM public.v_leg_settlement_evidence ev
    WHERE ev.fixture_id = p_fixture_id
      AND ev.result_status = 'PENDING'
      AND ev.settlement_hold_reason IS NOT NULL
      AND ev.hold_reason IS NULL
      AND ev.leg_id > COALESCE(v_last, p_after_leg_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) INTO v_more;

  RETURN jsonb_build_object('fixture_id', p_fixture_id, 'total_candidates', v_total,
    'page_size', v_size, 'returned', v_count, 'legs', v_rows, 'has_more', v_more,
    'next_after_leg_id', v_last, 'snapshot_hash', v_hash,
    'policy_version', 'reschedule-integrity-v3');
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_settlement_holds_v3(
  p_fixture_id bigint,
  p_expected_leg_ids uuid[],
  p_expected_snapshot_hash text,
  p_confirmation text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hash text;
  v_ids uuid[];
  v_released integer := 0;
  v_remaining bigint;
  v_expected integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF p_confirmation IS DISTINCT FROM 'RELEASE_SETTLEMENT_HOLDS_V3' THEN
    RAISE EXCEPTION 'confirmation_required';
  END IF;
  IF p_fixture_id IS NULL OR p_fixture_id <= 0 THEN
    RAISE EXCEPTION 'fixture_id required';
  END IF;
  IF p_expected_leg_ids IS NULL OR array_length(p_expected_leg_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'expected_leg_ids_required';
  END IF;
  IF array_position(p_expected_leg_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'expected_leg_ids_malformed';
  END IF;
  v_expected := array_length(p_expected_leg_ids, 1);
  IF v_expected > 50 THEN
    RAISE EXCEPTION 'expected_leg_ids_too_large';
  END IF;
  IF (SELECT count(DISTINCT id) FROM unnest(p_expected_leg_ids) AS id) <> v_expected THEN
    RAISE EXCEPTION 'expected_leg_ids_duplicated';
  END IF;

  PERFORM 1 FROM public.fixtures WHERE id = p_fixture_id FOR UPDATE;
  PERFORM 1 FROM public.fixture_results WHERE fixture_id = p_fixture_id FOR UPDATE;
  PERFORM 1 FROM public.ticket_leg_outcomes tlo
  WHERE tlo.id = ANY(p_expected_leg_ids) ORDER BY tlo.id FOR UPDATE;

  SELECT array_agg(ev.leg_id ORDER BY ev.leg_id),
         md5(COALESCE(string_agg(ev.evidence_hash, '|' ORDER BY ev.leg_id), ''))
  INTO v_ids, v_hash
  FROM public.v_leg_settlement_evidence ev
  WHERE ev.leg_id = ANY(p_expected_leg_ids)
    AND ev.fixture_id = p_fixture_id
    AND ev.result_status = 'PENDING'
    AND ev.settlement_hold_reason IS NOT NULL
    AND ev.hold_reason IS NULL
    AND ev.score_claim_token IS NULL;

  IF v_ids IS NULL OR array_length(v_ids, 1) <> v_expected THEN
    RAISE EXCEPTION 'snapshot_mismatch';
  END IF;
  IF v_hash IS DISTINCT FROM p_expected_snapshot_hash THEN
    RAISE EXCEPTION 'snapshot_hash_mismatch';
  END IF;

  WITH upd AS (
    UPDATE public.ticket_leg_outcomes tlo
    SET settlement_hold_reason = NULL,
        settlement_held_at = NULL,
        settlement_policy_version = 'reschedule-integrity-v3'
    WHERE tlo.id = ANY(p_expected_leg_ids)
    RETURNING tlo.id, tlo.ticket_id, tlo.fixture_id, tlo.kickoff_drift_seconds
  ), aud AS (
    INSERT INTO public.settlement_hold_audit (leg_id, ticket_id, fixture_id, reason, drift_seconds, policy_version, actor, source)
    SELECT u.id, u.ticket_id, u.fixture_id, 'released', u.kickoff_drift_seconds, 'reschedule-integrity-v3', 'service_role', 'release_settlement_holds_v3'
    FROM upd u RETURNING 1
  )
  SELECT count(*) INTO v_released FROM aud;

  IF v_released <> v_expected THEN
    RAISE EXCEPTION 'release_count_mismatch: expected %, released %', v_expected, v_released;
  END IF;

  SELECT count(*) INTO v_remaining
  FROM public.ticket_leg_outcomes
  WHERE fixture_id = p_fixture_id AND settlement_hold_reason IS NOT NULL;

  IF v_remaining = 0 THEN
    PERFORM public.resolve_pipeline_alert('settlement:hold:fixture:' || p_fixture_id);
    UPDATE public.pipeline_alerts
    SET resolved_at = now(), resolved_by = 'release_settlement_holds_v3'
    WHERE resolved_at IS NULL
      AND fingerprint LIKE ('leg_hold:' || p_fixture_id || ':%');
  END IF;

  RETURN jsonb_build_object('fixture_id', p_fixture_id, 'released', v_released,
    'remaining_held', v_remaining, 'snapshot_hash', v_hash);
END;
$function$;

-- ---------- 5. LEGACY HOLD-ALERT RECONCILIATION (audit history preserved) ----------
DO $reconcile$
DECLARE
  r record;
  v_held bigint;
BEGIN
  FOR r IN
    SELECT DISTINCT split_part(fingerprint, ':', 2)::bigint AS fixture_id
    FROM public.pipeline_alerts
    WHERE resolved_at IS NULL
      AND fingerprint LIKE 'leg_hold:%'
      AND split_part(fingerprint, ':', 2) ~ '^[0-9]+$'
  LOOP
    SELECT count(*) INTO v_held
    FROM public.ticket_leg_outcomes
    WHERE fixture_id = r.fixture_id AND settlement_hold_reason IS NOT NULL;

    IF v_held > 0 THEN
      INSERT INTO public.pipeline_alerts (fingerprint, alert_type, severity, message, details, last_seen_at)
      SELECT 'settlement:hold:fixture:' || r.fixture_id,
             'settlement_hold', 'warning',
             'Settlement holds present for fixture ' || r.fixture_id,
             jsonb_build_object('fixture_id', r.fixture_id, 'held_legs', v_held,
                                'migrated_from', 'leg_hold_v2_fingerprint'),
             now()
      WHERE NOT EXISTS (
        SELECT 1 FROM public.pipeline_alerts
        WHERE fingerprint = 'settlement:hold:fixture:' || r.fixture_id
          AND resolved_at IS NULL
      );
    END IF;

    UPDATE public.pipeline_alerts
    SET resolved_at = now(),
        resolved_by = 'rc3.1-hold-alert-reconciliation'
    WHERE resolved_at IS NULL
      AND fingerprint LIKE ('leg_hold:' || r.fixture_id || ':%');
  END LOOP;
END;
$reconcile$;

-- ---------- 7. ATOMIC, STALE-PROOF FINALIZATION ----------
CREATE OR REPLACE FUNCTION public.finalize_scored_ticket_leg(
  p_leg_id uuid,
  p_claim_token uuid,
  p_result_status text,
  p_actual_value numeric,
  p_scored_version text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'retired: use finalize_scored_ticket_leg(uuid,uuid,text,numeric,text,text) with the scored result fingerprint';
END;
$function$;
REVOKE ALL ON FUNCTION public.finalize_scored_ticket_leg(uuid,uuid,text,numeric,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finalize_scored_ticket_leg(
  p_leg_id uuid,
  p_claim_token uuid,
  p_result_status text,
  p_actual_value numeric,
  p_scored_version text,
  p_result_fingerprint text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_leg public.ticket_leg_outcomes%ROWTYPE;
  v_reason text;
  v_drift bigint;
  v_fingerprint text;
  v_ticket_status text;
  v_updated integer;
BEGIN
  IF auth.role() <> 'service_role' OR p_result_status NOT IN ('WIN', 'LOSS', 'PUSH', 'VOID') THEN
    RAISE EXCEPTION 'invalid score finalization request';
  END IF;
  IF p_result_fingerprint IS NULL OR btrim(p_result_fingerprint) = '' THEN
    RAISE EXCEPTION 'result_fingerprint_required';
  END IF;

  SELECT * INTO v_leg
  FROM public.ticket_leg_outcomes
  WHERE id = p_leg_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('settled', false, 'outcome', 'leg_not_found');
  END IF;
  IF v_leg.result_status <> 'PENDING' THEN
    RETURN jsonb_build_object('settled', false, 'outcome', 'not_pending');
  END IF;
  IF v_leg.settlement_hold_reason IS NOT NULL THEN
    RETURN jsonb_build_object('settled', false, 'outcome', 'already_held');
  END IF;
  IF v_leg.score_claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object('settled', false, 'outcome', 'claim_lost');
  END IF;

  PERFORM 1 FROM public.fixtures WHERE id = v_leg.fixture_id FOR UPDATE;
  PERFORM 1 FROM public.fixture_results WHERE fixture_id = v_leg.fixture_id FOR UPDATE;

  SELECT hold_reason, drift_seconds, result_fingerprint
  INTO v_reason, v_drift, v_fingerprint
  FROM public.v_leg_settlement_evidence WHERE leg_id = p_leg_id;

  IF v_reason IS NOT NULL THEN
    UPDATE public.ticket_leg_outcomes
    SET settlement_hold_reason = v_reason,
        settlement_held_at = now(),
        settlement_policy_version = 'reschedule-integrity-v3',
        kickoff_drift_seconds = v_drift,
        score_claim_token = NULL,
        score_claimed_at = NULL
    WHERE id = p_leg_id;

    INSERT INTO public.settlement_hold_audit (leg_id, ticket_id, fixture_id, reason, drift_seconds, policy_version, actor, source)
    VALUES (p_leg_id, v_leg.ticket_id, v_leg.fixture_id, v_reason, v_drift, 'reschedule-integrity-v3', 'service_role', 'finalize_scored_ticket_leg');

    PERFORM public.record_pipeline_alert(
      'settlement:hold:fixture:' || v_leg.fixture_id,
      'settlement_hold',
      'warning',
      'Settlement hold applied during scoring for fixture ' || v_leg.fixture_id,
      jsonb_build_object('fixture_id', v_leg.fixture_id, 'leg_id', p_leg_id, 'reason', v_reason)
    );

    RETURN jsonb_build_object('settled', false, 'outcome', 'held', 'reason', v_reason);
  END IF;

  IF v_fingerprint IS DISTINCT FROM p_result_fingerprint THEN
    UPDATE public.ticket_leg_outcomes
    SET score_claim_token = NULL, score_claimed_at = NULL
    WHERE id = p_leg_id;
    RETURN jsonb_build_object('settled', false, 'outcome', 'stale_result_evidence');
  END IF;

  UPDATE public.ticket_leg_outcomes
  SET result_status = p_result_status,
      actual_value = p_actual_value,
      settled_at = now(),
      scored_version = p_scored_version,
      settlement_policy_version = 'reschedule-integrity-v3',
      score_claim_token = NULL,
      score_claimed_at = NULL
  WHERE id = p_leg_id
    AND result_status = 'PENDING'
    AND settlement_hold_reason IS NULL
    AND score_claim_token = p_claim_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'finalization_write_failed';
  END IF;

  v_ticket_status := public.refresh_ticket_outcome(v_leg.ticket_id);
  IF v_ticket_status IS NULL THEN
    RAISE EXCEPTION 'ticket_refresh_failed';
  END IF;

  RETURN jsonb_build_object('settled', true, 'outcome', 'settled',
                            'ticket_id', v_leg.ticket_id, 'ticket_status', v_ticket_status);
END;
$function$;
REVOKE ALL ON FUNCTION public.finalize_scored_ticket_leg(uuid,uuid,text,numeric,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_scored_ticket_leg(uuid,uuid,text,numeric,text,text) TO service_role;

DROP FUNCTION IF EXISTS public.claim_scorable_ticket_legs(integer);
CREATE OR REPLACE FUNCTION public.claim_scorable_ticket_legs(batch_limit integer DEFAULT NULL)
RETURNS TABLE(claim_token uuid, leg_id uuid, ticket_id uuid, user_id uuid, fixture_id bigint, market text, side text, line numeric, goals_home smallint, goals_away smallint, corners_home smallint, corners_away smallint, cards_home smallint, cards_away smallint, result_fingerprint text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_claim_token uuid := gen_random_uuid();
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF batch_limit IS NULL OR batch_limit < 1 OR batch_limit > 500 THEN
    RAISE EXCEPTION 'batch_limit_required_1_to_500';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT tlo.id
    FROM public.ticket_leg_outcomes tlo
    JOIN public.ticket_outcomes ticket ON ticket.ticket_id = tlo.ticket_id
    JOIN public.fixture_results fr ON fr.fixture_id = tlo.fixture_id AND fr.status = 'FT'
    JOIN public.v_leg_settlement_evidence ev ON ev.leg_id = tlo.id
    WHERE tlo.result_status = 'PENDING'
      AND tlo.settlement_hold_reason IS NULL
      AND ev.hold_reason IS NULL
      AND tlo.kickoff_at < now() - interval '2 hours'
      AND (tlo.score_claimed_at IS NULL OR tlo.score_claimed_at < now() - interval '10 minutes')
      AND lower(tlo.side) IN ('over', 'under')
      AND tlo.line IS NOT NULL
      AND CASE lower(tlo.market)
        WHEN 'goals' THEN fr.goals_home IS NOT NULL AND fr.goals_away IS NOT NULL
        WHEN 'total_goals' THEN fr.goals_home IS NOT NULL AND fr.goals_away IS NOT NULL
        WHEN 'over_under' THEN fr.goals_home IS NOT NULL AND fr.goals_away IS NOT NULL
        WHEN 'corners' THEN fr.corners_home IS NOT NULL AND fr.corners_away IS NOT NULL
        WHEN 'total_corners' THEN fr.corners_home IS NOT NULL AND fr.corners_away IS NOT NULL
        WHEN 'cards' THEN fr.cards_home IS NOT NULL AND fr.cards_away IS NOT NULL
        WHEN 'total_cards' THEN fr.cards_home IS NOT NULL AND fr.cards_away IS NOT NULL
        ELSE false
      END
    ORDER BY tlo.kickoff_at ASC, tlo.id ASC
    LIMIT batch_limit
    FOR UPDATE OF tlo SKIP LOCKED
  ), claimed AS (
    UPDATE public.ticket_leg_outcomes tlo
    SET score_claim_token = v_claim_token,
        score_claimed_at = now(),
        score_attempts = tlo.score_attempts + 1
    FROM candidates c
    WHERE tlo.id = c.id
    RETURNING tlo.*
  )
  SELECT v_claim_token, c.id, c.ticket_id, c.user_id, c.fixture_id, c.market, c.side, c.line,
         fr.goals_home, fr.goals_away, fr.corners_home, fr.corners_away, fr.cards_home, fr.cards_away,
         ev.result_fingerprint
  FROM claimed c
  JOIN public.fixture_results fr ON fr.fixture_id = c.fixture_id
  JOIN public.v_leg_settlement_evidence ev ON ev.leg_id = c.id
  ORDER BY c.kickoff_at ASC, c.id ASC;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_scorable_ticket_legs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scorable_ticket_legs(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_scorable_pending_legs(batch_limit integer DEFAULT 500)
RETURNS TABLE(leg_id uuid, ticket_id uuid, user_id uuid, fixture_id bigint, market text, side text, line numeric, goals_home smallint, goals_away smallint, corners_home smallint, corners_away smallint, cards_home smallint, cards_away smallint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'retired: use public.claim_scorable_ticket_legs(batch_limit) which returns the result fingerprint';
END;
$function$;
REVOKE ALL ON FUNCTION public.get_scorable_pending_legs(integer) FROM PUBLIC, anon, authenticated;

-- ---------- 8. INGESTION: TERMINAL POLICY + NO STALE STAT CARRY-OVER ----------
CREATE OR REPLACE FUNCTION public.ingest_fixture_result_tx(
  p_fixture_id bigint, p_league_id bigint, p_status text, p_kickoff_at timestamptz,
  p_home_team_id bigint, p_away_team_id bigint, p_goals_home integer, p_goals_away integer,
  p_stats jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'retired: use ingest_fixture_result_tx(... , p_home_team_name, p_away_team_name, ...)';
END;
$function$;
REVOKE ALL ON FUNCTION public.ingest_fixture_result_tx(bigint,bigint,text,timestamptz,bigint,bigint,integer,integer,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ingest_fixture_result_tx(
  p_fixture_id bigint,
  p_league_id bigint,
  p_status text,
  p_kickoff_at timestamptz,
  p_home_team_id bigint,
  p_away_team_id bigint,
  p_home_team_name text,
  p_away_team_name text,
  p_goals_home integer,
  p_goals_away integer,
  p_stats jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_exists boolean;
  v_prev public.fixture_results%ROWTYPE;
  v_identity_changed boolean := false;
  v_scorable boolean;
  v_policy text;
  v_held integer := 0;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('FT', 'AET', 'PEN', 'AWD', 'WO') THEN
    RAISE EXCEPTION 'invalid_terminal_status';
  END IF;
  IF p_fixture_id IS NULL OR p_fixture_id <= 0 THEN
    RAISE EXCEPTION 'invalid_fixture_id';
  END IF;
  IF p_league_id IS NULL OR p_league_id <= 0 THEN
    RAISE EXCEPTION 'invalid_league_id';
  END IF;
  IF p_home_team_id IS NULL OR p_home_team_id <= 0 OR p_away_team_id IS NULL OR p_away_team_id <= 0
     OR p_home_team_id = p_away_team_id THEN
    RAISE EXCEPTION 'invalid_team_ids';
  END IF;
  IF p_kickoff_at IS NULL OR p_goals_home IS NULL OR p_goals_away IS NULL
     OR p_goals_home < 0 OR p_goals_away < 0 THEN
    RAISE EXCEPTION 'invalid_ingestion_payload';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.fixtures WHERE id = p_fixture_id) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'unknown_local_fixture';
  END IF;

  PERFORM 1 FROM public.fixtures WHERE id = p_fixture_id FOR UPDATE;
  SELECT * INTO v_prev FROM public.fixture_results WHERE fixture_id = p_fixture_id FOR UPDATE;

  IF FOUND THEN
    v_identity_changed :=
      v_prev.goals_home IS DISTINCT FROM p_goals_home::smallint
      OR v_prev.goals_away IS DISTINCT FROM p_goals_away::smallint
      OR v_prev.kickoff_at IS DISTINCT FROM p_kickoff_at
      OR v_prev.status IS DISTINCT FROM p_status;
  END IF;

  UPDATE public.fixtures
  SET status = p_status,
      timestamp = EXTRACT(epoch FROM p_kickoff_at)::bigint,
      date = p_kickoff_at,
      teams_home = jsonb_strip_nulls(
        COALESCE(teams_home, '{}'::jsonb)
        || jsonb_build_object('id', p_home_team_id, 'name', p_home_team_name)),
      teams_away = jsonb_strip_nulls(
        COALESCE(teams_away, '{}'::jsonb)
        || jsonb_build_object('id', p_away_team_id, 'name', p_away_team_name)),
      updated_at = now()
  WHERE id = p_fixture_id;

  INSERT INTO public.fixture_results (
    fixture_id, league_id, kickoff_at, finished_at, goals_home, goals_away,
    corners_home, corners_away, cards_home, cards_away, fouls_home, fouls_away,
    offsides_home, offsides_away, status, source, fetched_at
  ) VALUES (
    p_fixture_id, p_league_id, p_kickoff_at, now(), p_goals_home, p_goals_away,
    NULLIF(p_stats->>'corners_home','')::smallint, NULLIF(p_stats->>'corners_away','')::smallint,
    NULLIF(p_stats->>'cards_home','')::smallint, NULLIF(p_stats->>'cards_away','')::smallint,
    NULLIF(p_stats->>'fouls_home','')::smallint, NULLIF(p_stats->>'fouls_away','')::smallint,
    NULLIF(p_stats->>'offsides_home','')::smallint, NULLIF(p_stats->>'offsides_away','')::smallint,
    p_status, 'api-football', now()
  )
  ON CONFLICT (fixture_id) DO UPDATE SET
    league_id = EXCLUDED.league_id,
    kickoff_at = EXCLUDED.kickoff_at,
    finished_at = EXCLUDED.finished_at,
    goals_home = EXCLUDED.goals_home,
    goals_away = EXCLUDED.goals_away,
    corners_home = CASE WHEN v_identity_changed THEN EXCLUDED.corners_home
                        ELSE COALESCE(EXCLUDED.corners_home, public.fixture_results.corners_home) END,
    corners_away = CASE WHEN v_identity_changed THEN EXCLUDED.corners_away
                        ELSE COALESCE(EXCLUDED.corners_away, public.fixture_results.corners_away) END,
    cards_home = CASE WHEN v_identity_changed THEN EXCLUDED.cards_home
                      ELSE COALESCE(EXCLUDED.cards_home, public.fixture_results.cards_home) END,
    cards_away = CASE WHEN v_identity_changed THEN EXCLUDED.cards_away
                      ELSE COALESCE(EXCLUDED.cards_away, public.fixture_results.cards_away) END,
    fouls_home = CASE WHEN v_identity_changed THEN EXCLUDED.fouls_home
                      ELSE COALESCE(EXCLUDED.fouls_home, public.fixture_results.fouls_home) END,
    fouls_away = CASE WHEN v_identity_changed THEN EXCLUDED.fouls_away
                      ELSE COALESCE(EXCLUDED.fouls_away, public.fixture_results.fouls_away) END,
    offsides_home = CASE WHEN v_identity_changed THEN EXCLUDED.offsides_home
                         ELSE COALESCE(EXCLUDED.offsides_home, public.fixture_results.offsides_home) END,
    offsides_away = CASE WHEN v_identity_changed THEN EXCLUDED.offsides_away
                         ELSE COALESCE(EXCLUDED.offsides_away, public.fixture_results.offsides_away) END,
    status = EXCLUDED.status,
    source = EXCLUDED.source,
    fetched_at = EXCLUDED.fetched_at;

  v_scorable := (p_status = 'FT');
  v_policy := CASE WHEN v_scorable THEN 'scorable_ft' ELSE 'manual_review_non_terminal' END;

  IF NOT v_scorable THEN
    WITH upd AS (
      UPDATE public.ticket_leg_outcomes tlo
      SET settlement_hold_reason = 'manual_review_non_terminal',
          settlement_held_at = now(),
          settlement_policy_version = 'reschedule-integrity-v3',
          score_claim_token = NULL,
          score_claimed_at = NULL
      WHERE tlo.fixture_id = p_fixture_id
        AND tlo.result_status = 'PENDING'
        AND tlo.settlement_hold_reason IS NULL
      RETURNING tlo.id, tlo.ticket_id, tlo.fixture_id
    ), aud AS (
      INSERT INTO public.settlement_hold_audit (leg_id, ticket_id, fixture_id, reason, policy_version, actor, source)
      SELECT u.id, u.ticket_id, u.fixture_id, 'manual_review_non_terminal', 'reschedule-integrity-v3',
             'service_role', 'ingest_fixture_result_tx'
      FROM upd u RETURNING 1
    )
    SELECT count(*) INTO v_held FROM aud;

    IF v_held > 0 THEN
      PERFORM public.record_pipeline_alert(
        'settlement:hold:fixture:' || p_fixture_id,
        'settlement_hold', 'warning',
        'Non-terminal-FT result requires manual review for fixture ' || p_fixture_id,
        jsonb_build_object('fixture_id', p_fixture_id, 'status', p_status, 'held_legs', v_held)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('fixture_id', p_fixture_id, 'status', p_status, 'written', true,
                            'scorable', v_scorable, 'policy', v_policy, 'held_legs', v_held);
END;
$function$;
REVOKE ALL ON FUNCTION public.ingest_fixture_result_tx(bigint,bigint,text,timestamptz,bigint,bigint,text,text,integer,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_fixture_result_tx(bigint,bigint,text,timestamptz,bigint,bigint,text,text,integer,integer,jsonb) TO service_role;

-- ---------- 9. HEALTH METRICS ALIGNED TO THE CLAIM PREDICATE ----------
CREATE OR REPLACE FUNCTION public.get_ticket_pipeline_health_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_missing_actionable bigint;
  v_missing_historical bigint;
  v_pending_with_ft bigint;
  v_held bigint;
  v_unsafe bigint;
  v_last_success timestamptz;
  v_last_progress timestamptz;
  v_scored_24h bigint;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  SELECT
    count(*) FILTER (WHERE tlo.kickoff_at >= now() - interval '30 days'),
    count(*) FILTER (WHERE tlo.kickoff_at <  now() - interval '30 days')
  INTO v_missing_actionable, v_missing_historical
  FROM public.ticket_leg_outcomes tlo
  WHERE tlo.result_status = 'PENDING'
    AND tlo.settlement_hold_reason IS NULL
    AND tlo.kickoff_at < now() - interval '2 hours'
    AND NOT EXISTS (SELECT 1 FROM public.fixture_results fr WHERE fr.fixture_id = tlo.fixture_id);

  SELECT count(*) INTO v_pending_with_ft
  FROM public.ticket_leg_outcomes tlo
  JOIN public.ticket_outcomes ticket ON ticket.ticket_id = tlo.ticket_id
  JOIN public.fixture_results fr ON fr.fixture_id = tlo.fixture_id AND fr.status = 'FT'
  JOIN public.v_leg_settlement_evidence ev ON ev.leg_id = tlo.id
  WHERE tlo.result_status = 'PENDING'
    AND tlo.settlement_hold_reason IS NULL
    AND ev.hold_reason IS NULL
    AND tlo.kickoff_at < now() - interval '2 hours'
    AND (tlo.score_claimed_at IS NULL OR tlo.score_claimed_at < now() - interval '10 minutes')
    AND lower(tlo.side) IN ('over', 'under')
    AND tlo.line IS NOT NULL
    AND CASE lower(tlo.market)
      WHEN 'goals' THEN fr.goals_home IS NOT NULL AND fr.goals_away IS NOT NULL
      WHEN 'total_goals' THEN fr.goals_home IS NOT NULL AND fr.goals_away IS NOT NULL
      WHEN 'over_under' THEN fr.goals_home IS NOT NULL AND fr.goals_away IS NOT NULL
      WHEN 'corners' THEN fr.corners_home IS NOT NULL AND fr.corners_away IS NOT NULL
      WHEN 'total_corners' THEN fr.corners_home IS NOT NULL AND fr.corners_away IS NOT NULL
      WHEN 'cards' THEN fr.cards_home IS NOT NULL AND fr.cards_away IS NOT NULL
      WHEN 'total_cards' THEN fr.cards_home IS NOT NULL AND fr.cards_away IS NOT NULL
      ELSE false
    END;

  SELECT count(*) INTO v_held
  FROM public.ticket_leg_outcomes
  WHERE result_status = 'PENDING' AND settlement_hold_reason IS NOT NULL;

  SELECT count(*) INTO v_unsafe
  FROM public.v_leg_settlement_evidence ev
  WHERE ev.result_status = 'PENDING' AND ev.settlement_hold_reason IS NULL AND ev.hold_reason IS NOT NULL;

  SELECT max(run_finished) FILTER (WHERE success),
         max(run_finished) FILTER (WHERE success AND scored_legs > 0)
  INTO v_last_success, v_last_progress
  FROM public.scorer_run_logs;

  SELECT count(*) INTO v_scored_24h
  FROM public.ticket_leg_outcomes
  WHERE settled_at >= now() - interval '24 hours';

  RETURN jsonb_build_object(
    'pending_missing_fixture_results', v_missing_actionable + v_missing_historical,
    'pending_missing_actionable_30d', v_missing_actionable,
    'pending_missing_historical', v_missing_historical,
    'pending_with_ft_results', v_pending_with_ft,
    'pending_held', v_held,
    'pending_unsafe_unheld', v_unsafe,
    'scorer_last_success_at', v_last_success,
    'scorer_last_progress_at', v_last_progress,
    'legs_settled_24h', v_scored_24h,
    'scorer_stalled', (v_pending_with_ft > 0 AND (v_last_progress IS NULL OR v_last_progress < now() - interval '6 hours')),
    'policy_version', 'reschedule-integrity-v3'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_ticket_pipeline_health_metrics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ticket_pipeline_health_metrics() TO service_role;