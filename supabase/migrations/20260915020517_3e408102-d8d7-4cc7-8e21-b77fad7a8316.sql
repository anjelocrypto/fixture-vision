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
  v_fx public.fixtures%ROWTYPE;
  v_prev public.fixture_results%ROWTYPE;
  v_prev_found boolean := false;
  v_prev_home_id bigint;
  v_prev_away_id bigint;
  v_prev_kickoff timestamptz;
  v_audit_home bigint;
  v_audit_away bigint;
  v_identity_changed boolean := false;
  v_result_changed boolean := false;
  v_reset_stats boolean := false;
  v_scorable boolean;
  v_policy text;
  v_held integer := 0;
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
  v_audit_home := NULLIF(v_prev_home_id, -1);
  v_audit_away := NULLIF(v_prev_away_id, -1);
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

  v_reset_stats := v_identity_changed OR v_result_changed
                   OR (v_prev_found AND v_prev_kickoff IS DISTINCT FROM p_kickoff_at);

  -- Audit only schedule/identity movements the audit table considers
  -- meaningful; a competition-only correction has nothing to record there.
  IF v_prev_kickoff IS DISTINCT FROM p_kickoff_at
     OR v_fx.status IS DISTINCT FROM p_status
     OR v_audit_home IS DISTINCT FROM p_home_team_id
     OR v_audit_away IS DISTINCT FROM p_away_team_id THEN
    INSERT INTO public.fixture_schedule_changes (
      fixture_id, previous_kickoff_at, new_kickoff_at, previous_status, new_status,
      previous_home_team_id, previous_away_team_id, new_home_team_id, new_away_team_id,
      kickoff_delta_seconds, direction_swapped, source
    ) VALUES (
      p_fixture_id, v_prev_kickoff, p_kickoff_at, v_fx.status, p_status,
      v_audit_home, v_audit_away, p_home_team_id, p_away_team_id,
      CASE WHEN v_prev_kickoff IS NULL THEN NULL
           ELSE EXTRACT(epoch FROM (p_kickoff_at - v_prev_kickoff))::bigint END,
      COALESCE(v_audit_home = p_away_team_id AND v_audit_away = p_home_team_id, false),
      'ingest_fixture_result_tx'
    );
  END IF;

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
    offsides_home, offsides_away, status, source, fetched_at
  ) VALUES (
    p_fixture_id, p_league_id, p_kickoff_at, now(), p_goals_home, p_goals_away,
    v_c_h, v_c_a, v_k_h, v_k_a, v_f_h, v_f_a, v_o_h, v_o_a,
    p_status, 'api-football', now()
  )
  ON CONFLICT (fixture_id) DO UPDATE SET
    league_id = EXCLUDED.league_id,
    kickoff_at = EXCLUDED.kickoff_at,
    finished_at = EXCLUDED.finished_at,
    goals_home = EXCLUDED.goals_home,
    goals_away = EXCLUDED.goals_away,
    corners_home = CASE WHEN v_reset_stats THEN EXCLUDED.corners_home
                        ELSE COALESCE(EXCLUDED.corners_home, public.fixture_results.corners_home) END,
    corners_away = CASE WHEN v_reset_stats THEN EXCLUDED.corners_away
                        ELSE COALESCE(EXCLUDED.corners_away, public.fixture_results.corners_away) END,
    cards_home = CASE WHEN v_reset_stats THEN EXCLUDED.cards_home
                      ELSE COALESCE(EXCLUDED.cards_home, public.fixture_results.cards_home) END,
    cards_away = CASE WHEN v_reset_stats THEN EXCLUDED.cards_away
                      ELSE COALESCE(EXCLUDED.cards_away, public.fixture_results.cards_away) END,
    fouls_home = CASE WHEN v_reset_stats THEN EXCLUDED.fouls_home
                      ELSE COALESCE(EXCLUDED.fouls_home, public.fixture_results.fouls_home) END,
    fouls_away = CASE WHEN v_reset_stats THEN EXCLUDED.fouls_away
                      ELSE COALESCE(EXCLUDED.fouls_away, public.fixture_results.fouls_away) END,
    offsides_home = CASE WHEN v_reset_stats THEN EXCLUDED.offsides_home
                         ELSE COALESCE(EXCLUDED.offsides_home, public.fixture_results.offsides_home) END,
    offsides_away = CASE WHEN v_reset_stats THEN EXCLUDED.offsides_away
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

  RETURN jsonb_build_object(
    'fixture_id', p_fixture_id, 'status', p_status, 'written', true,
    'scorable', v_scorable, 'policy', v_policy, 'held_legs', v_held,
    'identity_changed', v_identity_changed, 'stats_reset', v_reset_stats);
END;
$function$;
REVOKE ALL ON FUNCTION public.ingest_fixture_result_tx(bigint,bigint,text,timestamptz,bigint,bigint,text,text,integer,integer,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ingest_fixture_result_tx(bigint,bigint,text,timestamptz,bigint,bigint,text,text,integer,integer,jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.ingest_fixture_result_tx(bigint,bigint,text,timestamptz,bigint,bigint,text,text,integer,integer,jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_fixture_result_tx(bigint,bigint,text,timestamptz,bigint,bigint,text,text,integer,integer,jsonb) TO service_role;