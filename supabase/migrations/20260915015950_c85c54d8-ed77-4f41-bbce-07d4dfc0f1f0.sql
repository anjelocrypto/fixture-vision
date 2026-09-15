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
  v_side text;
BEGIN
  -- Malformed identifiers (sentinel <= 0) can never be trusted.
  IF COALESCE(p_leg_home_id, 1) < 1 OR COALESCE(p_leg_away_id, 1) < 1
     OR COALESCE(p_fx_home_id, 1) < 1 OR COALESCE(p_fx_away_id, 1) < 1 THEN
    RETURN 'identity_unverifiable';
  END IF;

  -- Home side
  IF p_leg_home_id IS NOT NULL AND p_fx_home_id IS NOT NULL THEN
    IF p_leg_home_id <> p_fx_home_id THEN RETURN 'team_direction_mismatch'; END IF;
  ELSE
    IF public.normalize_team_name(p_leg_home_name) IS NULL
       OR public.normalize_team_name(p_fx_home_name) IS NULL THEN
      RETURN 'identity_unverifiable';
    END IF;
    IF public.normalize_team_name(p_leg_home_name)
       <> public.normalize_team_name(p_fx_home_name) THEN
      RETURN 'team_direction_mismatch';
    END IF;
  END IF;

  -- Away side
  IF p_leg_away_id IS NOT NULL AND p_fx_away_id IS NOT NULL THEN
    IF p_leg_away_id <> p_fx_away_id THEN RETURN 'team_direction_mismatch'; END IF;
  ELSE
    IF public.normalize_team_name(p_leg_away_name) IS NULL
       OR public.normalize_team_name(p_fx_away_name) IS NULL THEN
      RETURN 'identity_unverifiable';
    END IF;
    IF public.normalize_team_name(p_leg_away_name)
       <> public.normalize_team_name(p_fx_away_name) THEN
      RETURN 'team_direction_mismatch';
    END IF;
  END IF;

  -- Explicit inversion guard when partial id evidence exists on both sides.
  IF p_leg_home_id IS NOT NULL AND p_fx_away_id IS NOT NULL
     AND p_leg_home_id = p_fx_away_id THEN
    RETURN 'team_direction_mismatch';
  END IF;
  IF p_leg_away_id IS NOT NULL AND p_fx_home_id IS NOT NULL
     AND p_leg_away_id = p_fx_home_id THEN
    RETURN 'team_direction_mismatch';
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
REVOKE ALL ON FUNCTION public.evaluate_leg_hold_v3(timestamptz,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluate_leg_hold_v3(timestamptz,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.evaluate_leg_hold_v3(timestamptz,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_leg_hold_v3(timestamptz,timestamptz,bigint,bigint,bigint,bigint,text,text,text,text) TO service_role;