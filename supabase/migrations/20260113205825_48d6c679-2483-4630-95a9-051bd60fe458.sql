-- Sports Market v1 - Full Schema with Security Fixes
-- All tables use IF NOT EXISTS for idempotency

-- ============================================
-- 1. Add display_name to profiles (for leaderboard)
-- ============================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name TEXT;

-- ============================================
-- 2. Create market_coins table (user balances)
-- ============================================
CREATE TABLE IF NOT EXISTS public.market_coins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 1000 CHECK (balance >= 0),
  total_wagered INTEGER NOT NULL DEFAULT 0,
  total_won INTEGER NOT NULL DEFAULT 0,
  total_fees_paid INTEGER NOT NULL DEFAULT 0,
  last_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 3. Create prediction_markets table
-- ============================================
CREATE TABLE IF NOT EXISTS public.prediction_markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'football' CHECK (category IN ('football', 'basketball', 'other')),
  market_type TEXT NOT NULL DEFAULT 'binary' CHECK (market_type IN ('binary')),
  fixture_id INTEGER REFERENCES fixtures(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'resolved', 'cancelled')),
  odds_yes DECIMAL(5,2) NOT NULL CHECK (odds_yes >= 1.01),
  odds_no DECIMAL(5,2) NOT NULL CHECK (odds_no >= 1.01),
  total_staked_yes INTEGER NOT NULL DEFAULT 0,
  total_staked_no INTEGER NOT NULL DEFAULT 0,
  closes_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  winning_outcome TEXT CHECK (winning_outcome IN ('yes', 'no')),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 4. Create market_positions table (user bets)
-- ============================================
CREATE TABLE IF NOT EXISTS public.market_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  market_id UUID NOT NULL REFERENCES prediction_markets(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('yes', 'no')),
  stake INTEGER NOT NULL CHECK (stake > 0),
  fee_amount INTEGER NOT NULL DEFAULT 0,
  net_stake INTEGER NOT NULL,
  odds_at_placement DECIMAL(5,2) NOT NULL,
  potential_payout INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'refunded')),
  payout_amount INTEGER DEFAULT 0,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, market_id)
);

-- ============================================
-- 5. Create market_leaderboard_snapshots table
-- ============================================
CREATE TABLE IF NOT EXISTS public.market_leaderboard_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  final_balance INTEGER NOT NULL,
  total_wagered INTEGER NOT NULL,
  total_won INTEGER NOT NULL,
  total_fees_paid INTEGER NOT NULL DEFAULT 0,
  positions_count INTEGER NOT NULL DEFAULT 0,
  wins_count INTEGER NOT NULL DEFAULT 0,
  losses_count INTEGER NOT NULL DEFAULT 0,
  win_rate DECIMAL(5,2),
  roi DECIMAL(7,2),
  rank INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 6. Create admin_market_audit_log table
-- ============================================
CREATE TABLE IF NOT EXISTS public.admin_market_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'resolve', 'cancel', 'manual_resolve')),
  market_id UUID REFERENCES prediction_markets(id) ON DELETE SET NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 7. Create indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_prediction_markets_status ON public.prediction_markets(status);
CREATE INDEX IF NOT EXISTS idx_prediction_markets_closes_at ON public.prediction_markets(closes_at);
CREATE INDEX IF NOT EXISTS idx_prediction_markets_fixture_id ON public.prediction_markets(fixture_id);
CREATE INDEX IF NOT EXISTS idx_prediction_markets_category ON public.prediction_markets(category);
CREATE INDEX IF NOT EXISTS idx_market_positions_user_id ON public.market_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_market_positions_market_id ON public.market_positions(market_id);
CREATE INDEX IF NOT EXISTS idx_market_positions_status ON public.market_positions(status);
CREATE INDEX IF NOT EXISTS idx_market_leaderboard_snapshots_period ON public.market_leaderboard_snapshots(period);
CREATE INDEX IF NOT EXISTS idx_market_leaderboard_snapshots_user_id ON public.market_leaderboard_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_market_audit_log_admin ON public.admin_market_audit_log(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_market_audit_log_market ON public.admin_market_audit_log(market_id);

-- ============================================
-- 8. Enable RLS on all tables
-- ============================================
ALTER TABLE public.market_coins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prediction_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_leaderboard_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_market_audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 9. RLS Policies - market_coins (SELECT only for users)
-- ============================================
DROP POLICY IF EXISTS "Users can view own balance" ON public.market_coins;
CREATE POLICY "Users can view own balance"
  ON public.market_coins FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access to market_coins" ON public.market_coins;
CREATE POLICY "Service role full access to market_coins"
  ON public.market_coins FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 10. RLS Policies - prediction_markets
-- ============================================
DROP POLICY IF EXISTS "Anyone can view open and resolved markets" ON public.prediction_markets;
CREATE POLICY "Anyone can view open and resolved markets"
  ON public.prediction_markets FOR SELECT
  TO authenticated
  USING (status IN ('open', 'closed', 'resolved'));

DROP POLICY IF EXISTS "Admins can view all markets" ON public.prediction_markets;
CREATE POLICY "Admins can view all markets"
  ON public.prediction_markets FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can create markets" ON public.prediction_markets;
CREATE POLICY "Admins can create markets"
  ON public.prediction_markets FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update markets" ON public.prediction_markets;
CREATE POLICY "Admins can update markets"
  ON public.prediction_markets FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can delete draft markets" ON public.prediction_markets;
CREATE POLICY "Admins can delete draft markets"
  ON public.prediction_markets FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND status = 'draft');

DROP POLICY IF EXISTS "Service role full access to prediction_markets" ON public.prediction_markets;
CREATE POLICY "Service role full access to prediction_markets"
  ON public.prediction_markets FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 11. RLS Policies - market_positions (SELECT only for users)
-- ============================================
DROP POLICY IF EXISTS "Users can view own positions" ON public.market_positions;
CREATE POLICY "Users can view own positions"
  ON public.market_positions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access to market_positions" ON public.market_positions;
CREATE POLICY "Service role full access to market_positions"
  ON public.market_positions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 12. RLS Policies - market_leaderboard_snapshots
-- ============================================
DROP POLICY IF EXISTS "Anyone can view leaderboard snapshots" ON public.market_leaderboard_snapshots;
CREATE POLICY "Anyone can view leaderboard snapshots"
  ON public.market_leaderboard_snapshots FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Service role full access to leaderboard snapshots" ON public.market_leaderboard_snapshots;
CREATE POLICY "Service role full access to leaderboard snapshots"
  ON public.market_leaderboard_snapshots FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 13. RLS Policies - admin_market_audit_log
-- ============================================
DROP POLICY IF EXISTS "Admins can view audit log" ON public.admin_market_audit_log;
CREATE POLICY "Admins can view audit log"
  ON public.admin_market_audit_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Service role full access to audit log" ON public.admin_market_audit_log;
CREATE POLICY "Service role full access to audit log"
  ON public.admin_market_audit_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 14. Lock down table privileges (Edge Functions only)
-- ============================================
REVOKE INSERT, UPDATE, DELETE ON public.market_coins FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.market_positions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.admin_market_audit_log FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.market_leaderboard_snapshots FROM anon, authenticated;

-- prediction_markets: admins via RLS, but also need privilege for RLS to apply
GRANT INSERT, UPDATE, DELETE ON public.prediction_markets TO authenticated;

-- Allow SELECT where intended
GRANT SELECT ON public.market_coins TO authenticated;
GRANT SELECT ON public.market_positions TO authenticated;
GRANT SELECT ON public.prediction_markets TO authenticated;
GRANT SELECT ON public.market_leaderboard_snapshots TO authenticated, anon;
GRANT SELECT ON public.admin_market_audit_log TO authenticated;

-- ============================================
-- 15. Create ensure_market_coins function (FIXED - uses auth.uid())
-- ============================================
CREATE OR REPLACE FUNCTION public.ensure_market_coins()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.market_coins (user_id, balance, total_wagered, total_won, total_fees_paid, last_reset_at)
  VALUES (auth.uid(), 1000, 0, 0, 0, NOW())
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ensure_market_coins() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_market_coins() TO authenticated, service_role;

-- ============================================
-- 16. Create get_my_market_stats function
-- ============================================
CREATE OR REPLACE FUNCTION public.get_my_market_stats()
RETURNS TABLE (
  balance INTEGER,
  total_wagered INTEGER,
  total_won INTEGER,
  total_fees_paid INTEGER,
  positions_count BIGINT,
  wins_count BIGINT,
  losses_count BIGINT,
  pending_count BIGINT,
  win_rate DECIMAL,
  roi DECIMAL,
  next_reset_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  -- Ensure user has a market_coins record
  PERFORM public.ensure_market_coins();
  
  RETURN QUERY
  WITH stats AS (
    SELECT
      mc.balance,
      mc.total_wagered,
      mc.total_won,
      mc.total_fees_paid,
      COUNT(mp.id) AS positions_count,
      COUNT(mp.id) FILTER (WHERE mp.status = 'won') AS wins_count,
      COUNT(mp.id) FILTER (WHERE mp.status = 'lost') AS losses_count,
      COUNT(mp.id) FILTER (WHERE mp.status = 'pending') AS pending_count
    FROM public.market_coins mc
    LEFT JOIN public.market_positions mp ON mp.user_id = mc.user_id
    WHERE mc.user_id = v_user_id
    GROUP BY mc.user_id, mc.balance, mc.total_wagered, mc.total_won, mc.total_fees_paid
  )
  SELECT
    s.balance,
    s.total_wagered,
    s.total_won,
    s.total_fees_paid,
    s.positions_count,
    s.wins_count,
    s.losses_count,
    s.pending_count,
    CASE 
      WHEN (s.wins_count + s.losses_count) > 0 
      THEN ROUND((s.wins_count::DECIMAL / (s.wins_count + s.losses_count)) * 100, 2)
      ELSE 0
    END AS win_rate,
    CASE 
      WHEN s.total_wagered > 0 
      THEN ROUND(((s.total_won - s.total_wagered)::DECIMAL / s.total_wagered) * 100, 2)
      ELSE 0
    END AS roi,
    date_trunc('month', NOW()) + INTERVAL '1 month' AS next_reset_at
  FROM stats s;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_market_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_market_stats() TO authenticated, service_role;

-- ============================================
-- 17. Create updated_at trigger function
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 18. Apply updated_at triggers
-- ============================================
DROP TRIGGER IF EXISTS update_market_coins_updated_at ON public.market_coins;
CREATE TRIGGER update_market_coins_updated_at
  BEFORE UPDATE ON public.market_coins
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_prediction_markets_updated_at ON public.prediction_markets;
CREATE TRIGGER update_prediction_markets_updated_at
  BEFORE UPDATE ON public.prediction_markets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 19. Create live leaderboard view
-- ============================================
CREATE OR REPLACE VIEW public.v_market_leaderboard AS
SELECT
  mc.user_id,
  COALESCE(p.display_name, 'Anonymous') AS display_name,
  mc.balance,
  mc.total_wagered,
  mc.total_won,
  mc.total_fees_paid,
  COUNT(mp.id) AS positions_count,
  COUNT(mp.id) FILTER (WHERE mp.status = 'won') AS wins_count,
  COUNT(mp.id) FILTER (WHERE mp.status = 'lost') AS losses_count,
  CASE 
    WHEN COUNT(mp.id) FILTER (WHERE mp.status IN ('won', 'lost')) > 0 
    THEN ROUND((COUNT(mp.id) FILTER (WHERE mp.status = 'won')::DECIMAL / 
                COUNT(mp.id) FILTER (WHERE mp.status IN ('won', 'lost'))) * 100, 2)
    ELSE 0
  END AS win_rate,
  CASE 
    WHEN mc.total_wagered > 0 
    THEN ROUND(((mc.total_won - mc.total_wagered)::DECIMAL / mc.total_wagered) * 100, 2)
    ELSE 0
  END AS roi,
  RANK() OVER (ORDER BY mc.balance DESC) AS rank
FROM public.market_coins mc
LEFT JOIN public.profiles p ON p.user_id = mc.user_id
LEFT JOIN public.market_positions mp ON mp.user_id = mc.user_id
GROUP BY mc.user_id, p.display_name, mc.balance, mc.total_wagered, mc.total_won, mc.total_fees_paid
ORDER BY mc.balance DESC;