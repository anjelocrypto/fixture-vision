-- PART 1: Create pipeline_run_logs table for unified job logging
CREATE TABLE IF NOT EXISTS public.pipeline_run_logs (
  id BIGSERIAL PRIMARY KEY,
  job_name TEXT NOT NULL,
  run_started TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_finished TIMESTAMPTZ,
  success BOOLEAN DEFAULT false,
  mode TEXT,
  processed INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  leagues_covered INTEGER[],
  details JSONB,
  error_message TEXT
);

-- Add index for efficient querying by job name and start time
CREATE INDEX IF NOT EXISTS idx_pipeline_logs_job_started 
  ON public.pipeline_run_logs (job_name, run_started DESC);

-- Enable RLS
ALTER TABLE public.pipeline_run_logs ENABLE ROW LEVEL SECURITY;

-- Service role can manage all logs
CREATE POLICY "Service role can manage pipeline logs"
  ON public.pipeline_run_logs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Admins can read logs
CREATE POLICY "Admins can read pipeline logs"
  ON public.pipeline_run_logs
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));