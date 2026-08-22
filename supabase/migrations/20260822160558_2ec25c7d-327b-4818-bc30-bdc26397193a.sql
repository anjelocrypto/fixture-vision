BEGIN;

ALTER TABLE public.cron_job_locks
  ADD COLUMN IF NOT EXISTS lock_token uuid;

CREATE OR REPLACE FUNCTION public.acquire_cron_lease(
  p_job_name text,
  p_duration_minutes integer DEFAULT 15
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_token uuid := gen_random_uuid();
BEGIN
  IF auth.role() <> 'service_role' OR p_job_name IS NULL
     OR p_duration_minutes < 1 OR p_duration_minutes > 120 THEN
    RAISE EXCEPTION 'invalid cron lease request';
  END IF;

  INSERT INTO public.cron_job_locks (
    job_name, locked_until, locked_by, locked_at, lock_token
  )
  VALUES (
    p_job_name, v_now + make_interval(mins => p_duration_minutes),
    'cron', v_now, v_token
  )
  ON CONFLICT (job_name) DO UPDATE
  SET locked_until = excluded.locked_until,
      locked_by = excluded.locked_by,
      locked_at = excluded.locked_at,
      lock_token = excluded.lock_token
  WHERE public.cron_job_locks.locked_until < v_now;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_cron_lease(
  p_job_name text,
  p_lock_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  DELETE FROM public.cron_job_locks
  WHERE job_name = p_job_name AND lock_token = p_lock_token;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_cron_lease(text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_cron_lease(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_cron_lease(text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_cron_lease(text,uuid) TO service_role;

ALTER TABLE public.ticket_leg_outcomes
  ADD COLUMN IF NOT EXISTS score_claim_token uuid,
  ADD COLUMN IF NOT EXISTS score_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS score_attempts integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS ticket_leg_outcomes_score_claim_idx
  ON public.ticket_leg_outcomes (result_status, score_claimed_at, kickoff_at)
  WHERE result_status = 'PENDING';

CREATE OR REPLACE FUNCTION public.claim_scorable_ticket_legs(batch_limit integer DEFAULT 500)
RETURNS TABLE (
  claim_token uuid,
  leg_id uuid,
  ticket_id uuid,
  user_id uuid,
  fixture_id bigint,
  market text,
  side text,
  line numeric,
  goals_home smallint,
  goals_away smallint,
  corners_home smallint,
  corners_away smallint,
  cards_home smallint,
  cards_away smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim_token uuid := gen_random_uuid();
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT tlo.id
    FROM public.ticket_leg_outcomes tlo
    JOIN public.fixture_results fr
      ON fr.fixture_id = tlo.fixture_id AND fr.status = 'FT'
    WHERE tlo.result_status = 'PENDING'
      AND tlo.kickoff_at < now() - interval '2 hours'
      AND (tlo.score_claimed_at IS NULL OR tlo.score_claimed_at < now() - interval '10 minutes')
    ORDER BY tlo.kickoff_at ASC
    LIMIT LEAST(GREATEST(batch_limit, 1), 1000)
    FOR UPDATE OF tlo SKIP LOCKED
  ), claimed AS (
    UPDATE public.ticket_leg_outcomes tlo
    SET score_claim_token = v_claim_token,
        score_claimed_at = now(),
        score_attempts = tlo.score_attempts + 1
    FROM candidates c
    WHERE tlo.id = c.id
    RETURNING tlo.*
  )
  SELECT
    v_claim_token,
    c.id,
    c.ticket_id,
    c.user_id,
    c.fixture_id,
    c.market,
    c.side,
    c.line,
    fr.goals_home,
    fr.goals_away,
    fr.corners_home,
    fr.corners_away,
    fr.cards_home,
    fr.cards_away
  FROM claimed c
  JOIN public.fixture_results fr ON fr.fixture_id = c.fixture_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_scored_ticket_leg(
  p_leg_id uuid,
  p_claim_token uuid,
  p_result_status text,
  p_actual_value numeric,
  p_scored_version text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' OR p_result_status NOT IN ('WIN', 'LOSS', 'PUSH', 'VOID') THEN
    RAISE EXCEPTION 'invalid score finalization request';
  END IF;

  UPDATE public.ticket_leg_outcomes
  SET result_status = p_result_status,
      actual_value = p_actual_value,
      settled_at = now(),
      scored_version = p_scored_version,
      score_claim_token = NULL,
      score_claimed_at = NULL
  WHERE id = p_leg_id
    AND result_status = 'PENDING'
    AND score_claim_token = p_claim_token;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_ticket_leg_score_claim(
  p_leg_id uuid,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  UPDATE public.ticket_leg_outcomes
  SET score_claim_token = NULL, score_claimed_at = NULL
  WHERE id = p_leg_id
    AND result_status = 'PENDING'
    AND score_claim_token = p_claim_token;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_ticket_outcome(p_ticket_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer;
  v_won integer;
  v_lost integer;
  v_pushed integer;
  v_void integer;
  v_settled integer;
  v_status text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  PERFORM 1 FROM public.ticket_outcomes WHERE ticket_id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket outcome not found';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE result_status = 'WIN')::integer,
    count(*) FILTER (WHERE result_status = 'LOSS')::integer,
    count(*) FILTER (WHERE result_status = 'PUSH')::integer,
    count(*) FILTER (WHERE result_status = 'VOID')::integer
  INTO v_total, v_won, v_lost, v_pushed, v_void
  FROM public.ticket_leg_outcomes
  WHERE ticket_id = p_ticket_id;

  v_settled := v_won + v_lost + v_pushed + v_void;
  v_status := CASE
    WHEN v_lost > 0 THEN 'LOST'
    WHEN v_total > 0 AND v_void = v_total THEN 'VOID'
    WHEN v_total > 0 AND v_settled = v_total THEN 'WON'
    WHEN v_settled > 0 THEN 'PARTIAL'
    ELSE 'PENDING'
  END;

  UPDATE public.ticket_outcomes
  SET legs_total = v_total,
      legs_settled = v_settled,
      legs_won = v_won,
      legs_lost = v_lost,
      legs_pushed = v_pushed,
      legs_void = v_void,
      ticket_status = v_status,
      settled_at = CASE WHEN v_total > 0 AND v_settled = v_total THEN now() ELSE NULL END
  WHERE ticket_id = p_ticket_id;

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scorable_ticket_legs(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_scored_ticket_leg(uuid,uuid,text,numeric,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_ticket_leg_score_claim(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_ticket_outcome(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scorable_ticket_legs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_scored_ticket_leg(uuid,uuid,text,numeric,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ticket_leg_score_claim(uuid,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_ticket_outcome(uuid)
  TO service_role;

COMMIT;