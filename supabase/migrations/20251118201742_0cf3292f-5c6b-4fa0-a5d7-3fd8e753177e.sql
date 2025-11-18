-- Add indexes for all-leagues filterizer mode (120h window queries)
-- These indexes are idempotent and will only be created if they don't exist

-- Index on utc_kickoff for time-window queries in all-leagues mode
CREATE INDEX IF NOT EXISTS idx_optimized_selections_kickoff 
  ON optimized_selections(utc_kickoff);

-- Composite index for league-specific queries with time filtering
CREATE INDEX IF NOT EXISTS idx_optimized_selections_league_kickoff 
  ON optimized_selections(league_id, utc_kickoff);

-- Comment for documentation
COMMENT ON INDEX idx_optimized_selections_kickoff IS 
  'Supports all-leagues Filterizer queries filtering by utc_kickoff (120h window)';
COMMENT ON INDEX idx_optimized_selections_league_kickoff IS 
  'Supports single-league Filterizer queries with time filtering';