BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Gate D: claim only legs that the scorer can deterministically settle. This
-- prevents an old null-stat/banned-market leg from starving every valid leg
-- behind it and prevents score_attempts from increasing on guaranteed skips.
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
    JOIN public.ticket_outcomes ticket
      ON ticket.ticket_id = tlo.ticket_id
    JOIN public.fixture_results fr
      ON fr.fixture_id = tlo.fixture_id
     AND fr.status = 'FT'
    WHERE tlo.result_status = 'PENDING'
      AND tlo.kickoff_at < now() - interval '2 hours'
      AND (tlo.score_claimed_at IS NULL OR tlo.score_claimed_at < now() - interval '10 minutes')
      AND lower(tlo.side) IN ('over', 'under')
      AND tlo.line IS NOT NULL
      AND CASE lower(tlo.market)
        WHEN 'goals' THEN fr.goals_home IS NOT NULL AND fr.goals_away IS NOT NULL
        WHEN 'total_goals' THEN fr.goals_home IS NOT NULL AND fr.goals_away IS NOT NULL
        WHEN 'over_under' THEN fr.goals_home IS NOT NULL AND fr.goals_away IS NOT NULL
        WHEN 'corners' THEN fr.corners_home IS NOT NULL AND fr.corners_away IS NOT NULL
        WHEN 'total_corners' THEN fr.corners_home IS NOT NULL AND fr.corners_away IS NOT NULL
        WHEN 'cards' THEN fr.cards_home IS NOT NULL AND fr.cards_away IS NOT NULL
        WHEN 'total_cards' THEN fr.cards_home IS NOT NULL AND fr.cards_away IS NOT NULL
        ELSE false
      END
    ORDER BY tlo.kickoff_at ASC, tlo.id ASC
    LIMIT LEAST(GREATEST(COALESCE(batch_limit, 500), 1), 1000)
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
  JOIN public.fixture_results fr ON fr.fixture_id = c.fixture_id
  ORDER BY c.kickoff_at ASC, c.id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scorable_ticket_legs(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_scorable_ticket_legs(integer) TO service_role;

-- Return exact, non-truncated backlog metrics using the same eligibility rules
-- as the claim function. Unsupported legacy legs are intentionally excluded
-- from pending_with_ft_results so the watchdog measures work the scorer can do.
CREATE OR REPLACE FUNCTION public.get_ticket_pipeline_health_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending_missing bigint;
  v_pending_with_ft bigint;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  SELECT count(*)
  INTO v_pending_missing
  FROM public.ticket_leg_outcomes tlo
  WHERE tlo.result_status = 'PENDING'
    AND tlo.kickoff_at < now() - interval '2 hours'
    AND NOT EXISTS (
      SELECT 1
      FROM public.fixture_results fr
      WHERE fr.fixture_id = tlo.fixture_id
    );

  SELECT count(*)
  INTO v_pending_with_ft
  FROM public.ticket_leg_outcomes tlo
  JOIN public.ticket_outcomes ticket
    ON ticket.ticket_id = tlo.ticket_id
  JOIN public.fixture_results fr
    ON fr.fixture_id = tlo.fixture_id
   AND fr.status = 'FT'
  WHERE tlo.result_status = 'PENDING'
    AND tlo.kickoff_at < now() - interval '2 hours'
    AND lower(tlo.side) IN ('over', 'under')
    AND tlo.line IS NOT NULL
    AND CASE lower(tlo.market)
      WHEN 'goals' THEN fr.goals_home IS NOT NULL AND fr.goals_away IS NOT NULL
      WHEN 'total_goals' THEN fr.goals_home IS NOT NULL AND fr.goals_away IS NOT NULL
      WHEN 'over_under' THEN fr.goals_home IS NOT NULL AND fr.goals_away IS NOT NULL
      WHEN 'corners' THEN fr.corners_home IS NOT NULL AND fr.corners_away IS NOT NULL
      WHEN 'total_corners' THEN fr.corners_home IS NOT NULL AND fr.corners_away IS NOT NULL
      WHEN 'cards' THEN fr.cards_home IS NOT NULL AND fr.cards_away IS NOT NULL
      WHEN 'total_cards' THEN fr.cards_home IS NOT NULL AND fr.cards_away IS NOT NULL
      ELSE false
    END;

  RETURN jsonb_build_object(
    'pending_missing_fixture_results', v_pending_missing,
    'pending_with_ft_results', v_pending_with_ft
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_ticket_pipeline_health_metrics()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ticket_pipeline_health_metrics() TO service_role;

-- Gate D: replace job 64's embedded bearer credential with the same canonical
-- X-CRON-KEY contract used by the deployed function. Preserve its existing URL
-- without copying a project-specific URL or credential into source control.
DO $$
DECLARE
  v_job record;
  v_url text;
  v_command text;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'cron.job unavailable; skipping environment-specific job 64 rewrite';
    RETURN;
  END IF;

  SELECT jobid, jobname, command
  INTO v_job
  FROM cron.job
  WHERE jobid = 64;

  IF NOT FOUND OR v_job.jobname <> 'populate-safe-zone-picks-hourly' THEN
    RAISE EXCEPTION 'expected cron job 64 populate-safe-zone-picks-hourly';
  END IF;

  v_url := substring(v_job.command FROM $regex$url\s*:=\s*'([^']+)'$regex$);
  IF v_url IS NULL OR v_url !~ '^https://[^/]+/functions/v1/populate-safe-zone-picks$' THEN
    RAISE EXCEPTION 'could not safely recover job 64 function URL';
  END IF;

  v_command := format(
    $command$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-key', public.get_cron_internal_key()
        ),
        body := '{}'::jsonb
      );
    $command$,
    v_url
  );

  PERFORM cron.alter_job(64, command := v_command, active := false);
END;
$$;

COMMIT;