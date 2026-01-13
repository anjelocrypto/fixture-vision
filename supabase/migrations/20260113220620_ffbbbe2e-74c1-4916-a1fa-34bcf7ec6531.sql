-- ============================================================================
-- Prediction Markets: DB-native cron jobs (no HTTP, no embedded tokens)
-- Includes:
--  1) auto_resolve_markets()  -> resolves fixture-linked markets using resolution_rule/market_type
--  2) pg_cron schedules:
--        - close_expired_markets every 5 minutes
--        - auto_resolve_markets every 10 minutes
-- ============================================================================

-- Ensure pg_cron extension is enabled (required for scheduling)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================================
-- auto_resolve_markets: resolves markets whose fixture has FT result
-- Uses:
--   - prediction_markets.resolution_rule (preferred) or prediction_markets.market_type (fallback)
--   - fixture_results(goals_home, goals_away) where status='FT'
-- Calls:
--   - public.resolve_market(_market_id, _winning_outcome, NULL, true)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.auto_resolve_markets()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market RECORD;
  v_rule text;
  v_total_goals int;
  v_line numeric;
  v_winning_outcome text;
  v_resolved int := 0;
  v_skipped int := 0;
  v_rpc_result jsonb;
BEGIN
  -- Loop through resolvable markets (dedupe by pm.id)
  FOR v_market IN
    SELECT DISTINCT ON (pm.id)
      pm.id,
      pm.title,
      pm.market_type,
      pm.resolution_rule,
      pm.fixture_id,
      fr.goals_home,
      fr.goals_away
    FROM prediction_markets pm
    INNER JOIN fixture_results fr
      ON fr.fixture_id = pm.fixture_id
     AND fr.status = 'FT'
    WHERE pm.status IN ('open', 'closed')
      AND pm.fixture_id IS NOT NULL
      AND pm.winning_outcome IS NULL
    -- IMPORTANT: deterministic pick if fixture_results has duplicates.
    -- If you have fr.updated_at or fr.created_at, use it here.
    ORDER BY pm.id
  LOOP
    v_rule := lower(coalesce(v_market.resolution_rule, v_market.market_type));
    v_total_goals := v_market.goals_home + v_market.goals_away;
    v_winning_outcome := NULL;

    -- over_X / overX
    IF v_rule ~ 'over_?[0-9]+\.?[0-9]*' THEN
      v_line := (regexp_match(v_rule, '([0-9]+\.?[0-9]*)'))[1]::numeric;
      v_winning_outcome := CASE WHEN v_total_goals > v_line THEN 'yes' ELSE 'no' END;

    -- under_X / underX
    ELSIF v_rule ~ 'under_?[0-9]+\.?[0-9]*' THEN
      v_line := (regexp_match(v_rule, '([0-9]+\.?[0-9]*)'))[1]::numeric;
      v_winning_outcome := CASE WHEN v_total_goals < v_line THEN 'yes' ELSE 'no' END;

    -- BTTS
    ELSIF v_rule ~ 'btts' OR v_rule ~ 'both.?teams' THEN
      v_winning_outcome := CASE
        WHEN v_market.goals_home > 0 AND v_market.goals_away > 0 THEN 'yes'
        ELSE 'no'
      END;

    -- Home win
    ELSIF v_rule ~ 'home.?win' THEN
      v_winning_outcome := CASE WHEN v_market.goals_home > v_market.goals_away THEN 'yes' ELSE 'no' END;

    -- Away win
    ELSIF v_rule ~ 'away.?win' THEN
      v_winning_outcome := CASE WHEN v_market.goals_away > v_market.goals_home THEN 'yes' ELSE 'no' END;

    -- Draw
    ELSIF v_rule ~ 'draw' THEN
      v_winning_outcome := CASE WHEN v_market.goals_home = v_market.goals_away THEN 'yes' ELSE 'no' END;
    END IF;

    -- Skip if rule is unknown / unparsable
    IF v_winning_outcome IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Call atomic resolve RPC (returns jsonb)
    v_rpc_result := public.resolve_market(
      v_market.id,
      v_winning_outcome,
      NULL,
      true
    );

    IF coalesce((v_rpc_result->>'ok')::boolean, false) THEN
      v_resolved := v_resolved + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'resolved', v_resolved,
    'skipped', v_skipped
  );
END;
$$;

-- Restrict execution to service_role only
REVOKE ALL ON FUNCTION public.auto_resolve_markets() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_resolve_markets() FROM anon;
REVOKE ALL ON FUNCTION public.auto_resolve_markets() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.auto_resolve_markets() TO service_role;

-- ============================================================================
-- Idempotently unschedule existing cron jobs (use jobid)
-- ============================================================================
DO $$
DECLARE
  v_jobid int;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'market-close-expired-cron'
  LIMIT 1;

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'market-auto-resolve-cron'
  LIMIT 1;

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END$$;

-- ============================================================================
-- Schedule cron jobs (DB-native)
-- ============================================================================

-- Close expired markets every 5 minutes
SELECT cron.schedule(
  'market-close-expired-cron',
  '*/5 * * * *',
  $$ SELECT public.close_expired_markets(); $$
);

-- Auto-resolve markets every 10 minutes
SELECT cron.schedule(
  'market-auto-resolve-cron',
  '*/10 * * * *',
  $$ SELECT public.auto_resolve_markets(); $$
);