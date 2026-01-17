-- 1) Fix RPC permissions: revoke from PUBLIC/anon, grant to authenticated only
REVOKE ALL ON FUNCTION public.check_username_available(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_username_available(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_username_available(text) TO authenticated;

REVOKE ALL ON FUNCTION public.update_username(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_username(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_username(text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_profile_with_username(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_profile_with_username(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_profile_with_username(text) TO authenticated;

-- 2) Allow authenticated users to read all profiles for leaderboard display
-- (No anon access - keeps it secure)
DROP POLICY IF EXISTS "Authenticated can view usernames for leaderboard" ON public.profiles;

CREATE POLICY "Authenticated can view usernames for leaderboard"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- 3) Recreate leaderboard view with actual usernames (preserving all columns)
DROP VIEW IF EXISTS public.v_market_leaderboard;

CREATE VIEW public.v_market_leaderboard
WITH (security_invoker = true)
AS
SELECT 
  mc.user_id,
  COALESCE(p.username, 'player_' || left(mc.user_id::text, 8)) AS display_name,
  mc.balance,
  mc.total_wagered,
  mc.total_won,
  mc.total_fees_paid,
  (SELECT COUNT(*) FROM market_positions mp WHERE mp.user_id = mc.user_id) AS positions_count,
  (SELECT COUNT(*) FROM market_positions mp WHERE mp.user_id = mc.user_id AND mp.status = 'won') AS wins_count,
  (SELECT COUNT(*) FROM market_positions mp WHERE mp.user_id = mc.user_id AND mp.status = 'lost') AS losses_count,
  CASE 
    WHEN (SELECT COUNT(*) FROM market_positions mp WHERE mp.user_id = mc.user_id AND mp.status IN ('won','lost')) > 0 
    THEN ROUND(
      (SELECT COUNT(*) FROM market_positions mp WHERE mp.user_id = mc.user_id AND mp.status = 'won')::numeric * 100.0 / 
      (SELECT COUNT(*) FROM market_positions mp WHERE mp.user_id = mc.user_id AND mp.status IN ('won','lost'))
    , 1)
    ELSE 0
  END AS win_rate,
  CASE 
    WHEN mc.total_wagered > 0 
    THEN ROUND((mc.total_won - mc.total_wagered)::numeric * 100.0 / mc.total_wagered, 1)
    ELSE 0
  END AS roi,
  rank() OVER (ORDER BY mc.balance DESC) AS rank
FROM market_coins mc
LEFT JOIN profiles p ON p.user_id = mc.user_id;

-- Re-grant view access
GRANT SELECT ON public.v_market_leaderboard TO authenticated;