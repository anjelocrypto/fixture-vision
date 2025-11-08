-- Grant SELECT on the view to authenticated users
GRANT SELECT ON public.v_team_totals_prematch TO authenticated;

-- Grant SELECT on underlying tables (required because view uses security_invoker=true)
GRANT SELECT ON public.team_totals_candidates TO authenticated;
GRANT SELECT ON public.fixtures TO authenticated;
GRANT SELECT ON public.leagues TO authenticated;