-- 1) RPC: get_pending_ticket_fixture_ids (targeted backfill list)
CREATE OR REPLACE FUNCTION public.get_pending_ticket_fixture_ids(batch_limit integer DEFAULT 100)
RETURNS TABLE(fixture_id bigint, kickoff_at timestamptz, league_id integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT
    tlo.fixture_id::bigint,
    tlo.kickoff_at,
    tlo.league_id::integer
  FROM public.ticket_leg_outcomes tlo
  LEFT JOIN public.fixture_results fr ON fr.fixture_id = tlo.fixture_id
  WHERE tlo.result_status = 'PENDING'
    AND tlo.kickoff_at < now() - interval '2 hours'
    AND tlo.kickoff_at > now() - interval '30 days'
    AND fr.fixture_id IS NULL
  ORDER BY tlo.kickoff_at ASC
  LIMIT batch_limit;
$$;

-- 2) RPC: void_non_ft_pending_legs (unblocks tickets safely)
CREATE OR REPLACE FUNCTION public.void_non_ft_pending_legs(batch_limit integer DEFAULT 500)
RETURNS TABLE(voided_count integer, affected_tickets integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_voided integer := 0;
  v_tickets integer := 0;
BEGIN
  WITH to_void AS (
    SELECT tlo.id, tlo.ticket_id
    FROM public.ticket_leg_outcomes tlo
    JOIN public.fixture_results fr ON fr.fixture_id = tlo.fixture_id
    WHERE tlo.result_status = 'PENDING'
      AND tlo.kickoff_at < now() - interval '2 hours'
      AND tlo.kickoff_at > now() - interval '30 days'
      AND fr.status IN ('AET','PEN','AWD','ABD','CANC','PST','WO')
    ORDER BY tlo.kickoff_at ASC
    LIMIT batch_limit
    FOR UPDATE OF tlo SKIP LOCKED
  ),
  updated AS (
    UPDATE public.ticket_leg_outcomes tlo
    SET result_status = 'VOID',
        scored_version = 'v1.2-non-ft-void',
        settled_at = now()
    FROM to_void tv
    WHERE tlo.id = tv.id
    RETURNING tv.ticket_id
  )
  SELECT
    COUNT(*)::int,
    COUNT(DISTINCT ticket_id)::int
  INTO v_voided, v_tickets
  FROM updated;

  RETURN QUERY SELECT v_voided, v_tickets;
END;
$$;

-- 3) Lock down EXECUTE permissions
REVOKE EXECUTE ON FUNCTION public.get_pending_ticket_fixture_ids(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.void_non_ft_pending_legs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_ticket_fixture_ids(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.void_non_ft_pending_legs(integer) TO service_role;