-- ============================================================================
-- MIGRATION: Schema Hardening for BET AI
-- Description: Align schema with expected structure, optimize indexes, harden RLS
-- ============================================================================

-- 1. Change fixtures.id from INTEGER to BIGINT
-- This handles larger fixture IDs from API-Football
ALTER TABLE public.fixtures ALTER COLUMN id TYPE BIGINT;

-- 2. Add composite and useful indexes
-- Composite index for leagues by country and season (replaces single-column)
CREATE INDEX IF NOT EXISTS idx_leagues_country_season ON public.leagues(country_id, season);

-- Composite index for fixtures by league and date (more efficient than separate)
DROP INDEX IF EXISTS public.idx_fixtures_league_id;
DROP INDEX IF EXISTS public.idx_fixtures_date;
CREATE INDEX IF NOT EXISTS idx_fixtures_league_date ON public.fixtures(league_id, date);

-- Index for timestamp-based queries
CREATE INDEX IF NOT EXISTS idx_fixtures_timestamp ON public.fixtures(timestamp);

-- Index for analysis cache cleanup/TTL queries
CREATE INDEX IF NOT EXISTS idx_analysis_computed_at ON public.analysis_cache(computed_at DESC);

-- 3. Add auto-update trigger for fixtures.updated_at
CREATE OR REPLACE FUNCTION public.update_fixtures_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_fixtures_updated_at
  BEFORE UPDATE ON public.fixtures
  FOR EACH ROW
  EXECUTE FUNCTION public.update_fixtures_updated_at();

-- 4. Refactor stats_cache to denormalized structure
-- Step 4a: Add new denormalized columns alongside existing JSONB
ALTER TABLE public.stats_cache 
  ADD COLUMN IF NOT EXISTS goals NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cards NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offsides NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS corners NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fouls NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sample_size INTEGER DEFAULT 0;

-- Step 4b: Backfill data from JSONB to new columns
UPDATE public.stats_cache
SET 
  goals = COALESCE((last5_stats->>'goals')::numeric, 0),
  cards = COALESCE((last5_stats->>'cards')::numeric, 0),
  offsides = COALESCE((last5_stats->>'offsides')::numeric, 0),
  corners = COALESCE((last5_stats->>'corners')::numeric, 0),
  fouls = COALESCE((last5_stats->>'fouls')::numeric, 0),
  sample_size = COALESCE((last5_stats->>'sample_size')::integer, 5)
WHERE last5_stats IS NOT NULL;

-- Step 4c: Drop the old UUID PK constraint and make team_id the natural PK
ALTER TABLE public.stats_cache DROP CONSTRAINT IF EXISTS stats_cache_pkey;
ALTER TABLE public.stats_cache DROP CONSTRAINT IF EXISTS stats_cache_team_id_key;
ALTER TABLE public.stats_cache ADD PRIMARY KEY (team_id);

-- Step 4d: Drop unused columns
ALTER TABLE public.stats_cache DROP COLUMN IF EXISTS id;
ALTER TABLE public.stats_cache DROP COLUMN IF EXISTS fixture_id;
ALTER TABLE public.stats_cache DROP COLUMN IF EXISTS last5_stats;

-- Step 4e: Make new columns NOT NULL now that they're populated
ALTER TABLE public.stats_cache 
  ALTER COLUMN goals SET NOT NULL,
  ALTER COLUMN cards SET NOT NULL,
  ALTER COLUMN offsides SET NOT NULL,
  ALTER COLUMN corners SET NOT NULL,
  ALTER COLUMN fouls SET NOT NULL,
  ALTER COLUMN sample_size SET NOT NULL;

-- 5. Refactor analysis_cache to use fixture_id as natural PK
-- Step 5a: Drop old UUID PK
ALTER TABLE public.analysis_cache DROP CONSTRAINT IF EXISTS analysis_cache_pkey;
ALTER TABLE public.analysis_cache DROP CONSTRAINT IF EXISTS analysis_cache_fixture_id_key;

-- Step 5b: Make fixture_id the primary key
ALTER TABLE public.analysis_cache ADD PRIMARY KEY (fixture_id);

-- Step 5c: Drop surrogate UUID column
ALTER TABLE public.analysis_cache DROP COLUMN IF EXISTS id;

-- Step 5d: Ensure fixture_id is BIGINT to match fixtures table
ALTER TABLE public.analysis_cache ALTER COLUMN fixture_id TYPE BIGINT;

-- 6. Tighten RLS policies to authenticated-only
-- Drop existing permissive policies
DROP POLICY IF EXISTS "Countries are viewable by everyone" ON public.countries;
DROP POLICY IF EXISTS "Leagues are viewable by everyone" ON public.leagues;
DROP POLICY IF EXISTS "Fixtures are viewable by everyone" ON public.fixtures;
DROP POLICY IF EXISTS "Stats cache is viewable by everyone" ON public.stats_cache;
DROP POLICY IF EXISTS "Analysis cache is viewable by everyone" ON public.analysis_cache;

-- Create authenticated-only SELECT policies
CREATE POLICY "Countries are viewable by authenticated users"
  ON public.countries
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Leagues are viewable by authenticated users"
  ON public.leagues
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Fixtures are viewable by authenticated users"
  ON public.fixtures
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Stats cache is viewable by authenticated users"
  ON public.stats_cache
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Analysis cache is viewable by authenticated users"
  ON public.analysis_cache
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Add service role write policies (for edge functions)
CREATE POLICY "Service role can manage countries"
  ON public.countries
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can manage leagues"
  ON public.leagues
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can manage fixtures"
  ON public.fixtures
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can manage stats cache"
  ON public.stats_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can manage analysis cache"
  ON public.analysis_cache
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');