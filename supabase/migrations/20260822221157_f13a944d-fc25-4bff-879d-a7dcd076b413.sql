-- ============================================================
-- GATE D RESCHEDULE-INTEGRITY REMEDIATION (expand-only)
-- No data backfill, no classification of existing legs.
-- ============================================================

-- 1. Fixtures: nullable reschedule provenance ---------------------------------
ALTER TABLE public.fixtures
  ADD COLUMN IF NOT EXISTS original_kickoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_rescheduled_at timestamptz;

COMMENT ON COLUMN public.fixtures.original_kickoff_at IS
  'First kickoff observed by this system at the moment a change was first detected. NULL for fixtures that have never been observed changing; never backfilled.';

-- 2. Schedule change history --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fixture_schedule_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fixture_id bigint NOT NULL,
  previous_kickoff_at timestamptz,
  new_kickoff_at timestamptz,
  previous_status text,
  new_status text,
  previous_home_team_id bigint,
  new_home_team_id bigint,
  previous_away_team_id bigint,
  new_away_team_id bigint,
  kickoff_delta_seconds bigint,
  direction_swapped boolean NOT NULL DEFAULT false,
  detected_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'fixtures_trigger',
  CONSTRAINT fixture_schedule_changes_meaningful CHECK (
    previous_kickoff_at IS DISTINCT FROM new_kickoff_at
    OR previous_status IS DISTINCT FROM new_status
    OR previous_home_team_id IS DISTINCT FROM new_home_team_id
    OR previous_away_team_id IS DISTINCT FROM new_away_team_id
  )
);

CREATE INDEX IF NOT EXISTS idx_fsc_fixture ON public.fixture_schedule_changes (fixture_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fsc_detected ON public.fixture_schedule_changes (detected_at DESC);

GRANT SELECT ON public.fixture_schedule_changes TO authenticated;
GRANT ALL ON public.fixture_schedule_changes TO service_role;

ALTER TABLE public.fixture_schedule_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read fixture schedule changes" ON public.fixture_schedule_changes;
CREATE POLICY "Admins can read fixture schedule changes"
  ON public.fixture_schedule_changes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Service role can manage fixture schedule changes" ON public.fixture_schedule_changes;
CREATE POLICY "Service role can manage fixture schedule changes"
  ON public.fixture_schedule_changes FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 3. Trigger: record every real kickoff / status / direction change -----------
CREATE OR REPLACE FUNCTION public.fixtures_record_schedule_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_kick timestamptz := CASE WHEN OLD.timestamp IS NULL THEN NULL ELSE to_timestamp(OLD.timestamp) END;
  v_new_kick timestamptz := CASE WHEN NEW.timestamp IS NULL THEN NULL ELSE to_timestamp(NEW.timestamp) END;
  v_old_home bigint := NULLIF(OLD.teams_home->>'id','')::bigint;
  v_new_home bigint := NULLIF(NEW.teams_home->>'id','')::bigint;
  v_old_away bigint := NULLIF(OLD.teams_away->>'id','')::bigint;
  v_new_away bigint := NULLIF(NEW.teams_away->>'id','')::bigint;
  v_kick_changed boolean;
  v_dir_changed boolean;
  v_status_changed boolean;
BEGIN
  v_kick_changed := v_old_kick IS DISTINCT FROM v_new_kick;
  v_dir_changed := (v_old_home IS DISTINCT FROM v_new_home) OR (v_old_away IS DISTINCT FROM v_new_away);
  v_status_changed := OLD.status IS DISTINCT FROM NEW.status;

  -- Identical upserts produce no history row.
  IF NOT (v_kick_changed OR v_dir_changed OR v_status_changed) THEN
    RETURN NEW;
  END IF;

  -- Status-only transitions (NS -> FT) are normal lifecycle, not a reschedule:
  -- they are recorded for audit but do not touch reschedule provenance.
  IF v_kick_changed THEN
    IF NEW.original_kickoff_at IS NULL AND OLD.original_kickoff_at IS NULL THEN
      NEW.original_kickoff_at := v_old_kick;
    END IF;
    NEW.last_rescheduled_at := now();
  END IF;

  INSERT INTO public.fixture_schedule_changes (
    fixture_id, previous_kickoff_at, new_kickoff_at,
    previous_status, new_status,
    previous_home_team_id, new_home_team_id,
    previous_away_team_id, new_away_team_id,
    kickoff_delta_seconds, direction_swapped, source
  ) VALUES (
    NEW.id, v_old_kick, v_new_kick,
    OLD.status, NEW.status,
    v_old_home, v_new_home,
    v_old_away, v_new_away,
    CASE WHEN v_old_kick IS NULL OR v_new_kick IS NULL THEN NULL
         ELSE EXTRACT(epoch FROM (v_new_kick - v_old_kick))::bigint END,
    (v_old_home IS NOT NULL AND v_new_away IS NOT NULL AND v_old_home = v_new_away
      AND v_old_away IS NOT NULL AND v_new_home IS NOT NULL AND v_old_away = v_new_home),
    'fixtures_trigger'
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_fixtures_record_schedule_change ON public.fixtures;
CREATE TRIGGER trg_fixtures_record_schedule_change
  BEFORE UPDATE ON public.fixtures
  FOR EACH ROW EXECUTE FUNCTION public.fixtures_record_schedule_change();

-- 4. Ticket leg settlement-safety columns -------------------------------------
ALTER TABLE public.ticket_leg_outcomes
  ADD COLUMN IF NOT EXISTS kickoff_drift_seconds bigint,
  ADD COLUMN IF NOT EXISTS settlement_hold_reason text,
  ADD COLUMN IF NOT EXISTS settlement_held_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_policy_version text,
  ADD COLUMN IF NOT EXISTS home_team_id_snapshot bigint,
  ADD COLUMN IF NOT EXISTS away_team_id_snapshot bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tlo_settlement_hold_reason_chk'
  ) THEN
    ALTER TABLE public.ticket_leg_outcomes
      ADD CONSTRAINT tlo_settlement_hold_reason_chk
      CHECK (settlement_hold_reason IS NULL
             OR settlement_hold_reason IN ('kickoff_drift','team_direction_mismatch'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tlo_settlement_hold_pairing_chk'
  ) THEN
    ALTER TABLE public.ticket_leg_outcomes
      ADD CONSTRAINT tlo_settlement_hold_pairing_chk
      CHECK ((settlement_hold_reason IS NULL) = (settlement_held_at IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tlo_hold
  ON public.ticket_leg_outcomes (settlement_hold_reason)
  WHERE settlement_hold_reason IS NOT NULL;

COMMENT ON COLUMN public.ticket_leg_outcomes.kickoff_at IS
  'Immutable pick-time kickoff snapshot. Never rewritten when a fixture is rescheduled.';

-- 5. kickoff_at immutability --------------------------------------------------
CREATE OR REPLACE FUNCTION public.tlo_protect_pick_time_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.kickoff_at IS DISTINCT FROM OLD.kickoff_at THEN
    RAISE EXCEPTION 'ticket_leg_outcomes.kickoff_at is immutable pick-time metadata';
  END IF;
  IF NEW.fixture_id IS DISTINCT FROM OLD.fixture_id THEN
    RAISE EXCEPTION 'ticket_leg_outcomes.fixture_id is immutable';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_tlo_protect_pick_time_metadata ON public.ticket_leg_outcomes;
CREATE TRIGGER trg_tlo_protect_pick_time_metadata
  BEFORE UPDATE ON public.ticket_leg_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.tlo_protect_pick_time_metadata();

-- 6. Deterministic identity helpers -------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_team_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(
        lower(translate(
          COALESCE(p_name, ''),
          'àáâãäåāăąèéêëēĕėęěìíîïĩīĭįıòóôõöøōŏőùúûüũūŭůűųçćĉċčñńņňýÿŷšśşžźżđğłß',
          'aaaaaaaaaeeeeeeeeeiiiiiiiiiooooooooouuuuuuuuuucccccnnnnyyysssszzzdgls'
        )),
        '\y(fc|afc|sc|cf|ac|ss|ssc|cd|ud|sv|fk|nk|bk|if|tc|club|city|calcio|futbol|football)\y',
        ' ', 'g'
      ),
      '[^a-z0-9]', '', 'g'
    ), '');
$function$;

-- Returns NULL when the leg is safe to settle, otherwise the hold reason.
CREATE OR REPLACE FUNCTION public.evaluate_leg_hold(
  p_leg_kickoff timestamptz,
  p_fixture_kickoff timestamptz,
  p_leg_home_id bigint,
  p_leg_away_id bigint,
  p_fx_home_id bigint,
  p_fx_away_id bigint,
  p_leg_home_name text,
  p_leg_away_name text,
  p_fx_home_name text,
  p_fx_away_name text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_lh text; v_la text; v_fh text; v_fa text;
BEGIN
  -- Directional identity: prefer provider team IDs.
  IF p_leg_home_id IS NOT NULL AND p_leg_away_id IS NOT NULL
     AND p_fx_home_id IS NOT NULL AND p_fx_away_id IS NOT NULL THEN
    IF NOT (p_leg_home_id = p_fx_home_id AND p_leg_away_id = p_fx_away_id) THEN
      RETURN 'team_direction_mismatch';
    END IF;
  ELSE
    v_lh := public.normalize_team_name(p_leg_home_name);
    v_la := public.normalize_team_name(p_leg_away_name);
    v_fh := public.normalize_team_name(p_fx_home_name);
    v_fa := public.normalize_team_name(p_fx_away_name);
    IF v_lh IS NOT NULL AND v_la IS NOT NULL AND v_fh IS NOT NULL AND v_fa IS NOT NULL THEN
      IF NOT (v_lh = v_fh AND v_la = v_fa) THEN
        RETURN 'team_direction_mismatch';
      END IF;
    END IF;
    -- Neither IDs nor names available: identity cannot be disproved, fall through.
  END IF;

  IF p_leg_kickoff IS NOT NULL AND p_fixture_kickoff IS NOT NULL
     AND abs(EXTRACT(epoch FROM (p_fixture_kickoff - p_leg_kickoff))) > 86400 THEN
    RETURN 'kickoff_drift';
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.normalize_team_name(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.evaluate_leg_hold(timestamptz, timestamptz, bigint, bigint, bigint, bigint, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_team_name(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_leg_hold(timestamptz, timestamptz, bigint, bigint, bigint, bigint, text, text, text, text) TO service_role;

-- 7. Hold-aware claim ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_scorable_ticket_legs(batch_limit integer DEFAULT 500)
RETURNS TABLE(claim_token uuid, leg_id uuid, ticket_id uuid, user_id uuid, fixture_id bigint, market text, side text, line numeric, goals_home smallint, goals_away smallint, corners_home smallint, corners_away smallint, cards_home smallint, cards_away smallint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    JOIN public.fixtures fx
      ON fx.id = tlo.fixture_id
    LEFT JOIN LATERAL (
      SELECT l->>'homeTeam' AS home_name,
             l->>'awayTeam' AS away_name,
             CASE WHEN jsonb_typeof(l->'homeTeamId') = 'number' THEN (l->>'homeTeamId')::bigint END AS home_id,
             CASE WHEN jsonb_typeof(l->'awayTeamId') = 'number' THEN (l->>'awayTeamId')::bigint END AS away_id
      FROM public.generated_tickets gt
      CROSS JOIN LATERAL jsonb_array_elements(gt.legs) AS l
      WHERE gt.id = tlo.ticket_id
        AND jsonb_typeof(l->'fixtureId') = 'number'
        AND (l->>'fixtureId')::bigint = tlo.fixture_id
      LIMIT 1
    ) tj ON true
    WHERE tlo.result_status = 'PENDING'
      AND tlo.settlement_hold_reason IS NULL
      AND tlo.kickoff_at < now() - interval '2 hours'
      AND (tlo.score_claimed_at IS NULL OR tlo.score_claimed_at < now() - interval '10 minutes')
      AND lower(tlo.side) IN ('over', 'under')
      AND tlo.line IS NOT NULL
      AND public.evaluate_leg_hold(
            tlo.kickoff_at,
            CASE WHEN fx.timestamp IS NULL THEN NULL ELSE to_timestamp(fx.timestamp) END,
            COALESCE(tlo.home_team_id_snapshot, tj.home_id),
            COALESCE(tlo.away_team_id_snapshot, tj.away_id),
            NULLIF(fx.teams_home->>'id','')::bigint,
            NULLIF(fx.teams_away->>'id','')::bigint,
            tj.home_name,
            tj.away_name,
            fx.teams_home->>'name',
            fx.teams_away->>'name'
          ) IS NULL
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
$function$;

-- 8. Hold classifier (NOT executed by this migration) --------------------------
CREATE OR REPLACE FUNCTION public.hold_unsafe_pending_legs(p_batch_limit integer DEFAULT 200)
RETURNS TABLE(held_legs integer, held_fixtures integer, alerts_recorded integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_held integer := 0;
  v_fixtures integer := 0;
  v_alerts integer := 0;
  r record;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  CREATE TEMP TABLE _hold_batch ON COMMIT DROP AS
  SELECT tlo.id AS leg_id,
         tlo.fixture_id,
         CASE WHEN fx.timestamp IS NULL OR tlo.kickoff_at IS NULL THEN NULL
              ELSE EXTRACT(epoch FROM (to_timestamp(fx.timestamp) - tlo.kickoff_at))::bigint END AS drift,
         public.evaluate_leg_hold(
           tlo.kickoff_at,
           CASE WHEN fx.timestamp IS NULL THEN NULL ELSE to_timestamp(fx.timestamp) END,
           COALESCE(tlo.home_team_id_snapshot, tj.home_id),
           COALESCE(tlo.away_team_id_snapshot, tj.away_id),
           NULLIF(fx.teams_home->>'id','')::bigint,
           NULLIF(fx.teams_away->>'id','')::bigint,
           tj.home_name, tj.away_name,
           fx.teams_home->>'name', fx.teams_away->>'name'
         ) AS reason
  FROM public.ticket_leg_outcomes tlo
  JOIN public.fixtures fx ON fx.id = tlo.fixture_id
  LEFT JOIN LATERAL (
    SELECT l->>'homeTeam' AS home_name,
           l->>'awayTeam' AS away_name,
           CASE WHEN jsonb_typeof(l->'homeTeamId') = 'number' THEN (l->>'homeTeamId')::bigint END AS home_id,
           CASE WHEN jsonb_typeof(l->'awayTeamId') = 'number' THEN (l->>'awayTeamId')::bigint END AS away_id
    FROM public.generated_tickets gt
    CROSS JOIN LATERAL jsonb_array_elements(gt.legs) AS l
    WHERE gt.id = tlo.ticket_id
      AND jsonb_typeof(l->'fixtureId') = 'number'
      AND (l->>'fixtureId')::bigint = tlo.fixture_id
    LIMIT 1
  ) tj ON true
  WHERE tlo.result_status = 'PENDING'
    AND tlo.settlement_hold_reason IS NULL
  LIMIT GREATEST(COALESCE(p_batch_limit, 200), 1);

  DELETE FROM _hold_batch WHERE reason IS NULL;

  UPDATE public.ticket_leg_outcomes tlo
  SET settlement_hold_reason = b.reason,
      settlement_held_at = now(),
      settlement_policy_version = 'reschedule-integrity-v1',
      kickoff_drift_seconds = b.drift
  FROM _hold_batch b
  WHERE tlo.id = b.leg_id
    AND tlo.result_status = 'PENDING';
  GET DIAGNOSTICS v_held = ROW_COUNT;

  SELECT count(DISTINCT fixture_id) INTO v_fixtures FROM _hold_batch;

  FOR r IN SELECT DISTINCT fixture_id, reason FROM _hold_batch LOOP
    PERFORM public.record_pipeline_alert(
      'leg_hold:' || r.fixture_id || ':' || r.reason,
      'settlement_hold',
      'warning',
      format('Settlement held for fixture %s (%s)', r.fixture_id, r.reason),
      jsonb_build_object('fixture_id', r.fixture_id, 'reason', r.reason,
                         'policy_version', 'reschedule-integrity-v1')
    );
    v_alerts := v_alerts + 1;
  END LOOP;

  RETURN QUERY SELECT v_held, v_fixtures, v_alerts;
END;
$function$;

REVOKE ALL ON FUNCTION public.hold_unsafe_pending_legs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_unsafe_pending_legs(integer) TO service_role;
