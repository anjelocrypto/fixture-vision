-- 1. Durable hold audit log -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.settlement_hold_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leg_id uuid NOT NULL,
  ticket_id uuid,
  fixture_id bigint NOT NULL,
  reason text NOT NULL,
  drift_seconds bigint,
  policy_version text NOT NULL,
  actor text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS settlement_hold_audit_fixture_idx
  ON public.settlement_hold_audit (fixture_id, created_at DESC);
CREATE INDEX IF NOT EXISTS settlement_hold_audit_leg_idx
  ON public.settlement_hold_audit (leg_id);

GRANT ALL ON public.settlement_hold_audit TO service_role;
ALTER TABLE public.settlement_hold_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access (settlement_hold_audit)" ON public.settlement_hold_audit;
CREATE POLICY "Service role full access (settlement_hold_audit)"
  ON public.settlement_hold_audit FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view settlement hold audit" ON public.settlement_hold_audit;
CREATE POLICY "Admins can view settlement hold audit"
  ON public.settlement_hold_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

GRANT SELECT ON public.settlement_hold_audit TO authenticated;

-- 2. Retire the broad classifier --------------------------------------------
REVOKE ALL ON FUNCTION public.hold_unsafe_pending_legs(integer) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.hold_unsafe_pending_legs(integer);

-- 3. Fail-closed targeted classifier v2 --------------------------------------
CREATE OR REPLACE FUNCTION public.hold_unsafe_pending_legs_v2(
  p_fixture_id bigint,
  p_max_rows integer,
  p_dry_run boolean DEFAULT true,
  p_confirm text DEFAULT NULL
)
RETURNS TABLE(
  leg_id uuid,
  ticket_id uuid,
  fixture_id bigint,
  reason text,
  drift_seconds bigint,
  result_status text,
  score_attempts integer,
  applied boolean,
  selected_count integer,
  updated_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_selected integer := 0;
  v_updated  integer := 0;
  v_dry      boolean := COALESCE(p_dry_run, true);
  r          record;
BEGIN
  IF p_fixture_id IS NULL THEN
    RAISE EXCEPTION 'p_fixture_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_max_rows IS NULL OR p_max_rows < 1 OR p_max_rows > 50 THEN
    RAISE EXCEPTION 'p_max_rows must be between 1 and 50' USING ERRCODE = '22023';
  END IF;
  IF NOT v_dry AND COALESCE(p_confirm, '') <> 'APPLY_SETTLEMENT_HOLDS' THEN
    RAISE EXCEPTION 'explicit confirmation required to apply settlement holds' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _hold_v2_batch(
    leg_id uuid, ticket_id uuid, fixture_id bigint, reason text,
    drift bigint, result_status text, score_attempts integer
  ) ON COMMIT DROP;
  DELETE FROM _hold_v2_batch;

  INSERT INTO _hold_v2_batch
  SELECT c.id, c.ticket_id, c.fixture_id, c.reason, c.drift, c.result_status, c.score_attempts
  FROM (
    SELECT tlo.id, tlo.ticket_id, tlo.fixture_id, tlo.result_status, tlo.score_attempts,
           CASE WHEN fx.timestamp IS NULL OR tlo.kickoff_at IS NULL THEN NULL
                ELSE EXTRACT(epoch FROM (to_timestamp(fx.timestamp) - tlo.kickoff_at))::bigint
           END AS drift,
           public.evaluate_leg_hold(
             tlo.kickoff_at,
             CASE WHEN fx.timestamp IS NULL THEN NULL ELSE to_timestamp(fx.timestamp) END,
             COALESCE(tlo.home_team_id_snapshot, tj.home_id),
             COALESCE(tlo.away_team_id_snapshot, tj.away_id),
             NULLIF(fx.teams_home->>'id','')::bigint,
             NULLIF(fx.teams_away->>'id','')::bigint,
             tj.home_name, tj.away_name,
             fx.teams_home->>'name', fx.teams_away->>'name'
           ) AS reason
    FROM public.ticket_leg_outcomes tlo
    JOIN public.fixtures fx ON fx.id = tlo.fixture_id
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
    ) tj ON true
    WHERE tlo.fixture_id = p_fixture_id
      AND tlo.result_status = 'PENDING'
      AND tlo.settlement_hold_reason IS NULL
    ORDER BY tlo.id
    LIMIT (p_max_rows + 1)
    FOR UPDATE OF tlo SKIP LOCKED
  ) c
  WHERE c.reason IS NOT NULL
  ORDER BY c.id;

  SELECT count(*) INTO v_selected FROM _hold_v2_batch;

  IF v_selected > p_max_rows THEN
    RAISE EXCEPTION 'candidate rows (%) exceed p_max_rows (%)', v_selected, p_max_rows
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_dry AND v_selected > 0 THEN
    UPDATE public.ticket_leg_outcomes tlo
    SET settlement_hold_reason = b.reason,
        settlement_held_at = now(),
        settlement_policy_version = 'reschedule-integrity-v1',
        kickoff_drift_seconds = b.drift
    FROM _hold_v2_batch b
    WHERE tlo.id = b.leg_id
      AND tlo.fixture_id = p_fixture_id
      AND tlo.result_status = 'PENDING'
      AND tlo.settlement_hold_reason IS NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    INSERT INTO public.settlement_hold_audit
      (leg_id, ticket_id, fixture_id, reason, drift_seconds, policy_version, actor, source)
    SELECT b.leg_id, b.ticket_id, b.fixture_id, b.reason, b.drift,
           'reschedule-integrity-v1', 'service_role', 'hold_unsafe_pending_legs_v2'
    FROM _hold_v2_batch b;

    FOR r IN SELECT DISTINCT b.fixture_id AS fid, b.reason AS rsn FROM _hold_v2_batch b LOOP
      PERFORM public.record_pipeline_alert(
        'leg_hold:' || r.fid || ':' || r.rsn,
        'settlement_hold',
        'warning',
        format('Settlement held for fixture %s (%s)', r.fid, r.rsn),
        jsonb_build_object('fixture_id', r.fid, 'reason', r.rsn,
                           'policy_version', 'reschedule-integrity-v1')
      );
    END LOOP;
  END IF;

  RETURN QUERY
  SELECT b.leg_id, b.ticket_id, b.fixture_id, b.reason, b.drift,
         b.result_status, b.score_attempts,
         (NOT v_dry) AS applied, v_selected, v_updated
  FROM _hold_v2_batch b
  ORDER BY b.leg_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.hold_unsafe_pending_legs_v2(bigint, integer, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_unsafe_pending_legs_v2(bigint, integer, boolean, text) TO service_role;