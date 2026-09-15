CREATE OR REPLACE FUNCTION public.get_league_catalogue()
RETURNS TABLE (
  league_id integer,
  league_name text,
  logo text,
  season integer,
  country_id integer,
  country_name text,
  country_code text,
  country_flag text,
  upcoming_fixtures bigint,
  total_fixtures bigint,
  last_kickoff_at timestamptz,
  last_synced_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT
    l.id,
    l.name,
    l.logo,
    l.season,
    l.country_id,
    c.name,
    c.code,
    c.flag,
    COALESCE(f.upcoming, 0),
    COALESCE(f.total, 0),
    f.last_kickoff,
    f.last_synced
  FROM public.leagues l
  LEFT JOIN public.countries c ON c.id = l.country_id
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE fx."timestamp" >= EXTRACT(epoch FROM now())) AS upcoming,
      count(*) AS total,
      to_timestamp(max(fx."timestamp")) AS last_kickoff,
      max(fx.updated_at) AS last_synced
    FROM public.fixtures fx
    WHERE fx.league_id = l.id
  ) f ON true
$$;

REVOKE ALL ON FUNCTION public.get_league_catalogue() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_league_catalogue() FROM anon;
REVOKE ALL ON FUNCTION public.get_league_catalogue() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_league_catalogue() TO service_role;