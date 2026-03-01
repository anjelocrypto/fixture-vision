
-- ============================================================
-- Safe Zone Picks: precomputed table for the Safe Zone chatbot
-- ============================================================

CREATE TABLE public.safe_zone_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id bigint NOT NULL,
  utc_kickoff timestamptz NOT NULL,
  league_id int NOT NULL,
  league_name text NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  market text NOT NULL,
  side text NOT NULL DEFAULT 'over',
  line numeric NOT NULL,
  odds numeric NOT NULL,
  bookmaker text,
  confidence_score numeric NOT NULL,
  wilson_lb numeric NOT NULL,
  historical_roi_pct numeric,
  sample_size int NOT NULL,
  edge_pct numeric,
  explanation text,
  computed_at timestamptz NOT NULL DEFAULT now(),

  -- Only corners and goals allowed
  CONSTRAINT safe_zone_picks_market_check CHECK (market IN ('corners', 'goals')),
  -- Confidence score bounded 0..1
  CONSTRAINT safe_zone_picks_confidence_check CHECK (confidence_score >= 0 AND confidence_score <= 1),

  -- ONE pick per fixture (the single safest pick across all markets)
  CONSTRAINT safe_zone_picks_fixture_unique UNIQUE (fixture_id)
);

-- Performance indexes
CREATE INDEX idx_safe_zone_picks_kickoff ON public.safe_zone_picks (utc_kickoff);
CREATE INDEX idx_safe_zone_picks_confidence ON public.safe_zone_picks (confidence_score DESC);
CREATE INDEX idx_safe_zone_picks_league ON public.safe_zone_picks (league_id);

-- Enable RLS
ALTER TABLE public.safe_zone_picks ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read picks
CREATE POLICY "Authenticated users can read safe zone picks"
  ON public.safe_zone_picks
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role has full access (for precompute pipeline)
CREATE POLICY "Service role manages safe zone picks"
  ON public.safe_zone_picks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
