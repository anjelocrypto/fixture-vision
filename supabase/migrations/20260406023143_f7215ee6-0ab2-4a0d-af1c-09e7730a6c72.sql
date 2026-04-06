-- ============================================================================
-- Analytics events table for conversion/retention tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid,
  event_name text NOT NULL,
  properties jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for querying by event name and time
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created 
  ON public.analytics_events (event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user 
  ON public.analytics_events (user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- RLS: users can insert their own events, admins can read all
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own analytics events"
  ON public.analytics_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Anon can insert anonymous events"
  ON public.analytics_events FOR INSERT TO anon
  WITH CHECK (user_id IS NULL);

CREATE POLICY "Admins can read analytics events"
  ON public.analytics_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role full access analytics"
  ON public.analytics_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================================
-- Extended cleanup function: adds odds_cache, analysis_cache, 
-- stale optimized_selections, old webhook_events
-- ============================================================================
CREATE OR REPLACE FUNCTION public.prune_operational_logs()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_optimizer_deleted   integer := 0;
  v_pipeline_deleted    integer := 0;
  v_rate_limits_deleted integer := 0;
  v_odds_cache_deleted  integer := 0;
  v_analysis_deleted    integer := 0;
  v_selections_deleted  integer := 0;
  v_webhook_deleted     integer := 0;
  v_analytics_deleted   integer := 0;
BEGIN
  -- Operational logs: 7 days
  DELETE FROM public.optimizer_run_logs
  WHERE started_at < now() - interval '7 days';
  GET DIAGNOSTICS v_optimizer_deleted = ROW_COUNT;

  DELETE FROM public.pipeline_run_logs
  WHERE run_started < now() - interval '7 days';
  GET DIAGNOSTICS v_pipeline_deleted = ROW_COUNT;

  DELETE FROM public.user_rate_limits
  WHERE window_start < now() - interval '1 day';
  GET DIAGNOSTICS v_rate_limits_deleted = ROW_COUNT;

  -- Odds cache: 3 days (biggest bloat source)
  DELETE FROM public.odds_cache
  WHERE captured_at < now() - interval '3 days';
  GET DIAGNOSTICS v_odds_cache_deleted = ROW_COUNT;

  -- Analysis cache: 7 days
  DELETE FROM public.analysis_cache
  WHERE computed_at < now() - interval '7 days';
  GET DIAGNOSTICS v_analysis_deleted = ROW_COUNT;

  -- Stale optimized selections: past kickoffs older than 24h
  DELETE FROM public.optimized_selections
  WHERE utc_kickoff < now() - interval '24 hours';
  GET DIAGNOSTICS v_selections_deleted = ROW_COUNT;

  -- Webhook events: 30 days (idempotency window)
  DELETE FROM public.webhook_events
  WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_webhook_deleted = ROW_COUNT;

  -- Analytics events: 90 days
  DELETE FROM public.analytics_events
  WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_analytics_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'optimizer_run_logs_deleted', v_optimizer_deleted,
    'pipeline_run_logs_deleted', v_pipeline_deleted,
    'user_rate_limits_deleted', v_rate_limits_deleted,
    'odds_cache_deleted', v_odds_cache_deleted,
    'analysis_cache_deleted', v_analysis_deleted,
    'stale_selections_deleted', v_selections_deleted,
    'webhook_events_deleted', v_webhook_deleted,
    'analytics_events_deleted', v_analytics_deleted,
    'pruned_at', now()
  );
END;
$$;