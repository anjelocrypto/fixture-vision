-- Add comments and index for model-only selections support
COMMENT ON COLUMN public.optimized_selections.odds
  IS 'Bookmaker odds. NULL = model-only (no book price cached).';
COMMENT ON COLUMN public.optimized_selections.bookmaker
  IS 'Bookmaker name or ''model'' for model-only selections.';

-- Index for efficiently finding model-only selections
CREATE INDEX IF NOT EXISTS idx_opt_sel_odds_null
  ON public.optimized_selections(fixture_id, market, side, line)
  WHERE odds IS NULL;