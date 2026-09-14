CREATE OR REPLACE FUNCTION public.preview_settlement_holds_v3(p_fixture_id bigint, p_after_leg_id uuid DEFAULT NULL::uuid, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
         max(t.leg_id::text)::uuid
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

CREATE OR REPLACE FUNCTION public.preview_settlement_releases_v3(p_fixture_id bigint, p_after_leg_id uuid DEFAULT NULL::uuid, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
         max(t.leg_id::text)::uuid
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