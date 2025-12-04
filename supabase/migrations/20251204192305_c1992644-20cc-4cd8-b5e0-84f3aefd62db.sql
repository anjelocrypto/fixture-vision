-- Create stats_health_violations table for tracking data integrity issues
CREATE TABLE IF NOT EXISTS public.stats_health_violations (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  team_id INT NOT NULL,
  team_name TEXT,
  league_ids INT[] NULL,
  metric TEXT NOT NULL, -- 'goals', 'corners', 'cards', 'fouls', 'offsides', 'sample_size', 'missing_cache', 'missing_results'
  db_value NUMERIC NULL,     -- value recomputed from fixtures + fixture_results
  cache_value NUMERIC NULL,  -- value from stats_cache
  diff NUMERIC NULL,         -- |db_value - cache_value|
  sample_size INT NULL,
  severity TEXT NOT NULL,    -- 'info', 'warning', 'error', 'critical'
  notes TEXT NULL,
  resolved_at TIMESTAMPTZ NULL,
  resolved_by TEXT NULL
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_stats_health_violations_created_at ON public.stats_health_violations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stats_health_violations_team_id ON public.stats_health_violations(team_id);
CREATE INDEX IF NOT EXISTS idx_stats_health_violations_severity ON public.stats_health_violations(severity);
CREATE INDEX IF NOT EXISTS idx_stats_health_violations_metric ON public.stats_health_violations(metric);

-- Enable RLS
ALTER TABLE public.stats_health_violations ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Admins can read violations"
  ON public.stats_health_violations
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can manage violations"
  ON public.stats_health_violations
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Add comment
COMMENT ON TABLE public.stats_health_violations IS 'Tracks data integrity issues detected by stats health check system';