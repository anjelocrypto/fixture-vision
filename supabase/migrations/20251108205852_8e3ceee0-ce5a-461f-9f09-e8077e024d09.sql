-- Make odds nullable to support model-only selections (no bookmaker odds available)
ALTER TABLE public.optimized_selections
ALTER COLUMN odds DROP NOT NULL;

-- Add descriptive comments
COMMENT ON COLUMN public.optimized_selections.odds IS 'Bookmaker odds decimal; NULL = model-only (no odds available)';
COMMENT ON COLUMN public.optimized_selections.bookmaker IS 'Bookmaker name or ''model'' for model-only selections';

-- Create partial index for model-only lookups, matching filter patterns
CREATE INDEX IF NOT EXISTS idx_opt_sel_odds_null
ON public.optimized_selections (fixture_id, market, side, line, utc_kickoff)
WHERE odds IS NULL;