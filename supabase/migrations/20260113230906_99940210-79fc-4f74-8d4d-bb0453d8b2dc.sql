CREATE OR REPLACE FUNCTION public.admin_create_market_for_fixture(
  _fixture_id bigint,
  _resolution_rule text,
  _odds_yes numeric DEFAULT 1.80,
  _odds_no numeric DEFAULT 2.00,
  _close_minutes_before_kickoff int DEFAULT 5,
  _title_override text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fixture RECORD;
  v_home_name text;
  v_away_name text;
  v_kickoff_at timestamptz;
  v_closes_at timestamptz;
  v_title text;
  v_description text;
  v_status text;
  v_market_id uuid;
  v_is_admin boolean := false;
BEGIN
  -- Admin check (DB role)
  SELECT public.has_role(auth.uid(), 'admin'::app_role) INTO v_is_admin;
  IF NOT coalesce(v_is_admin,false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;

  -- Validate
  IF _fixture_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'fixture_id is required');
  END IF;

  IF _close_minutes_before_kickoff IS NULL OR _close_minutes_before_kickoff < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'close_minutes_before_kickoff must be >= 0');
  END IF;

  IF _odds_yes IS NULL OR _odds_no IS NULL OR _odds_yes <= 1 OR _odds_no <= 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'odds must be > 1.0');
  END IF;

  IF lower(_resolution_rule) NOT IN (
    'over_0.5_goals','over_1.5_goals','over_2.5_goals','under_2.5_goals',
    'btts',
    'over_8.5_corners','under_9.5_corners',
    'home_win','away_win','draw'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unsupported resolution_rule');
  END IF;

  -- Load fixture
  SELECT f.id, f."timestamp", f.league_id, f.teams_home, f.teams_away
    INTO v_fixture
  FROM public.fixtures f
  WHERE f.id = _fixture_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Fixture not found');
  END IF;

  v_home_name := nullif(btrim(coalesce(v_fixture.teams_home->>'name','')), '');
  v_away_name := nullif(btrim(coalesce(v_fixture.teams_away->>'name','')), '');
  IF v_home_name IS NULL THEN v_home_name := 'Home'; END IF;
  IF v_away_name IS NULL THEN v_away_name := 'Away'; END IF;

  v_kickoff_at := to_timestamp(v_fixture."timestamp"::double precision);
  v_closes_at := v_kickoff_at - (_close_minutes_before_kickoff * interval '1 minute');

  v_status := CASE WHEN v_closes_at > now() THEN 'open' ELSE 'closed' END;

  -- Prevent duplicates (fixture + rule)
  IF EXISTS (
    SELECT 1
    FROM public.prediction_markets pm
    WHERE pm.fixture_id = _fixture_id
      AND lower(coalesce(pm.resolution_rule,'')) = lower(_resolution_rule)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Market already exists for this fixture + rule');
  END IF;

  -- Title/description
  v_title := CASE
    WHEN _title_override IS NOT NULL AND btrim(_title_override) <> '' THEN btrim(_title_override)
    ELSE v_home_name || ' vs ' || v_away_name
  END;

  CASE lower(_resolution_rule)
    WHEN 'over_0.5_goals'     THEN v_title := v_title || ' - Over 0.5 Goals';   v_description := 'Over 0.5 goals will be scored in this match.';
    WHEN 'over_1.5_goals'     THEN v_title := v_title || ' - Over 1.5 Goals';   v_description := 'Over 1.5 goals will be scored in this match.';
    WHEN 'over_2.5_goals'     THEN v_title := v_title || ' - Over 2.5 Goals';   v_description := 'Over 2.5 goals will be scored in this match.';
    WHEN 'under_2.5_goals'    THEN v_title := v_title || ' - Under 2.5 Goals';  v_description := 'Under 2.5 goals will be scored in this match.';
    WHEN 'btts'               THEN v_title := v_title || ' - BTTS';             v_description := 'Both teams will score in this match.';
    WHEN 'over_8.5_corners'   THEN v_title := v_title || ' - Over 8.5 Corners'; v_description := 'Over 8.5 corners will occur in this match.';
    WHEN 'under_9.5_corners'  THEN v_title := v_title || ' - Under 9.5 Corners';v_description := 'Under 9.5 corners will occur in this match.';
    WHEN 'home_win'           THEN v_title := v_title || ' - Home Win';         v_description := v_home_name || ' will win this match.';
    WHEN 'away_win'           THEN v_title := v_title || ' - Away Win';         v_description := v_away_name || ' will win this match.';
    WHEN 'draw'               THEN v_title := v_title || ' - Draw';             v_description := 'This match will end in a draw.';
  END CASE;

  -- Insert market (market_type must be 'binary' per your constraint)
  INSERT INTO public.prediction_markets (
    title, description, category, market_type,
    fixture_id, resolution_rule, closes_at,
    created_by, odds_yes, odds_no,
    total_staked_yes, total_staked_no, status
  )
  VALUES (
    v_title, v_description, 'football', 'binary',
    _fixture_id, lower(_resolution_rule), v_closes_at,
    auth.uid(), _odds_yes, _odds_no,
    0, 0, v_status
  )
  RETURNING id INTO v_market_id;

  -- Audit log (constraint-safe action)
  INSERT INTO public.admin_market_audit_log (
    admin_user_id, market_id, action, is_system, details
  )
  VALUES (
    auth.uid(),
    v_market_id,
    'create',
    false,
    jsonb_build_object(
      'source', 'fixture_dashboard',
      'fixture_id', _fixture_id,
      'resolution_rule', lower(_resolution_rule),
      'closes_at', v_closes_at,
      'kickoff_at', v_kickoff_at
    )
  );

  RETURN jsonb_build_object('ok', true, 'market_id', v_market_id, 'title', v_title, 'status', v_status);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_market_for_fixture(bigint,text,numeric,numeric,int,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_market_for_fixture(bigint,text,numeric,numeric,int,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_create_market_for_fixture(bigint,text,numeric,numeric,int,text) TO authenticated;