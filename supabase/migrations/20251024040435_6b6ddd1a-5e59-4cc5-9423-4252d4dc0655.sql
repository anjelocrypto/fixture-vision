-- Create optimizer_run_logs table for tracking refresh job execution
CREATE TABLE IF NOT EXISTS public.optimizer_run_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  scope JSONB,
  scanned INTEGER DEFAULT 0,
  with_odds INTEGER DEFAULT 0,
  upserted INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.optimizer_run_logs ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "service_role_full_access"
ON public.optimizer_run_logs FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Admins can read logs
CREATE POLICY "admins_can_read"
ON public.optimizer_run_logs FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create index for querying recent runs
CREATE INDEX idx_optimizer_run_logs_started_at ON public.optimizer_run_logs(started_at DESC);
CREATE INDEX idx_optimizer_run_logs_run_type ON public.optimizer_run_logs(run_type);