-- STEP 1: Create user_rate_limits table for per-user rate limiting
CREATE TABLE public.user_rate_limits (
    user_id uuid NOT NULL,
    feature text NOT NULL,
    window_start timestamptz NOT NULL,
    count integer NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, feature, window_start)
);

-- Add index for efficient cleanup of old windows
CREATE INDEX idx_user_rate_limits_window ON public.user_rate_limits (window_start);

-- Enable RLS
ALTER TABLE public.user_rate_limits ENABLE ROW LEVEL SECURITY;

-- Only service role can access this table (no direct client access)
CREATE POLICY "Service role can manage rate limits"
ON public.user_rate_limits
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Comment explaining purpose
COMMENT ON TABLE public.user_rate_limits IS 'Short-lived rate limiting table for per-user, per-feature request throttling. Rows auto-expire after 1 minute.';

-- STEP 2: Add foreign key for fixture_results -> fixtures (orphan check passed: 0 orphans)
ALTER TABLE public.fixture_results
ADD CONSTRAINT fixture_results_fixture_id_fk
FOREIGN KEY (fixture_id)
REFERENCES public.fixtures(id)
NOT VALID;

-- Validate the constraint
ALTER TABLE public.fixture_results
VALIDATE CONSTRAINT fixture_results_fixture_id_fk;