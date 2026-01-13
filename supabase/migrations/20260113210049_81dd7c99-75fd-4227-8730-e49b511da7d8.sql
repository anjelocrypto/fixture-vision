-- Fix v_market_leaderboard: use SECURITY INVOKER and unique display name fallback
DROP VIEW IF EXISTS public.v_market_leaderboard;

CREATE VIEW public.v_market_leaderboard
WITH (security_invoker = true)
AS
SELECT
  mc.user_id,
  COALESCE(p.display_name, 'Player ' || LEFT(mc.user_id::text, 6)) AS display_name,
  mc.balance,
  mc.total_wagered,
  mc.total_won,
  mc.total_fees_paid,
  COUNT(mp.id) FILTER (WHERE mp.status IN ('won', 'lost')) AS positions_count,
  COUNT(mp.id) FILTER (WHERE mp.status = 'won') AS wins_count,
  COUNT(mp.id) FILTER (WHERE mp.status = 'lost') AS losses_count,
  CASE 
    WHEN COUNT(mp.id) FILTER (WHERE mp.status IN ('won', 'lost')) > 0 
    THEN ROUND(
      COUNT(mp.id) FILTER (WHERE mp.status = 'won')::numeric / 
      COUNT(mp.id) FILTER (WHERE mp.status IN ('won', 'lost')) * 100, 
      1
    )
    ELSE 0 
  END AS win_rate,
  CASE 
    WHEN mc.total_wagered > 0 
    THEN ROUND((mc.total_won - mc.total_wagered)::numeric / mc.total_wagered * 100, 1)
    ELSE 0 
  END AS roi,
  RANK() OVER (ORDER BY mc.balance DESC) AS rank
FROM public.market_coins mc
LEFT JOIN public.profiles p ON p.user_id = mc.user_id
LEFT JOIN public.market_positions mp ON mp.user_id = mc.user_id
GROUP BY mc.user_id, p.display_name, mc.balance, mc.total_wagered, mc.total_won, mc.total_fees_paid;

-- Grant SELECT to authenticated and anon for public leaderboard
GRANT SELECT ON public.v_market_leaderboard TO authenticated, anon;

-- Fix trigger function search_path
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;