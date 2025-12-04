-- League history sync state table for tracking historical backfill progress
CREATE TABLE IF NOT EXISTS public.league_history_sync_state (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  last_synced_page INTEGER DEFAULT 0,
  total_fixtures_synced INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'error')),
  last_run_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, season)
);

-- Enable RLS
ALTER TABLE public.league_history_sync_state ENABLE ROW LEVEL SECURITY;

-- Service role can manage sync state
CREATE POLICY "Service role manages sync state" ON public.league_history_sync_state
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Admins can view sync state
CREATE POLICY "Admins can view sync state" ON public.league_history_sync_state
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_league_history_sync_status ON public.league_history_sync_state(status, league_id);
CREATE INDEX IF NOT EXISTS idx_league_history_sync_league_season ON public.league_history_sync_state(league_id, season);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_league_history_sync_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trigger_league_history_sync_updated_at
  BEFORE UPDATE ON public.league_history_sync_state
  FOR EACH ROW
  EXECUTE FUNCTION update_league_history_sync_updated_at();