-- Create table for storing per-team BTTS metrics
CREATE TABLE IF NOT EXISTS public.team_btts_metrics (
  team_id       INTEGER NOT NULL,
  team_name     TEXT NOT NULL,
  league_id     INTEGER NOT NULL,
  btts_5        INTEGER NOT NULL DEFAULT 0,
  btts_5_rate   NUMERIC(5,2) NOT NULL DEFAULT 0,
  sample_5      INTEGER NOT NULL DEFAULT 0,
  btts_10       INTEGER NOT NULL DEFAULT 0,
  btts_10_rate  NUMERIC(5,2) NOT NULL DEFAULT 0,
  sample_10     INTEGER NOT NULL DEFAULT 0,
  btts_15       INTEGER NOT NULL DEFAULT 0,
  btts_15_rate  NUMERIC(5,2) NOT NULL DEFAULT 0,
  sample_15     INTEGER NOT NULL DEFAULT 0,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT team_btts_metrics_pkey PRIMARY KEY (team_id, league_id)
);

-- Add indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_team_btts_league ON public.team_btts_metrics (league_id);
CREATE INDEX IF NOT EXISTS idx_team_btts_computed_at ON public.team_btts_metrics (computed_at DESC);

-- Enable Row Level Security
ALTER TABLE public.team_btts_metrics ENABLE ROW LEVEL SECURITY;

-- RLS policy: Authenticated users can read BTTS metrics
CREATE POLICY "Authenticated users can read btts metrics"
ON public.team_btts_metrics
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- RLS policy: Service role can manage BTTS metrics (for cron/refresh)
CREATE POLICY "Service role can manage btts metrics"
ON public.team_btts_metrics
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');