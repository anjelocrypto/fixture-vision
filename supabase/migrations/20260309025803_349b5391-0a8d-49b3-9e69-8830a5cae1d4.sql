
-- ============================================================================
-- P0/P1 Security Migration: revokes, trigger cleanup, pruning
-- Safe, explicit, idempotent
-- ============================================================================

-- 0) Required indexes for pruning performance
CREATE INDEX IF NOT EXISTS idx_optimizer_run_logs_started_at
  ON public.optimizer_run_logs (started_at);

CREATE INDEX IF NOT EXISTS idx_pipeline_run_logs_run_started
  ON public.pipeline_run_logs (run_started);

CREATE INDEX IF NOT EXISTS idx_user_rate_limits_window_start
  ON public.user_rate_limits (window_start);

-- 1) Revoke dangerous EXECUTE grants from internal-only functions
--    Then explicitly grant only to service_role

REVOKE EXECUTE ON FUNCTION public.get_cron_internal_key() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_cron_internal_key() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_cron_internal_key() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_internal_key() TO service_role;

REVOKE EXECUTE ON FUNCTION public.auto_release_stuck_locks(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auto_release_stuck_locks(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.auto_release_stuck_locks(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.auto_release_stuck_locks(integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.backfill_optimized_selections() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_optimized_selections() FROM anon;
REVOKE EXECUTE ON FUNCTION public.backfill_optimized_selections() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_optimized_selections() TO service_role;

REVOKE EXECUTE ON FUNCTION public.void_non_ft_pending_legs(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.void_non_ft_pending_legs(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.void_non_ft_pending_legs(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.void_non_ft_pending_legs(integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_fixtures_missing_results(integer, integer[], integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_fixtures_missing_results(integer, integer[], integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_fixtures_missing_results(integer, integer[], integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_fixtures_missing_results(integer, integer[], integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_pending_ticket_fixture_ids(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pending_ticket_fixture_ids(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_pending_ticket_fixture_ids(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_ticket_fixture_ids(integer) TO service_role;

-- 2) Drop duplicate trigger on user_entitlements
DROP TRIGGER IF EXISTS update_entitlements_timestamp ON public.user_entitlements;

-- 3) Pruning function
CREATE OR REPLACE FUNCTION public.prune_operational_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_optimizer_deleted   integer := 0;
  v_pipeline_deleted    integer := 0;
  v_rate_limits_deleted integer := 0;
BEGIN
  DELETE FROM public.optimizer_run_logs
  WHERE started_at < now() - interval '7 days';
  GET DIAGNOSTICS v_optimizer_deleted = ROW_COUNT;

  DELETE FROM public.pipeline_run_logs
  WHERE run_started < now() - interval '7 days';
  GET DIAGNOSTICS v_pipeline_deleted = ROW_COUNT;

  DELETE FROM public.user_rate_limits
  WHERE window_start < now() - interval '1 day';
  GET DIAGNOSTICS v_rate_limits_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'optimizer_run_logs_deleted', v_optimizer_deleted,
    'pipeline_run_logs_deleted', v_pipeline_deleted,
    'user_rate_limits_deleted', v_rate_limits_deleted,
    'pruned_at', now()
  );
END;
$func$;

REVOKE EXECUTE ON FUNCTION public.prune_operational_logs() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prune_operational_logs() FROM anon;
REVOKE EXECUTE ON FUNCTION public.prune_operational_logs() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prune_operational_logs() TO service_role;

-- 4) Idempotent pg_cron scheduling for pruning
DO $do$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid
    INTO v_jobid
  FROM cron.job
  WHERE jobname = 'prune-operational-logs'
  LIMIT 1;

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  PERFORM cron.schedule(
    'prune-operational-logs',
    '0 3 * * *',
    'SELECT public.prune_operational_logs();'
  );
END
$do$;
