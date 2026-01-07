-- Create RPC function to get scorable pending legs with FOR UPDATE SKIP LOCKED
-- This INNER JOINs with fixture_results (FT) so we only fetch legs that CAN be scored
CREATE OR REPLACE FUNCTION public.get_scorable_pending_legs(batch_limit INT DEFAULT 500)
RETURNS TABLE (
  leg_id UUID,
  ticket_id UUID,
  user_id UUID,
  fixture_id BIGINT,
  market TEXT,
  side TEXT,
  line NUMERIC,
  goals_home SMALLINT,
  goals_away SMALLINT,
  corners_home SMALLINT,
  corners_away SMALLINT,
  cards_home SMALLINT,
  cards_away SMALLINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tlo.id AS leg_id,
    tlo.ticket_id,
    tlo.user_id,
    tlo.fixture_id::BIGINT,
    tlo.market,
    tlo.side,
    tlo.line,
    fr.goals_home::SMALLINT,
    fr.goals_away::SMALLINT,
    fr.corners_home::SMALLINT,
    fr.corners_away::SMALLINT,
    fr.cards_home::SMALLINT,
    fr.cards_away::SMALLINT
  FROM ticket_leg_outcomes tlo
  INNER JOIN fixture_results fr 
    ON tlo.fixture_id = fr.fixture_id 
    AND fr.status = 'FT'
  WHERE tlo.result_status = 'PENDING'
    AND tlo.kickoff_at < now() - interval '2 hours'
  ORDER BY tlo.kickoff_at ASC
  LIMIT batch_limit
  FOR UPDATE OF tlo SKIP LOCKED;
END;
$$;

-- Restrict EXECUTE to service_role and postgres only
REVOKE ALL ON FUNCTION public.get_scorable_pending_legs(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scorable_pending_legs(INT) FROM anon;
REVOKE ALL ON FUNCTION public.get_scorable_pending_legs(INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_scorable_pending_legs(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_scorable_pending_legs(INT) TO postgres;