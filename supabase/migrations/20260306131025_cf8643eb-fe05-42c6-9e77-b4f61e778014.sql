
CREATE TABLE IF NOT EXISTS public.green_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id integer NOT NULL,
  market text NOT NULL,
  side text NOT NULL DEFAULT 'over',
  line_norm numeric NOT NULL,
  odds_band text NOT NULL,

  sample_size integer NOT NULL DEFAULT 0,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  hit_rate_pct numeric NOT NULL DEFAULT 0,
  roi_pct numeric NOT NULL DEFAULT 0,

  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT green_buckets_market_check CHECK (market IN ('goals','corners')),
  CONSTRAINT green_buckets_side_check CHECK (side IN ('over')),
  CONSTRAINT green_buckets_line_check CHECK (line_norm > 0),
  CONSTRAINT green_buckets_counts_check CHECK (
    sample_size >= 0 AND wins >= 0 AND losses >= 0 AND (wins + losses) = sample_size
  ),
  CONSTRAINT green_buckets_hit_rate_check CHECK (hit_rate_pct >= 0 AND hit_rate_pct <= 100),

  CONSTRAINT green_buckets_unique UNIQUE (league_id, market, side, line_norm, odds_band)
);

CREATE INDEX IF NOT EXISTS idx_green_buckets_lookup
  ON public.green_buckets (league_id, market, side, line_norm, odds_band);

CREATE INDEX IF NOT EXISTS idx_green_buckets_updated_at
  ON public.green_buckets (updated_at DESC);

ALTER TABLE public.green_buckets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read green_buckets" ON public.green_buckets;
CREATE POLICY "Authenticated can read green_buckets"
  ON public.green_buckets
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage green_buckets" ON public.green_buckets;
CREATE POLICY "Service role can manage green_buckets"
  ON public.green_buckets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.green_buckets FROM PUBLIC;
GRANT SELECT ON public.green_buckets TO authenticated;
GRANT ALL ON public.green_buckets TO service_role;
