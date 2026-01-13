-- Ensure permissions are correctly set: REVOKE ALL from PUBLIC first, then GRANT to anon + authenticated
REVOKE ALL ON FUNCTION public.get_market_aggregates(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_market_aggregates(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_market_aggregates(UUID) TO authenticated;