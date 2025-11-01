-- 1) Cache for API-Football predictions (12h TTL refresh)
CREATE TABLE IF NOT EXISTS public.predictions_cache (
  fixture_id    BIGINT PRIMARY KEY,
  league_id     INT NOT NULL,
  home_prob     NUMERIC(6,4),
  draw_prob     NUMERIC(6,4),
  away_prob     NUMERIC(6,4),
  advice        TEXT,
  cached_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_predictions_cache_league ON public.predictions_cache(league_id);
CREATE INDEX IF NOT EXISTS idx_predictions_cache_cached ON public.predictions_cache(cached_at);

-- FK constraint for data integrity
ALTER TABLE public.predictions_cache
  ADD CONSTRAINT predictions_cache_fixture_fk
  FOREIGN KEY (fixture_id) REFERENCES public.fixtures(id) ON DELETE CASCADE;

ALTER TABLE public.predictions_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read predictions" ON public.predictions_cache 
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service role manage predictions" ON public.predictions_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.predictions_cache TO authenticated;

-- 2) Materialized selections for outcome markets
CREATE TABLE IF NOT EXISTS public.outcome_selections (
  id            BIGSERIAL PRIMARY KEY,
  fixture_id    BIGINT NOT NULL,
  league_id     INT NOT NULL,
  market_type   TEXT NOT NULL,
  outcome       TEXT NOT NULL,
  bookmaker     TEXT NOT NULL,
  odds          NUMERIC(8,2) NOT NULL,
  model_prob    NUMERIC(6,4),
  edge_pct      NUMERIC(6,4),
  utc_kickoff   TIMESTAMPTZ NOT NULL,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(fixture_id, market_type, outcome, bookmaker)
);

-- Winner v1: only 1x2/home/away for now
ALTER TABLE public.outcome_selections
  ADD CONSTRAINT outcome_market_check
  CHECK (market_type = '1x2');

ALTER TABLE public.outcome_selections
  ADD CONSTRAINT outcome_value_check
  CHECK (outcome IN ('home','away'));

-- Sanity checks
ALTER TABLE public.outcome_selections
  ADD CONSTRAINT outcome_odds_check
  CHECK (odds >= 1.01);

ALTER TABLE public.outcome_selections
  ADD CONSTRAINT outcome_model_prob_check
  CHECK (model_prob IS NULL OR (model_prob >= 0 AND model_prob <= 1));

-- Indexes for query patterns
CREATE INDEX IF NOT EXISTS idx_outcome_sel_kickoff ON public.outcome_selections(utc_kickoff);
CREATE INDEX IF NOT EXISTS idx_outcome_sel_market_outcome ON public.outcome_selections(market_type, outcome);
CREATE INDEX IF NOT EXISTS idx_outcome_sel_prob ON public.outcome_selections(model_prob DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_sel_odds ON public.outcome_selections(odds DESC);

-- Composite index matching UI query pattern
CREATE INDEX IF NOT EXISTS idx_outcome_sel_query
  ON public.outcome_selections (market_type, outcome, utc_kickoff, edge_pct DESC, odds DESC);

ALTER TABLE public.outcome_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read outcomes" ON public.outcome_selections 
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "service role manage outcomes" ON public.outcome_selections
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.outcome_selections TO authenticated;

-- 3) Best-price view for UI simplicity
CREATE OR REPLACE VIEW public.best_outcome_prices AS
WITH ranked AS (
  SELECT
    os.*,
    ROW_NUMBER() OVER (
      PARTITION BY os.fixture_id, os.market_type, os.outcome
      ORDER BY os.odds DESC
    ) AS rk
  FROM public.outcome_selections os
)
SELECT * FROM ranked WHERE rk = 1;

GRANT SELECT ON public.best_outcome_prices TO authenticated;