-- ============================================================
-- GATE D PRODUCTION-INTEGRITY RC3 (forward-only)
-- ============================================================

-- ---------- 2. GENERATED TICKETS IMMUTABLE TO CLIENTS ----------
DROP POLICY IF EXISTS "Users can insert their own tickets" ON public.generated_tickets;
DROP POLICY IF EXISTS "Users can update their own tickets" ON public.generated_tickets;
DROP POLICY IF EXISTS "Users can delete their own tickets" ON public.generated_tickets;

REVOKE INSERT, UPDATE, DELETE ON public.generated_tickets FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ticket_outcomes FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.ticket_leg_outcomes FROM anon, authenticated;
GRANT SELECT ON public.generated_tickets TO authenticated;
GRANT ALL ON public.generated_tickets TO service_role;

-- ---------- CANONICAL EVALUATOR V3 (fail-closed) ----------
CREATE OR REPLACE FUNCTION public.evaluate_leg_hold_v3(
  p_leg_kickoff timestamptz,
  p_fixture_kickoff timestamptz,
  p_leg_home_id bigint,
  p_leg_away_id bigint,
  p_fx_home_id bigint,
  p_fx_away_id bigint,
  p_leg_home_name text,
  p_leg_away_name text,
  p_fx_home_name text,
  p_fx_away_name text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_lh text; v_la text; v_fh text; v_fa text;
BEGIN
  IF p_leg_home_id IS NOT NULL AND p_leg_away_id IS NOT NULL
     AND p_fx_home_id IS NOT NULL AND p_fx_away_id IS NOT NULL THEN
    IF NOT (p_leg_home_id = p_fx_home_id AND p_leg_away_id = p_fx_away_id) THEN
      RETURN 'team_direction_mismatch';
    END IF;
  ELSE
    v_lh := public.normalize_team_name(p_leg_home_name);
    v_la := public.normalize_team_name(p_leg_away_name);
    v_fh := public.normalize_team_name(p_fx_home_name);
    v_fa := public.normalize_team_name(p_fx_away_name);
    IF v_lh IS NULL OR v_la IS NULL OR v_fh IS NULL OR v_fa IS NULL THEN
      RETURN 'identity_unverifiable';
    END IF;
    IF NOT (v_lh = v_fh AND v_la = v_fa) THEN
      RETURN 'team_direction_mismatch';
    END IF;
  END IF;

  IF p_leg_kickoff IS NULL OR p_fixture_kickoff IS NULL THEN
    RETURN 'kickoff_unverifiable';
  END IF;

  IF abs(EXTRACT(epoch FROM (p_fixture_kickoff - p_leg_kickoff))) > 86400 THEN
    RETURN 'kickoff_drift';
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.evaluate_leg_hold_v3(timestamptz,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_leg_hold_v3(timestamptz,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text) TO service_role;

-- ---------- SHARED EVIDENCE VIEW ----------
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
  END AS drift_seconds
FROM public.ticket_leg_outcomes tlo
LEFT JOIN public.fixtures fx ON fx.id = tlo.fixture_id
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

CREATE OR REPLACE FUNCTION public.leg_hold_reason(p_leg_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT hold_reason FROM public.v_leg_settlement_evidence WHERE leg_id = p_leg_id
$function$;
REVOKE ALL ON FUNCTION public.leg_hold_reason(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leg_hold_reason(uuid) TO service_role;

-- ---------- 4. CLAIM USES CANONICAL EVALUATOR ----------
CREATE OR REPLACE FUNCTION public.claim_scorable_ticket_legs(batch_limit integer DEFAULT 500)
RETURNS TABLE(claim_token uuid, leg_id uuid, ticket_id uuid, user_id uuid, fixture_id bigint, market text, side text, line numeric, goals_home smallint, goals_away smallint, corners_home smallint, corners_away smallint, cards_home smallint, cards_away smallint)
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
    LIMIT LEAST(GREATEST(COALESCE(batch_limit, 500), 1), 1000)
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
         fr.goals_home, fr.goals_away, fr.corners_home, fr.corners_away, fr.cards_home, fr.cards_away
  FROM claimed c
  JOIN public.fixture_results fr ON fr.fixture_id = c.fixture_id
  ORDER BY c.kickoff_at ASC, c.id ASC;
END;
$function$;

-- ---------- 4. FINALIZE: LOCK + RECHECK ----------
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
DECLARE
  v_leg public.ticket_leg_outcomes%ROWTYPE;
  v_reason text;
  v_drift bigint;
BEGIN
  IF auth.role() <> 'service_role' OR p_result_status NOT IN ('WIN', 'LOSS', 'PUSH', 'VOID') THEN
    RAISE EXCEPTION 'invalid score finalization request';
  END IF;

  SELECT * INTO v_leg
  FROM public.ticket_leg_outcomes
  WHERE id = p_leg_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;
  IF v_leg.result_status <> 'PENDING' THEN RETURN false; END IF;
  IF v_leg.settlement_hold_reason IS NOT NULL THEN RETURN false; END IF;
  IF v_leg.score_claim_token IS DISTINCT FROM p_claim_token THEN RETURN false; END IF;

  -- Lock the current fixture row so a concurrent reschedule cannot slip in.
  PERFORM 1 FROM public.fixtures WHERE id = v_leg.fixture_id FOR UPDATE;

  SELECT hold_reason, drift_seconds INTO v_reason, v_drift
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

    RETURN false;
  END IF;

  UPDATE public.ticket_leg_outcomes
  SET result_status = p_result_status,
      actual_value = p_actual_value,
      settled_at = now(),
      scored_version = p_scored_version,
      score_claim_token = NULL,
      score_claimed_at = NULL
  WHERE id = p_leg_id
    AND result_status = 'PENDING'
    AND settlement_hold_reason IS NULL
    AND score_claim_token = p_claim_token;

  RETURN FOUND;
END;
$function$;

-- ---------- 5. HOLD V3 ----------
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
         md5(COALESCE(string_agg(t.leg_id::text || ':' || t.hold_reason, '|' ORDER BY t.leg_id), ''))
  INTO v_rows, v_count, v_hash
  FROM (
    SELECT ev.leg_id, ev.ticket_id, ev.hold_reason, ev.drift_seconds
    FROM public.v_leg_settlement_evidence ev
    WHERE ev.fixture_id = p_fixture_id
      AND ev.result_status = 'PENDING'
      AND ev.settlement_hold_reason IS NULL
      AND ev.hold_reason IS NOT NULL
      AND (p_after_leg_id IS NULL OR ev.leg_id > p_after_leg_id)
    ORDER BY ev.leg_id
    LIMIT v_size
  ) t;

  RETURN jsonb_build_object(
    'fixture_id', p_fixture_id,
    'total_candidates', v_total,
    'page_size', v_size,
    'returned', v_count,
    'legs', v_rows,
    'has_more', (SELECT EXISTS (
        SELECT 1 FROM public.v_leg_settlement_evidence ev
        WHERE ev.fixture_id = p_fixture_id
          AND ev.result_status = 'PENDING'
          AND ev.settlement_hold_reason IS NULL
          AND ev.hold_reason IS NOT NULL
          AND ev.leg_id > COALESCE((v_rows -> (v_count - 1) ->> 'leg_id')::uuid, p_after_leg_id, '00000000-0000-0000-0000-000000000000'::uuid)
      )),
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
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF p_confirmation IS DISTINCT FROM 'APPLY_SETTLEMENT_HOLDS_V3' THEN
    RAISE EXCEPTION 'confirmation_required';
  END IF;
  IF p_expected_leg_ids IS NULL OR array_length(p_expected_leg_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'expected_leg_ids_required';
  END IF;
  IF array_length(p_expected_leg_ids, 1) > 50 THEN
    RAISE EXCEPTION 'expected_leg_ids_too_large';
  END IF;

  -- Exact lock, no SKIP LOCKED, deterministic order.
  PERFORM 1
  FROM public.ticket_leg_outcomes tlo
  WHERE tlo.id = ANY(p_expected_leg_ids)
  ORDER BY tlo.id
  FOR UPDATE;

  SELECT array_agg(ev.leg_id ORDER BY ev.leg_id),
         md5(COALESCE(string_agg(ev.leg_id::text || ':' || ev.hold_reason, '|' ORDER BY ev.leg_id), ''))
  INTO v_ids, v_hash
  FROM public.v_leg_settlement_evidence ev
  WHERE ev.leg_id = ANY(p_expected_leg_ids)
    AND ev.fixture_id = p_fixture_id
    AND ev.result_status = 'PENDING'
    AND ev.settlement_hold_reason IS NULL
    AND ev.hold_reason IS NOT NULL
    AND ev.score_claim_token IS NULL;

  IF v_ids IS NULL OR array_length(v_ids, 1) <> array_length(p_expected_leg_ids, 1) THEN
    RAISE EXCEPTION 'snapshot_mismatch: expected % legs, % remain unsafe/unclaimed',
      array_length(p_expected_leg_ids, 1), COALESCE(array_length(v_ids, 1), 0);
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
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
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
         md5(COALESCE(string_agg(t.leg_id::text || ':' || t.settlement_hold_reason, '|' ORDER BY t.leg_id), ''))
  INTO v_rows, v_count, v_hash
  FROM (
    SELECT ev.leg_id, ev.ticket_id, ev.settlement_hold_reason, ev.drift_seconds
    FROM public.v_leg_settlement_evidence ev
    WHERE ev.fixture_id = p_fixture_id
      AND ev.result_status = 'PENDING'
      AND ev.settlement_hold_reason IS NOT NULL
      AND ev.hold_reason IS NULL
      AND (p_after_leg_id IS NULL OR ev.leg_id > p_after_leg_id)
    ORDER BY ev.leg_id
    LIMIT v_size
  ) t;

  RETURN jsonb_build_object('fixture_id', p_fixture_id, 'total_candidates', v_total,
    'page_size', v_size, 'returned', v_count, 'legs', v_rows, 'snapshot_hash', v_hash,
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
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF p_confirmation IS DISTINCT FROM 'RELEASE_SETTLEMENT_HOLDS_V3' THEN
    RAISE EXCEPTION 'confirmation_required';
  END IF;
  IF p_expected_leg_ids IS NULL OR array_length(p_expected_leg_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'expected_leg_ids_required';
  END IF;
  IF array_length(p_expected_leg_ids, 1) > 50 THEN
    RAISE EXCEPTION 'expected_leg_ids_too_large';
  END IF;

  PERFORM 1 FROM public.ticket_leg_outcomes tlo
  WHERE tlo.id = ANY(p_expected_leg_ids) ORDER BY tlo.id FOR UPDATE;

  SELECT array_agg(ev.leg_id ORDER BY ev.leg_id),
         md5(COALESCE(string_agg(ev.leg_id::text || ':' || ev.settlement_hold_reason, '|' ORDER BY ev.leg_id), ''))
  INTO v_ids, v_hash
  FROM public.v_leg_settlement_evidence ev
  WHERE ev.leg_id = ANY(p_expected_leg_ids)
    AND ev.fixture_id = p_fixture_id
    AND ev.result_status = 'PENDING'
    AND ev.settlement_hold_reason IS NOT NULL
    AND ev.hold_reason IS NULL
    AND ev.score_claim_token IS NULL;

  IF v_ids IS NULL OR array_length(v_ids, 1) <> array_length(p_expected_leg_ids, 1) THEN
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

  SELECT count(*) INTO v_remaining
  FROM public.ticket_leg_outcomes
  WHERE fixture_id = p_fixture_id AND settlement_hold_reason IS NOT NULL;

  IF v_remaining = 0 THEN
    PERFORM public.resolve_pipeline_alert('settlement:hold:fixture:' || p_fixture_id);
  END IF;

  RETURN jsonb_build_object('fixture_id', p_fixture_id, 'released', v_released,
    'remaining_held', v_remaining, 'snapshot_hash', v_hash);
END;
$function$;

REVOKE ALL ON FUNCTION public.preview_settlement_holds_v3(bigint,uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_settlement_holds_v3(bigint,uuid[],text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_settlement_releases_v3(bigint,uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_settlement_holds_v3(bigint,uuid[],text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_settlement_holds_v3(bigint,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_settlement_holds_v3(bigint,uuid[],text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.preview_settlement_releases_v3(bigint,uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_settlement_holds_v3(bigint,uuid[],text,text) TO service_role;

-- ---------- 6. HEALTH + SCORER RUN LOGS + LEGACY LOCKDOWN ----------
CREATE OR REPLACE FUNCTION public.get_ticket_pipeline_health_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pending_missing_recent bigint;
  v_pending_missing_historical bigint;
  v_pending_with_ft bigint;
  v_held bigint;
  v_unsafe bigint;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  SELECT
    count(*) FILTER (WHERE tlo.kickoff_at >= now() - interval '30 days'),
    count(*) FILTER (WHERE tlo.kickoff_at <  now() - interval '30 days')
  INTO v_pending_missing_recent, v_pending_missing_historical
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

  RETURN jsonb_build_object(
    'pending_missing_fixture_results', v_pending_missing_recent + v_pending_missing_historical,
    'pending_missing_actionable_30d', v_pending_missing_recent,
    'pending_missing_historical', v_pending_missing_historical,
    'pending_with_ft_results', v_pending_with_ft,
    'pending_held', v_held,
    'pending_unsafe_unheld', v_unsafe
  );
END;
$function$;

CREATE TABLE IF NOT EXISTS public.scorer_run_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_started timestamptz NOT NULL DEFAULT now(),
  run_finished timestamptz,
  success boolean NOT NULL DEFAULT false,
  batch_size integer,
  scanned_legs integer NOT NULL DEFAULT 0,
  scored_legs integer NOT NULL DEFAULT 0,
  skipped_legs integer NOT NULL DEFAULT 0,
  held_legs integer NOT NULL DEFAULT 0,
  updated_tickets integer NOT NULL DEFAULT 0,
  auth_method text,
  error_message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.scorer_run_logs TO service_role;
ALTER TABLE public.scorer_run_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages scorer run logs" ON public.scorer_run_logs;
CREATE POLICY "Service role manages scorer run logs" ON public.scorer_run_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Retire the unbounded destructive void path.
CREATE OR REPLACE FUNCTION public.void_non_ft_pending_legs(batch_limit integer DEFAULT 500)
RETURNS TABLE(voided_count integer, affected_tickets integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'retired: void_non_ft_pending_legs is disabled pending an exact-target, dry-run, confirmed replacement';
END;
$function$;
REVOKE ALL ON FUNCTION public.void_non_ft_pending_legs(integer) FROM PUBLIC, anon, authenticated;

-- ---------- 3. ATOMIC INGESTION WRITER ----------
CREATE OR REPLACE FUNCTION public.ingest_fixture_result_tx(
  p_fixture_id bigint,
  p_league_id bigint,
  p_status text,
  p_kickoff_at timestamptz,
  p_home_team_id bigint,
  p_away_team_id bigint,
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
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF p_fixture_id IS NULL OR p_status IS NULL OR p_kickoff_at IS NULL
     OR p_goals_home IS NULL OR p_goals_away IS NULL
     OR p_goals_home < 0 OR p_goals_away < 0 THEN
    RAISE EXCEPTION 'invalid_ingestion_payload';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.fixtures WHERE id = p_fixture_id) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'unknown_local_fixture';
  END IF;

  -- Reconcile authoritative schedule/identity FIRST so reschedule-history
  -- triggers fire before any settlement eligibility is evaluated.
  UPDATE public.fixtures
  SET status = p_status,
      timestamp = EXTRACT(epoch FROM p_kickoff_at)::bigint,
      date = p_kickoff_at,
      teams_home = CASE WHEN p_home_team_id IS NULL THEN teams_home
                        ELSE jsonb_set(COALESCE(teams_home, '{}'::jsonb), '{id}', to_jsonb(p_home_team_id)) END,
      teams_away = CASE WHEN p_away_team_id IS NULL THEN teams_away
                        ELSE jsonb_set(COALESCE(teams_away, '{}'::jsonb), '{id}', to_jsonb(p_away_team_id)) END,
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
    corners_home = COALESCE(EXCLUDED.corners_home, public.fixture_results.corners_home),
    corners_away = COALESCE(EXCLUDED.corners_away, public.fixture_results.corners_away),
    cards_home = COALESCE(EXCLUDED.cards_home, public.fixture_results.cards_home),
    cards_away = COALESCE(EXCLUDED.cards_away, public.fixture_results.cards_away),
    fouls_home = COALESCE(EXCLUDED.fouls_home, public.fixture_results.fouls_home),
    fouls_away = COALESCE(EXCLUDED.fouls_away, public.fixture_results.fouls_away),
    offsides_home = COALESCE(EXCLUDED.offsides_home, public.fixture_results.offsides_home),
    offsides_away = COALESCE(EXCLUDED.offsides_away, public.fixture_results.offsides_away),
    status = EXCLUDED.status,
    source = EXCLUDED.source,
    fetched_at = EXCLUDED.fetched_at;

  RETURN jsonb_build_object('fixture_id', p_fixture_id, 'status', p_status, 'written', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.ingest_fixture_result_tx(bigint,bigint,text,timestamptz,bigint,bigint,integer,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_fixture_result_tx(bigint,bigint,text,timestamptz,bigint,bigint,integer,integer,jsonb) TO service_role;

-- ---------- 8. SECURITY HARDENING ----------
CREATE OR REPLACE FUNCTION public.create_profile_with_username(p_username text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  normalized_username text;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  normalized_username := lower(trim(p_username));

  IF normalized_username !~ '^[a-z0-9_]{3,20}$' THEN
    RETURN json_build_object('success', false, 'error', 'Invalid format');
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = current_user_id) THEN
    RETURN json_build_object('success', false, 'error', 'Profile already exists');
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = normalized_username) THEN
    RETURN json_build_object('success', false, 'error', 'Username already taken');
  END IF;

  INSERT INTO public.profiles (user_id, username, username_updated_at)
  VALUES (current_user_id, normalized_username, NULL)
  ON CONFLICT (user_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Profile already exists');
  END IF;

  RETURN json_build_object('success', true, 'username', normalized_username);
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() IN ('authenticated', 'anon') AND _user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_market_aggregates(_market_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT json_build_object(
    'total_positions', COUNT(mp.*),
    'yes_positions', COUNT(*) FILTER (WHERE mp.outcome = 'yes'),
    'no_positions', COUNT(*) FILTER (WHERE mp.outcome = 'no'),
    'yes_stake', COALESCE(SUM(mp.net_stake) FILTER (WHERE mp.outcome = 'yes'), 0),
    'no_stake', COALESCE(SUM(mp.net_stake) FILTER (WHERE mp.outcome = 'no'), 0),
    'total_pool', COALESCE(SUM(mp.net_stake), 0),
    'unique_traders', COUNT(DISTINCT mp.user_id)
  )
  FROM public.market_positions mp
  WHERE mp.market_id = _market_id
    AND EXISTS (
      SELECT 1 FROM public.prediction_markets pm
      WHERE pm.id = _market_id
        AND pm.status IN ('open', 'closed', 'resolved')
    )
$function$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;