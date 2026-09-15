-- ============================================================================
-- GATE D RC3.2 — forward-only ingestion identity / safe-parsing corrections
-- Definitions only: no data mutation.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.safe_jsonb_id(p_value jsonb)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_type text;
  v_text text;
BEGIN
  IF p_value IS NULL THEN RETURN NULL; END IF;
  v_type := jsonb_typeof(p_value);
  IF v_type = 'null' THEN RETURN NULL; END IF;
  IF v_type NOT IN ('number', 'string') THEN RETURN -1; END IF;
  v_text := btrim(p_value #>> '{}');
  IF v_text IS NULL OR v_text = '' THEN RETURN -1; END IF;
  IF v_text ~ '^[0-9]{1,18}$' THEN
    IF v_text::bigint <= 0 THEN RETURN -1; END IF;
    RETURN v_text::bigint;
  END IF;
  RETURN -1;
END;
$function$;
REVOKE ALL ON FUNCTION public.safe_jsonb_id(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.safe_jsonb_id(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.safe_jsonb_id(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.safe_jsonb_id(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.safe_stat_smallint(p_stats jsonb, p_key text)
RETURNS smallint
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
  v_type text;
  v_text text;
BEGIN
  IF p_stats IS NULL THEN RETURN NULL; END IF;
  v := p_stats -> p_key;
  IF v IS NULL THEN RETURN NULL; END IF;
  v_type := jsonb_typeof(v);
  IF v_type = 'null' THEN RETURN NULL; END IF;
  IF v_type NOT IN ('number', 'string') THEN
    RAISE EXCEPTION 'invalid_stat_value:%', p_key;
  END IF;
  v_text := btrim(v #>> '{}');
  IF v_text = '' THEN RETURN NULL; END IF;
  IF v_text !~ '^[0-9]{1,4}$' THEN
    RAISE EXCEPTION 'invalid_stat_value:%', p_key;
  END IF;
  RETURN v_text::smallint;
END;
$function$;
REVOKE ALL ON FUNCTION public.safe_stat_smallint(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.safe_stat_smallint(jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.safe_stat_smallint(jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.safe_stat_smallint(jsonb, text) TO service_role;

CREATE OR REPLACE FUNCTION public.evaluate_leg_hold_v3(
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
DECLARE
  v_lh text; v_la text; v_fh text; v_fa text;
  v_present integer;
BEGIN
  IF COALESCE(p_leg_home_id, 1) < 1 OR COALESCE(p_leg_away_id, 1) < 1
     OR COALESCE(p_fx_home_id, 1) < 1 OR COALESCE(p_fx_away_id, 1) < 1 THEN
    RETURN 'identity_unverifiable';
  END IF;

  v_present := (p_leg_home_id IS NOT NULL)::int + (p_leg_away_id IS NOT NULL)::int
             + (p_fx_home_id IS NOT NULL)::int + (p_fx_away_id IS NOT NULL)::int;

  IF v_present = 4 THEN
    IF NOT (p_leg_home_id = p_fx_home_id AND p_leg_away_id = p_fx_away_id) THEN
      RETURN 'team_direction_mismatch';
    END IF;
  ELSIF v_present > 0 THEN
    RETURN 'identity_unverifiable';
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

CREATE OR REPLACE VIEW public.v_leg_settlement_evidence AS
SELECT tlo.id AS leg_id,
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
       tlo.kickoff_at AS leg_kickoff,
       CASE WHEN fx."timestamp" IS NULL THEN NULL::timestamptz
            ELSE to_timestamp(fx."timestamp"::double precision) END AS fixture_kickoff,
       COALESCE(tlo.home_team_id_snapshot, tj.home_id) AS leg_home_id,
       COALESCE(tlo.away_team_id_snapshot, tj.away_id) AS leg_away_id,
       public.safe_jsonb_id(fx.teams_home -> 'id') AS fixture_home_id,
       public.safe_jsonb_id(fx.teams_away -> 'id') AS fixture_away_id,
       fr.status AS result_status_provider,
       fr.goals_home,
       fr.goals_away,
       fr.corners_home,
       fr.corners_away,
       fr.cards_home,
       fr.cards_away,
       fr.fetched_at AS result_fetched_at,
       md5(COALESCE(fr.status,'-') || '|' || COALESCE(fr.goals_home::text,'-') || '|' ||
           COALESCE(fr.goals_away::text,'-') || '|' || COALESCE(fr.corners_home::text,'-') || '|' ||
           COALESCE(fr.corners_away::text,'-') || '|' || COALESCE(fr.cards_home::text,'-') || '|' ||
           COALESCE(fr.cards_away::text,'-') || '|' || COALESCE(fr.kickoff_at::text,'-')) AS result_fingerprint,
       public.evaluate_leg_hold_v3(
         tlo.kickoff_at,
         CASE WHEN fx."timestamp" IS NULL THEN NULL::timestamptz
              ELSE to_timestamp(fx."timestamp"::double precision) END,
         COALESCE(tlo.home_team_id_snapshot, tj.home_id),
         COALESCE(tlo.away_team_id_snapshot, tj.away_id),
         public.safe_jsonb_id(fx.teams_home -> 'id'),
         public.safe_jsonb_id(fx.teams_away -> 'id'),
         tj.home_name, tj.away_name,
         fx.teams_home ->> 'name', fx.teams_away ->> 'name') AS hold_reason,
       CASE WHEN fx."timestamp" IS NULL OR tlo.kickoff_at IS NULL THEN NULL::bigint
            ELSE EXTRACT(epoch FROM to_timestamp(fx."timestamp"::double precision) - tlo.kickoff_at)::bigint
       END AS drift_seconds,
       md5(tlo.id::text || '|' ||
           COALESCE(public.evaluate_leg_hold_v3(
             tlo.kickoff_at,
             CASE WHEN fx."timestamp" IS NULL THEN NULL::timestamptz
                  ELSE to_timestamp(fx."timestamp"::double precision) END,
             COALESCE(tlo.home_team_id_snapshot, tj.home_id),
             COALESCE(tlo.away_team_id_snapshot, tj.away_id),
             public.safe_jsonb_id(fx.teams_home -> 'id'),
             public.safe_jsonb_id(fx.teams_away -> 'id'),
             tj.home_name, tj.away_name,
             fx.teams_home ->> 'name', fx.teams_away ->> 'name'), 'safe') || '|' ||
           COALESCE(tlo.settlement_hold_reason,'-') || '|' ||
           COALESCE(tlo.kickoff_at::text,'-') || '|' ||
           COALESCE(to_timestamp(fx."timestamp"::double precision)::text,'-') || '|' ||
           COALESCE(COALESCE(tlo.home_team_id_snapshot, tj.home_id)::text,'-') || '|' ||
           COALESCE(COALESCE(tlo.away_team_id_snapshot, tj.away_id)::text,'-') || '|' ||
           COALESCE(public.safe_jsonb_id(fx.teams_home -> 'id')::text,'-') || '|' ||
           COALESCE(public.safe_jsonb_id(fx.teams_away -> 'id')::text,'-') || '|' ||
           COALESCE(public.normalize_team_name(tj.home_name),'-') || '|' ||
           COALESCE(public.normalize_team_name(tj.away_name),'-') || '|' ||
           COALESCE(public.normalize_team_name(fx.teams_home ->> 'name'),'-') || '|' ||
           COALESCE(public.normalize_team_name(fx.teams_away ->> 'name'),'-') || '|' ||
           COALESCE(fr.status,'-') || '|' ||
           COALESCE(fr.goals_home::text,'-') || '|' ||
           COALESCE(fr.goals_away::text,'-') || '|' ||
           COALESCE(fr.corners_home::text,'-') || '|' ||
           COALESCE(fr.corners_away::text,'-') || '|' ||
           COALESCE(fr.cards_home::text,'-') || '|' ||
           COALESCE(fr.cards_away::text,'-')) AS evidence_hash
  FROM public.ticket_leg_outcomes tlo
  LEFT JOIN public.fixtures fx ON fx.id = tlo.fixture_id
  LEFT JOIN public.fixture_results fr ON fr.fixture_id = tlo.fixture_id
  LEFT JOIN LATERAL (
        SELECT l.value ->> 'homeTeam' AS home_name,
               l.value ->> 'awayTeam' AS away_name,
               public.safe_jsonb_id(l.value -> 'homeTeamId') AS home_id,
               public.safe_jsonb_id(l.value -> 'awayTeamId') AS away_id
          FROM public.generated_tickets gt
          CROSS JOIN LATERAL jsonb_array_elements(gt.legs) l(value)
         WHERE gt.id = tlo.ticket_id
           AND public.safe_jsonb_id(l.value -> 'fixtureId') = tlo.fixture_id
         LIMIT 1) tj ON true;

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

  IF v_identity_changed
     OR v_prev_kickoff IS DISTINCT FROM p_kickoff_at
     OR v_fx.status IS DISTINCT FROM p_status THEN
    INSERT INTO public.fixture_schedule_changes (
      fixture_id, previous_kickoff_at, new_kickoff_at, previous_status, new_status,
      previous_home_team_id, previous_away_team_id, new_home_team_id, new_away_team_id,
      kickoff_delta_seconds, direction_swapped, source
    ) VALUES (
      p_fixture_id, v_prev_kickoff, p_kickoff_at, v_fx.status, p_status,
      NULLIF(v_prev_home_id, -1), NULLIF(v_prev_away_id, -1), p_home_team_id, p_away_team_id,
      CASE WHEN v_prev_kickoff IS NULL THEN NULL
           ELSE EXTRACT(epoch FROM (p_kickoff_at - v_prev_kickoff))::bigint END,
      COALESCE(v_prev_home_id = p_away_team_id AND v_prev_away_id = p_home_team_id, false),
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