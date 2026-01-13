-- READ-ONLY RPC to get market aggregates efficiently (STABLE - no side effects)
CREATE OR REPLACE FUNCTION public.get_market_aggregates(_market_id UUID)
RETURNS JSON
LANGUAGE sql STABLE SECURITY INVOKER
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

-- Grant execute to authenticated and anon for public read access
GRANT EXECUTE ON FUNCTION public.get_market_aggregates(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_market_aggregates(UUID) TO anon;