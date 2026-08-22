BEGIN;

CREATE TABLE IF NOT EXISTS public.team_stats_refresh_queue (
  team_id bigint PRIMARY KEY,
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_stats_refresh_queue_claim_idx
  ON public.team_stats_refresh_queue (status, available_at, priority, updated_at);

ALTER TABLE public.team_stats_refresh_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_stats_refresh_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.team_stats_refresh_queue TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_team_stats_refresh(p_candidates jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.role() <> 'service_role'
     OR jsonb_typeof(p_candidates) <> 'array'
     OR jsonb_array_length(p_candidates) > 1000 THEN
    RAISE EXCEPTION 'invalid stats refresh candidates';
  END IF;

  INSERT INTO public.team_stats_refresh_queue (team_id, priority)
  SELECT candidate.team_id, min(candidate.priority)
  FROM jsonb_to_recordset(p_candidates) AS candidate(team_id bigint, priority integer)
  WHERE candidate.team_id > 0 AND candidate.priority BETWEEN 0 AND 1000
  GROUP BY candidate.team_id
  ON CONFLICT (team_id) DO UPDATE
  SET priority = LEAST(public.team_stats_refresh_queue.priority, excluded.priority),
      status = CASE
        WHEN public.team_stats_refresh_queue.status = 'processing'
         AND public.team_stats_refresh_queue.claimed_at >= now() - interval '10 minutes'
          THEN 'processing'
        ELSE 'pending'
      END,
      available_at = CASE
        WHEN public.team_stats_refresh_queue.status = 'processing'
         AND public.team_stats_refresh_queue.claimed_at >= now() - interval '10 minutes'
          THEN public.team_stats_refresh_queue.available_at
        ELSE LEAST(public.team_stats_refresh_queue.available_at, now())
      END,
      claim_token = CASE
        WHEN public.team_stats_refresh_queue.status = 'processing'
         AND public.team_stats_refresh_queue.claimed_at >= now() - interval '10 minutes'
          THEN public.team_stats_refresh_queue.claim_token
        ELSE NULL
      END,
      claimed_at = CASE
        WHEN public.team_stats_refresh_queue.status = 'processing'
         AND public.team_stats_refresh_queue.claimed_at >= now() - interval '10 minutes'
          THEN public.team_stats_refresh_queue.claimed_at
        ELSE NULL
      END,
      updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_team_stats_refresh(p_batch_limit integer DEFAULT 6)
RETURNS TABLE(claim_token uuid, team_id bigint, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  IF auth.role() <> 'service_role' OR p_batch_limit < 1 OR p_batch_limit > 50 THEN
    RAISE EXCEPTION 'invalid stats refresh claim';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT queue.team_id
    FROM public.team_stats_refresh_queue queue
    WHERE (queue.status = 'pending' AND queue.available_at <= now())
       OR (queue.status = 'processing' AND queue.claimed_at < now() - interval '10 minutes')
    ORDER BY queue.priority ASC, queue.available_at ASC, queue.updated_at ASC
    LIMIT p_batch_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.team_stats_refresh_queue queue
    SET status = 'processing',
        claim_token = v_token,
        claimed_at = now(),
        attempts = queue.attempts + 1,
        updated_at = now()
    FROM candidates
    WHERE queue.team_id = candidates.team_id
    RETURNING queue.team_id, queue.attempts
  )
  SELECT v_token, claimed.team_id, claimed.attempts FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_team_stats_refresh(
  p_team_id bigint,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'service role and claim token required';
  END IF;
  DELETE FROM public.team_stats_refresh_queue
  WHERE team_id = p_team_id AND status = 'processing' AND claim_token = p_claim_token;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_team_stats_refresh(
  p_team_id bigint,
  p_claim_token uuid,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'service role and claim token required';
  END IF;
  UPDATE public.team_stats_refresh_queue
  SET status = 'pending',
      available_at = now() + make_interval(mins => LEAST(60, GREATEST(1, attempts * attempts))),
      claim_token = NULL,
      claimed_at = NULL,
      last_error = left(COALESCE(p_error, 'unknown_error'), 500),
      updated_at = now()
  WHERE team_id = p_team_id AND status = 'processing' AND claim_token = p_claim_token;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_team_stats_refresh_claims(p_claim_token uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.role() <> 'service_role' OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'service role and claim token required';
  END IF;
  UPDATE public.team_stats_refresh_queue
  SET status = 'pending',
      available_at = LEAST(available_at, now()),
      claim_token = NULL,
      claimed_at = NULL,
      updated_at = now()
  WHERE status = 'processing' AND claim_token = p_claim_token;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_team_stats_refresh(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_team_stats_refresh(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_team_stats_refresh(bigint,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_team_stats_refresh(bigint,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_team_stats_refresh_claims(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_team_stats_refresh(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_team_stats_refresh(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_team_stats_refresh(bigint,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_team_stats_refresh(bigint,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_team_stats_refresh_claims(uuid) TO service_role;

COMMIT;
