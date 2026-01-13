-- Fix get_market_aggregates to bypass RLS and return correct aggregates for ALL positions
-- The function should read aggregates from ALL positions, not just the calling user's own positions

-- First drop and recreate with SECURITY DEFINER to bypass RLS
DROP FUNCTION IF EXISTS public.get_market_aggregates(UUID);

CREATE OR REPLACE FUNCTION public.get_market_aggregates(_market_id UUID)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total_positions', COUNT(*),
    'yes_positions', COUNT(*) FILTER (WHERE outcome = 'yes'),
    'no_positions', COUNT(*) FILTER (WHERE outcome = 'no'),
    'yes_stake', COALESCE(SUM(net_stake) FILTER (WHERE outcome = 'yes'), 0),
    'no_stake', COALESCE(SUM(net_stake) FILTER (WHERE outcome = 'no'), 0),
    'total_pool', COALESCE(SUM(net_stake), 0),
    'unique_traders', COUNT(DISTINCT user_id)
  )
  FROM public.market_positions
  WHERE market_id = _market_id
$$;

-- Grant execute to anon and authenticated
GRANT EXECUTE ON FUNCTION public.get_market_aggregates(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_market_aggregates(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_market_aggregates(UUID) FROM public;