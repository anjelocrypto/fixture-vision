-- Create odds_cache table for pre-match odds
CREATE TABLE IF NOT EXISTS public.odds_cache (
  fixture_id BIGINT PRIMARY KEY,
  payload JSONB NOT NULL,
  bookmakers TEXT[],
  markets TEXT[],
  captured_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.odds_cache ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Odds cache is viewable by authenticated users"
  ON public.odds_cache
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage odds cache"
  ON public.odds_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Index for TTL cleanup
CREATE INDEX IF NOT EXISTS idx_odds_captured_at ON public.odds_cache(captured_at DESC);

-- Enable pg_cron and pg_net extensions for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;