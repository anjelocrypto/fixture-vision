-- ===========================================================================
-- RC3.3 — statistics provenance, single schedule-history recorder,
--         scoring protection across an identity transition.
-- Forward-only. Service-role only. No data mutation.
-- ===========================================================================

-- 1. Statistics provenance marker ------------------------------------------
ALTER TABLE public.fixture_results
  ADD COLUMN IF NOT EXISTS stats_identity text;

COMMENT ON COLUMN public.fixture_results.stats_identity IS
  'Hash of the verified result identity (league, team ids, canonical team names, kickoff, score) the stored secondary statistics belong to. Statistics may only survive an update when this hash is reproduced exactly.';

CREATE OR REPLACE FUNCTION public.result_identity_hash(
  p_league_id bigint,
  p_home_team_id bigint,
  p_away_team_id bigint,
  p_home_team_name text,
  p_away_team_name text,
  p_kickoff_at timestamptz,
  p_goals_home integer,
  p_goals_away integer
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT md5(
    concat_ws('|',
      coalesce(p_league_id::text, '~'),
      coalesce(p_home_team_id::text, '~'),
      coalesce(p_away_team_id::text, '~'),
      coalesce(public.normalize_team_name(p_home_team_name), '~'),
      coalesce(public.normalize_team_name(p_away_team_name), '~'),
      coalesce(to_char(p_kickoff_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), '~'),
      coalesce(p_goals_home::text, '~'),
      coalesce(p_goals_away::text, '~')
    )
  )
$$;

REVOKE ALL ON FUNCTION public.result_identity_hash(bigint, bigint, bigint, text, text, timestamptz, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.result_identity_hash(bigint, bigint, bigint, text, text, timestamptz, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.result_identity_hash(bigint, bigint, bigint, text, text, timestamptz, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.result_identity_hash(bigint, bigint, bigint, text, text, timestamptz, integer, integer) TO service_role;

-- 2. Ingestion: provenance-gated statistics, one recorder, scoring guard ----
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
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_fx public.fixtures%ROWTYPE;
  v_prev public.fixture_results%ROWTYPE;
  v_prev_found boolean := false;
  v_prev_home_id bigint;
  v_prev_away_id bigint;
  v_prev_kickoff timestamptz;
  v_identity_changed boolean := false;
  v_result_changed boolean := false;
  v_preserve boolean := false;
  v_stats_reset boolean := false;
  v_stats_present boolean := false;
  v_new_identity text;
  v_stats_identity text;
  v_scorable boolean;
  v_policy text;
  v_held integer := 0;
  v_identity_held integer := 0;
  v_c_h smallint; v_c_a smallint; v_k_h smallint; v_k_a smallint;
  v_f_h smallint; v_f_a smallint; v_o_h smallint; v_o_a smallint;
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

  -- Strict statistics parsing (raises on malformed values — zero writes).
  v_c_h := public.safe_stat_smallint(p_stats, 'corners_home');
  v_c_a := public.safe_stat_smallint(p_stats, 'corners_away');
  v_k_h := public.safe_stat_smallint(p_stats, 'cards_home');
  v_k_a := public.safe_stat_smallint(p_stats, 'cards_away');
  v_f_h := public.safe_stat_smallint(p_stats, 'fouls_home');
  v_f_a := public.safe_stat_smallint(p_stats, 'fouls_away');
  v_o_h := public.safe_stat_smallint(p_stats, 'offsides_home');
  v_o_a := public.safe_stat_smallint(p_stats, 'offsides_away');

  SELECT * INTO v_fx FROM public.fixtures WHERE id = p_fixture_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_local_fixture';
  END IF;

  v_prev_home_id := public.safe_jsonb_id(v_fx.teams_home -> 'id');
  v_prev_away_id := public.safe_jsonb_id(v_fx.teams_away -> 'id');
  v_prev_kickoff := CASE WHEN v_fx."timestamp" IS NULL THEN NULL
                         ELSE to_timestamp(v_fx."timestamp"::double precision) END;

  SELECT * INTO v_prev FROM public.fixture_results WHERE fixture_id = p_fixture_id FOR UPDATE;
  v_prev_found := FOUND;

  v_identity_changed :=
       (v_prev_home_id IS NOT NULL AND v_prev_home_id IS DISTINCT FROM p_home_team_id)
    OR (v_prev_away_id IS NOT NULL AND v_prev_away_id IS DISTINCT FROM p_away_team_id)
    OR public.normalize_team_name(v_fx.teams_home ->> 'name')
         IS DISTINCT FROM public.normalize_team_name(p_home_team_name)
    OR public.normalize_team_name(v_fx.teams_away ->> 'name')
         IS DISTINCT FROM public.normalize_team_name(p_away_team_name)
    OR (v_fx.league_id IS NOT NULL AND v_fx.league_id IS DISTINCT FROM p_league_id)
    OR (v_prev_found AND v_prev.league_id IS DISTINCT FROM p_league_id);

  IF v_prev_found THEN
    v_result_changed :=
         v_prev.goals_home IS DISTINCT FROM p_goals_home::smallint
      OR v_prev.goals_away IS DISTINCT FROM p_goals_away::smallint
      OR v_prev.kickoff_at IS DISTINCT FROM p_kickoff_at
      OR v_prev.status IS DISTINCT FROM p_status;
  END IF;

  -- Provenance: stored statistics belong to ONE verified result identity.
  -- They survive only when that exact identity is reproduced, so an
  -- intervening fixture refresh (e.g. away team Beta -> Gamma) can never
  -- leave the previous opponent's statistics attached to a new identity.
  v_new_identity := public.result_identity_hash(
    p_league_id, p_home_team_id, p_away_team_id,
    p_home_team_name, p_away_team_name, p_kickoff_at, p_goals_home, p_goals_away);

  v_preserve := v_prev_found
    AND NOT v_identity_changed
    AND NOT v_result_changed
    AND (v_prev_kickoff IS NOT DISTINCT FROM p_kickoff_at)
    AND v_prev.stats_identity IS NOT NULL
    AND v_prev.stats_identity = v_new_identity;

  IF v_preserve THEN
    v_c_h := COALESCE(v_c_h, v_prev.corners_home);
    v_c_a := COALESCE(v_c_a, v_prev.corners_away);
    v_k_h := COALESCE(v_k_h, v_prev.cards_home);
    v_k_a := COALESCE(v_k_a, v_prev.cards_away);
    v_f_h := COALESCE(v_f_h, v_prev.fouls_home);
    v_f_a := COALESCE(v_f_a, v_prev.fouls_away);
    v_o_h := COALESCE(v_o_h, v_prev.offsides_home);
    v_o_a := COALESCE(v_o_a, v_prev.offsides_away);
  END IF;

  v_stats_present := (v_c_h IS NOT NULL OR v_c_a IS NOT NULL OR v_k_h IS NOT NULL OR v_k_a IS NOT NULL
                   OR v_f_h IS NOT NULL OR v_f_a IS NOT NULL OR v_o_h IS NOT NULL OR v_o_a IS NOT NULL);
  v_stats_identity := CASE WHEN v_stats_present THEN v_new_identity ELSE NULL END;
  v_stats_reset := v_prev_found AND NOT v_preserve AND (
        v_prev.corners_home IS NOT NULL OR v_prev.corners_away IS NOT NULL
     OR v_prev.cards_home IS NOT NULL OR v_prev.cards_away IS NOT NULL
     OR v_prev.fouls_home IS NOT NULL OR v_prev.fouls_away IS NOT NULL
     OR v_prev.offsides_home IS NOT NULL OR v_prev.offsides_away IS NOT NULL);

  -- Schedule / identity history has exactly ONE recorder: the BEFORE UPDATE
  -- trigger on public.fixtures. This function never writes that audit table
  -- itself, so a single transition can never be logged twice.
  UPDATE public.fixtures
  SET status = p_status,
      league_id = p_league_id,
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
    offsides_home, offsides_away, status, source, fetched_at, stats_identity
  ) VALUES (
    p_fixture_id, p_league_id, p_kickoff_at, now(), p_goals_home, p_goals_away,
    v_c_h, v_c_a, v_k_h, v_k_a, v_f_h, v_f_a, v_o_h, v_o_a,
    p_status, 'api-football', now(), v_stats_identity
  )
  ON CONFLICT (fixture_id) DO UPDATE SET
    league_id = EXCLUDED.league_id,
    kickoff_at = EXCLUDED.kickoff_at,
    finished_at = EXCLUDED.finished_at,
    goals_home = EXCLUDED.goals_home,
    goals_away = EXCLUDED.goals_away,
    corners_home = EXCLUDED.corners_home,
    corners_away = EXCLUDED.corners_away,
    cards_home = EXCLUDED.cards_home,
    cards_away = EXCLUDED.cards_away,
    fouls_home = EXCLUDED.fouls_home,
    fouls_away = EXCLUDED.fouls_away,
    offsides_home = EXCLUDED.offsides_home,
    offsides_away = EXCLUDED.offsides_away,
    status = EXCLUDED.status,
    source = EXCLUDED.source,
    fetched_at = EXCLUDED.fetched_at,
    stats_identity = EXCLUDED.stats_identity;

  -- Scoring protection across an identity transition: every PENDING leg whose
  -- own identity snapshot no longer agrees with the verified fixture identity
  -- is held before the scorer can ever claim it.
  IF v_identity_changed THEN
    WITH cand AS (
      SELECT tlo.id, tlo.ticket_id, tlo.fixture_id,
             public.evaluate_leg_hold_v3(
               tlo.kickoff_at, p_kickoff_at,
               tlo.home_team_id_snapshot, tlo.away_team_id_snapshot,
               p_home_team_id, p_away_team_id,
               NULL, NULL, NULL, NULL) AS reason
      FROM public.ticket_leg_outcomes tlo
      WHERE tlo.fixture_id = p_fixture_id
        AND tlo.result_status = 'PENDING'
        AND tlo.settlement_hold_reason IS NULL
      FOR UPDATE OF tlo
    ), upd AS (
      UPDATE public.ticket_leg_outcomes tlo
      SET settlement_hold_reason = c.reason,
          settlement_held_at = now(),
          settlement_policy_version = 'reschedule-integrity-v3',
          score_claim_token = NULL,
          score_claimed_at = NULL
      FROM cand c
      WHERE tlo.id = c.id AND c.reason IS NOT NULL
      RETURNING tlo.id, tlo.ticket_id, tlo.fixture_id, tlo.settlement_hold_reason AS reason
    ), aud AS (
      INSERT INTO public.settlement_hold_audit (leg_id, ticket_id, fixture_id, reason, policy_version, actor, source)
      SELECT u.id, u.ticket_id, u.fixture_id, u.reason, 'reschedule-integrity-v3',
             'service_role', 'ingest_fixture_result_tx'
      FROM upd u RETURNING 1
    )
    SELECT count(*) INTO v_identity_held FROM aud;

    IF v_identity_held > 0 THEN
      PERFORM public.record_pipeline_alert(
        'settlement:hold:fixture:' || p_fixture_id,
        'settlement_hold', 'warning',
        'Fixture identity changed during ingestion for fixture ' || p_fixture_id,
        jsonb_build_object('fixture_id', p_fixture_id, 'held_legs', v_identity_held,
                           'reason', 'identity_transition')
      );
    END IF;
  END IF;

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

  RETURN jsonb_build_object(
    'fixture_id', p_fixture_id, 'status', p_status, 'written', true,
    'scorable', v_scorable, 'policy', v_policy, 'held_legs', v_held + v_identity_held,
    'identity_changed', v_identity_changed, 'stats_reset', v_stats_reset,
    'stats_preserved', v_preserve, 'stats_identity', v_stats_identity);
END;
$function$;