-- Add columns to stats_cache for tracking which fixtures were used
ALTER TABLE public.stats_cache
  ADD COLUMN IF NOT EXISTS last_five_fixture_ids BIGINT[] DEFAULT '{}'::bigint[],
  ADD COLUMN IF NOT EXISTS last_final_fixture BIGINT,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'api-football';

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_stats_cache_team_id ON public.stats_cache(team_id);
CREATE INDEX IF NOT EXISTS idx_stats_cache_computed_at ON public.stats_cache(computed_at);