-- Drop and recreate v_team_totals_prematch with inlined columns from fixtures and leagues
DROP VIEW IF EXISTS public.v_team_totals_prematch;

CREATE VIEW public.v_team_totals_prematch
WITH (security_invoker = true) AS
SELECT
  c.*,
  f.teams_home,
  f.teams_away,
  f.status AS fixture_status,
  l.name AS league_name
FROM public.team_totals_candidates c
JOIN public.fixtures f ON f.id = c.fixture_id
JOIN public.leagues l ON l.id = c.league_id
WHERE f.status IN ('NS','TBD')
  AND c.utc_kickoff >= (now() + interval '5 minutes')
  AND c.rules_passed = TRUE;