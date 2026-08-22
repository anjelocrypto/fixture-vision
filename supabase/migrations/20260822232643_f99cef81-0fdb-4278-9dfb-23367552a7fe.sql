-- 1) profiles: remove authenticated-wide SELECT
DROP POLICY IF EXISTS "Authenticated can view usernames for leaderboard" ON public.profiles;

DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile"
ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.profiles FROM authenticated;
GRANT SELECT, INSERT ON public.profiles TO authenticated;
GRANT UPDATE (display_name, preferred_lang) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- 2) market_coins: owner-only read, no client writes
DROP POLICY IF EXISTS "Authenticated users can view all balances for leaderboard" ON public.market_coins;

DROP POLICY IF EXISTS "Users can view own balance" ON public.market_coins;
CREATE POLICY "Users can view own balance"
ON public.market_coins FOR SELECT TO authenticated
USING (auth.uid() = user_id);

REVOKE ALL ON public.market_coins FROM anon;
REVOKE ALL ON public.market_coins FROM authenticated;
GRANT SELECT ON public.market_coins TO authenticated;
GRANT ALL ON public.market_coins TO service_role;

-- 3) leaderboard view: no client access
REVOKE ALL ON public.v_market_leaderboard FROM anon;
REVOKE ALL ON public.v_market_leaderboard FROM authenticated;

-- 4) safe leaderboard RPC
CREATE OR REPLACE FUNCTION public.get_market_leaderboard(p_limit integer DEFAULT 50)
RETURNS TABLE (
  rank integer,
  display_name text,
  balance integer,
  positions_count integer,
  wins_count integer,
  losses_count integer,
  win_rate numeric,
  roi numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (rank() OVER (ORDER BY mc.balance DESC, mc.user_id))::integer AS rank,
    COALESCE(p.username, 'player_' || left(md5(mc.user_id::text), 8)) AS display_name,
    mc.balance,
    (SELECT count(*) FROM public.market_positions mp WHERE mp.user_id = mc.user_id)::integer AS positions_count,
    (SELECT count(*) FROM public.market_positions mp WHERE mp.user_id = mc.user_id AND mp.status = 'won')::integer AS wins_count,
    (SELECT count(*) FROM public.market_positions mp WHERE mp.user_id = mc.user_id AND mp.status = 'lost')::integer AS losses_count,
    CASE WHEN (SELECT count(*) FROM public.market_positions mp WHERE mp.user_id = mc.user_id AND mp.status IN ('won','lost')) > 0
      THEN round((SELECT count(*) FROM public.market_positions mp WHERE mp.user_id = mc.user_id AND mp.status = 'won')::numeric * 100.0
                 / (SELECT count(*) FROM public.market_positions mp WHERE mp.user_id = mc.user_id AND mp.status IN ('won','lost'))::numeric, 1)
      ELSE 0::numeric END AS win_rate,
    CASE WHEN mc.total_wagered > 0
      THEN round((mc.total_won - mc.total_wagered)::numeric * 100.0 / mc.total_wagered::numeric, 1)
      ELSE 0::numeric END AS roi
  FROM public.market_coins mc
  LEFT JOIN public.profiles p ON p.user_id = mc.user_id
  WHERE auth.uid() IS NOT NULL
    AND p_limit IS NOT NULL
    AND p_limit BETWEEN 1 AND 100
  ORDER BY mc.balance DESC, mc.user_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 100);
$$;

REVOKE ALL ON FUNCTION public.get_market_leaderboard(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_market_leaderboard(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_market_leaderboard(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_market_leaderboard(integer) TO service_role;