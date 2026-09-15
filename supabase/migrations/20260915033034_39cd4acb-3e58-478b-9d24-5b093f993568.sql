-- ===========================================================================
-- RC3.4 (B) — verified statistics provenance is mandatory for statistics-based
-- settlement, in BOTH claim and finalization, re-checked under the
-- finalization locks. Forward-only. Service-role only. No data mutation.
-- ===========================================================================

-- 1. Which markets settle from secondary statistics ------------------------
CREATE OR REPLACE FUNCTION public.is_statistics_market(p_market text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT lower(coalesce(p_market, '')) IN (
    'corners', 'total_corners', 'team_corners',
    'cards', 'total_cards', 'team_cards',
    'fouls', 'total_fouls',
    'offsides', 'total_offsides'
  )
$$;

REVOKE ALL ON FUNCTION public.is_statistics_market(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_statistics_market(text) FROM anon;
REVOKE ALL ON FUNCTION public.is_statistics_market(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_statistics_market(text) TO service_role;

-- 2. Provenance classification ---------------------------------------------
CREATE OR REPLACE FUNCTION public.stats_provenance_state(
  p_stats_identity text,
  p_expected_identity text
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_expected_identity IS NULL THEN 'unverifiable'
    WHEN p_stats_identity IS NULL THEN 'unverified'
    WHEN p_stats_identity = p_expected_identity THEN 'verified'
    ELSE 'mismatch'
  END
$$;

REVOKE ALL ON FUNCTION public.stats_provenance_state(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stats_provenance_state(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.stats_provenance_state(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.stats_provenance_state(text, text) TO service_role;

-- Read-only per-fixture provenance (used by scoring guards and the read-only
-- legacy inventory). Never writes, never manufactures a marker.
CREATE OR REPLACE FUNCTION public.result_stats_provenance(p_fixture_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.stats_provenance_state(
    fr.stats_identity,
    public.result_identity_hash(
      COALESCE(fx.league_id::bigint, fr.league_id::bigint),
      public.safe_jsonb_id(fx.teams_home -> 'id'),
      public.safe_jsonb_id(fx.teams_away -> 'id'),
      fx.teams_home ->> 'name',
      fx.teams_away ->> 'name',
      COALESCE(fr.kickoff_at,
               CASE WHEN fx."timestamp" IS NULL THEN NULL
                    ELSE to_timestamp(fx."timestamp"::double precision) END),
      fr.goals_home::integer,
      fr.goals_away::integer
    )
  )
  FROM public.fixture_results fr
  LEFT JOIN public.fixtures fx ON fx.id = fr.fixture_id
  WHERE fr.fixture_id = p_fixture_id
$$;

REVOKE ALL ON FUNCTION public.result_stats_provenance(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.result_stats_provenance(bigint) FROM anon;
REVOKE ALL ON FUNCTION public.result_stats_provenance(bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.result_stats_provenance(bigint) TO service_role;

-- 3. Evidence view: provenance is part of the evidence and of the fingerprint
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
  fr.stats_identity,
  public.is_statistics_market(tlo.market)         AS is_statistics_market,
  public.stats_provenance_state(
    fr.stats_identity,
    public.result_identity_hash(
      COALESCE(fx.league_id::bigint, fr.league_id::bigint),
      public.safe_jsonb_id(fx.teams_home -> 'id'),
      public.safe_jsonb_id(fx.teams_away -> 'id'),
      fx.teams_home ->> 'name',
      fx.teams_away ->> 'name',
      COALESCE(fr.kickoff_at,
               CASE WHEN fx."timestamp" IS NULL THEN NULL
                    ELSE to_timestamp(fx."timestamp"::double precision) END),
      fr.goals_home::integer,
      fr.goals_away::integer
    )
  )                                               AS stats_provenance,
  md5(
    COALESCE(fr.status,'-') || '|' ||
    COALESCE(fr.goals_home::text,'-') || '|' || COALESCE(fr.goals_away::text,'-') || '|' ||
    COALESCE(fr.corners_home::text,'-') || '|' || COALESCE(fr.corners_away::text,'-') || '|' ||
    COALESCE(fr.cards_home::text,'-') || '|' || COALESCE(fr.cards_away::text,'-') || '|' ||
    COALESCE(fr.kickoff_at::text,'-') || '|' ||
    COALESCE(fr.stats_identity,'-') || '|' ||
    COALESCE(NULLIF(fx.teams_home->>'id','')::text,'-') || '|' ||
    COALESCE(NULLIF(fx.teams_away->>'id','')::text,'-')
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
    COALESCE(fr.cards_home::text, '-') || '|' || COALESCE(fr.cards_away::text, '-') || '|' ||
    COALESCE(fr.stats_identity, '-')
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

-- 4. Claim: never hand a statistics-based leg to the scorer unless the stored
--    statistics provably belong to the current verified fixture identity.
DROP FUNCTION IF EXISTS public.claim_scorable_ticket_legs(integer);
CREATE OR REPLACE FUNCTION public.claim_scorable_ticket_legs(batch_limit integer DEFAULT NULL)
RETURNS TABLE(claim_token uuid, leg_id uuid, ticket_id uuid, user_id uuid, fixture_id bigint,
              market text, side text, line numeric,
              goals_home smallint, goals_away smallint,
              corners_home smallint, corners_away smallint,
              cards_home smallint, cards_away smallint,
              result_fingerprint text, stats_provenance text)
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
      -- Statistics-based markets require verified provenance. Goals-only
      -- scoring is unaffected and never depends on optional statistics.
      AND (NOT public.is_statistics_market(tlo.market) OR ev.stats_provenance = 'verified')
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
         ev.result_fingerprint, ev.stats_provenance
  FROM claimed c
  JOIN public.fixture_results fr ON fr.fixture_id = c.fixture_id
  JOIN public.v_leg_settlement_evidence ev ON ev.leg_id = c.id
  ORDER BY c.kickoff_at ASC, c.id ASC;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_scorable_ticket_legs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scorable_ticket_legs(integer) TO service_role;

-- 5. Finalization: re-check provenance AFTER the fixture / result / leg locks,
--    so an identity change that lands after claiming can never be bypassed.
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
  v_provenance text;
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

  -- Evidence is read AFTER the locks: this is the authoritative re-evaluation.
  SELECT hold_reason, drift_seconds, result_fingerprint, stats_provenance
  INTO v_reason, v_drift, v_fingerprint, v_provenance
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

  -- Statistics-based settlement demands verified statistics provenance.
  IF public.is_statistics_market(v_leg.market)
     AND COALESCE(v_provenance, 'unverified') <> 'verified' THEN
    UPDATE public.ticket_leg_outcomes
    SET score_claim_token = NULL, score_claimed_at = NULL
    WHERE id = p_leg_id;

    PERFORM public.record_pipeline_alert(
      'settlement:stats_provenance:fixture:' || v_leg.fixture_id,
      'settlement_hold',
      'warning',
      'Statistics provenance is not verified for fixture ' || v_leg.fixture_id,
      jsonb_build_object('fixture_id', v_leg.fixture_id, 'leg_id', p_leg_id,
                         'market', v_leg.market, 'provenance', COALESCE(v_provenance, 'unverified'))
    );

    RETURN jsonb_build_object('settled', false, 'outcome', 'stats_provenance_unverified',
                              'provenance', COALESCE(v_provenance, 'unverified'));
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

-- 6. Read-only legacy statistics inventory (section E). Reports evidence, never
--    manufactures a marker and never mutates a historical row.
CREATE OR REPLACE FUNCTION public.legacy_stats_provenance_inventory()
RETURNS TABLE(
  provenance text,
  has_statistics boolean,
  source text,
  fixture_rows bigint,
  settled_legs bigint,
  pending_legs bigint,
  earliest_kickoff timestamptz,
  latest_kickoff timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT
      fr.fixture_id,
      fr.kickoff_at,
      COALESCE(fr.source, 'unknown') AS source,
      (fr.corners_home IS NOT NULL OR fr.corners_away IS NOT NULL
       OR fr.cards_home IS NOT NULL OR fr.cards_away IS NOT NULL
       OR fr.fouls_home IS NOT NULL OR fr.fouls_away IS NOT NULL
       OR fr.offsides_home IS NOT NULL OR fr.offsides_away IS NOT NULL) AS has_statistics,
      public.stats_provenance_state(
        fr.stats_identity,
        public.result_identity_hash(
          COALESCE(fx.league_id::bigint, fr.league_id::bigint),
          public.safe_jsonb_id(fx.teams_home -> 'id'),
          public.safe_jsonb_id(fx.teams_away -> 'id'),
          fx.teams_home ->> 'name',
          fx.teams_away ->> 'name',
          COALESCE(fr.kickoff_at,
                   CASE WHEN fx."timestamp" IS NULL THEN NULL
                        ELSE to_timestamp(fx."timestamp"::double precision) END),
          fr.goals_home::integer,
          fr.goals_away::integer
        )
      ) AS provenance
    FROM public.fixture_results fr
    LEFT JOIN public.fixtures fx ON fx.id = fr.fixture_id
  )
  SELECT
    b.provenance,
    b.has_statistics,
    b.source,
    count(*)::bigint AS fixture_rows,
    COALESCE(sum((SELECT count(*) FROM public.ticket_leg_outcomes t
                   WHERE t.fixture_id = b.fixture_id
                     AND t.result_status <> 'PENDING'
                     AND public.is_statistics_market(t.market))), 0)::bigint AS settled_legs,
    COALESCE(sum((SELECT count(*) FROM public.ticket_leg_outcomes t
                   WHERE t.fixture_id = b.fixture_id
                     AND t.result_status = 'PENDING'
                     AND public.is_statistics_market(t.market))), 0)::bigint AS pending_legs,
    min(b.kickoff_at) AS earliest_kickoff,
    max(b.kickoff_at) AS latest_kickoff
  FROM base b
  GROUP BY b.provenance, b.has_statistics, b.source
  ORDER BY b.provenance, b.has_statistics, b.source
$$;

REVOKE ALL ON FUNCTION public.legacy_stats_provenance_inventory() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.legacy_stats_provenance_inventory() FROM anon;
REVOKE ALL ON FUNCTION public.legacy_stats_provenance_inventory() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.legacy_stats_provenance_inventory() TO service_role;