BEGIN;

CREATE TABLE IF NOT EXISTS public.football_league_teams (
  league_id integer NOT NULL,
  season integer NOT NULL,
  team_id integer NOT NULL,
  team_name text NOT NULL,
  team_code text,
  team_country text,
  team_logo text,
  venue jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text NOT NULL DEFAULT 'api-football',
  active boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, season, team_id),
  CHECK (league_id > 0 AND season BETWEEN 2000 AND 2200 AND team_id > 0),
  CHECK (length(team_name) BETWEEN 1 AND 300),
  CHECK (provider IN ('api-football'))
);

CREATE INDEX IF NOT EXISTS football_league_teams_active_idx
  ON public.football_league_teams (league_id, season, active, team_id);

ALTER TABLE public.football_league_teams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read football league rosters"
  ON public.football_league_teams;
CREATE POLICY "Admins can read football league rosters"
  ON public.football_league_teams
  FOR SELECT TO authenticated
  USING (public.is_user_whitelisted());

REVOKE ALL ON public.football_league_teams FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.football_league_teams TO authenticated;
GRANT ALL ON public.football_league_teams TO service_role;

-- Replace one league-season roster atomically only after the provider returns
-- a non-empty, validated payload. A failed fetch therefore preserves the last
-- known authoritative roster.
CREATE OR REPLACE FUNCTION public.replace_football_league_roster(
  p_league_id integer,
  p_season integer,
  p_teams jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.role() <> 'service_role'
     OR p_league_id <= 0 OR p_season < 2000 OR p_season > 2200
     OR jsonb_typeof(p_teams) <> 'array'
     OR jsonb_array_length(p_teams) < 1
     OR jsonb_array_length(p_teams) > 100 THEN
    RAISE EXCEPTION 'invalid football roster replacement';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_teams) AS x(team_id integer, team_name text)
    WHERE x.team_id IS NULL OR x.team_id <= 0
       OR x.team_name IS NULL OR btrim(x.team_name) = ''
  ) THEN
    RAISE EXCEPTION 'invalid football roster team';
  END IF;

  IF (
    SELECT count(DISTINCT x.team_id)
    FROM jsonb_to_recordset(p_teams) AS x(team_id integer)
  ) <> jsonb_array_length(p_teams) THEN
    RAISE EXCEPTION 'duplicate football roster team';
  END IF;

  INSERT INTO public.football_league_teams (
    league_id, season, team_id, team_name, team_code, team_country,
    team_logo, venue, provider, active, last_seen_at
  )
  SELECT
    p_league_id,
    p_season,
    x.team_id,
    btrim(x.team_name),
    NULLIF(btrim(x.team_code), ''),
    NULLIF(btrim(x.team_country), ''),
    NULLIF(btrim(x.team_logo), ''),
    COALESCE(x.venue, '{}'::jsonb),
    'api-football',
    true,
    now()
  FROM jsonb_to_recordset(p_teams) AS x(
    team_id integer,
    team_name text,
    team_code text,
    team_country text,
    team_logo text,
    venue jsonb
  )
  ON CONFLICT (league_id, season, team_id) DO UPDATE
  SET team_name = excluded.team_name,
      team_code = excluded.team_code,
      team_country = excluded.team_country,
      team_logo = excluded.team_logo,
      venue = excluded.venue,
      provider = excluded.provider,
      active = true,
      last_seen_at = now();

  UPDATE public.football_league_teams current_team
  SET active = false,
      last_seen_at = now()
  WHERE current_team.league_id = p_league_id
    AND current_team.season = p_season
    AND current_team.active
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_teams) AS incoming(team_id integer)
      WHERE incoming.team_id = current_team.team_id
    );

  SELECT count(*)::integer INTO v_count
  FROM public.football_league_teams
  WHERE league_id = p_league_id AND season = p_season AND active;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_football_league_roster(integer,integer,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_football_league_roster(integer,integer,jsonb)
  TO service_role;

COMMIT;