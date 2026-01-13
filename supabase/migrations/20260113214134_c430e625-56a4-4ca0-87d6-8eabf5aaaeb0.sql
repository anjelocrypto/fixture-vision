-- Fix ensure_market_coins permissions: grant to authenticated users
REVOKE ALL ON FUNCTION public.ensure_market_coins() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_market_coins() FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_market_coins() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_market_coins() TO service_role;