-- 1. market_leaderboard_snapshots: remove anon exposure of raw user_id
DROP POLICY IF EXISTS "Anyone can view leaderboard snapshots" ON public.market_leaderboard_snapshots;

REVOKE ALL ON public.market_leaderboard_snapshots FROM anon;
REVOKE ALL ON public.market_leaderboard_snapshots FROM authenticated;

ALTER TABLE public.market_leaderboard_snapshots ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.market_leaderboard_snapshots TO authenticated;
GRANT ALL ON public.market_leaderboard_snapshots TO service_role;

CREATE POLICY "Users can view their own leaderboard snapshots"
ON public.market_leaderboard_snapshots
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 2. Definer hardening: no SECURITY DEFINER routine may be executable by PUBLIC.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
  END LOOP;
END $$;

-- 3. Anon may execute exactly one documented public-safe definer routine
--    (get_market_aggregates: returns only aggregate counts/stakes, no user ids).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname <> 'get_market_aggregates'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.get_market_aggregates(uuid) TO anon, authenticated;