-- Gate D RC3.2: isolated-database tests for result-ingestion identity
-- semantics, safe JSON parsing and stale-statistics protection.
-- Every assertion raises on failure.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.assert(p_cond boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'ok  - %', p_label;
END $$;

UPDATE public._test_ctx SET role = 'service_role', uid = NULL;

-- ===========================================================================
-- 1. safe_jsonb_id
-- ===========================================================================
SELECT public.assert(public.safe_jsonb_id('123'::jsonb) = 123, 'safe_jsonb_id: json number');
SELECT public.assert(public.safe_jsonb_id('"123"'::jsonb) = 123, 'safe_jsonb_id: numeric string accepted');
SELECT public.assert(public.safe_jsonb_id('"  456 "'::jsonb) = 456, 'safe_jsonb_id: padded numeric string accepted');
SELECT public.assert(public.safe_jsonb_id(NULL::jsonb) IS NULL, 'safe_jsonb_id: absent is NULL');
SELECT public.assert(public.safe_jsonb_id('null'::jsonb) IS NULL, 'safe_jsonb_id: json null is NULL');
SELECT public.assert(public.safe_jsonb_id('"12a"'::jsonb) = -1, 'safe_jsonb_id: malformed string sentinel');
SELECT public.assert(public.safe_jsonb_id('""'::jsonb) = -1, 'safe_jsonb_id: empty string sentinel');
SELECT public.assert(public.safe_jsonb_id('0'::jsonb) = -1, 'safe_jsonb_id: zero is malformed');
SELECT public.assert(public.safe_jsonb_id('-5'::jsonb) = -1, 'safe_jsonb_id: negative is malformed');
SELECT public.assert(public.safe_jsonb_id('1.5'::jsonb) = -1, 'safe_jsonb_id: float is malformed');
SELECT public.assert(public.safe_jsonb_id('{"id":1}'::jsonb) = -1, 'safe_jsonb_id: object is malformed');

-- ===========================================================================
-- 2. safe_stat_smallint
-- ===========================================================================
SELECT public.assert(public.safe_stat_smallint('{"corners_home":7}'::jsonb,'corners_home') = 7, 'safe_stat: number');
SELECT public.assert(public.safe_stat_smallint('{"corners_home":"7"}'::jsonb,'corners_home') = 7, 'safe_stat: numeric string');
SELECT public.assert(public.safe_stat_smallint('{}'::jsonb,'corners_home') IS NULL, 'safe_stat: absent is NULL');
SELECT public.assert(public.safe_stat_smallint('{"corners_home":null}'::jsonb,'corners_home') IS NULL, 'safe_stat: json null is NULL');
SELECT public.assert(public.safe_stat_smallint('{"corners_home":""}'::jsonb,'corners_home') IS NULL, 'safe_stat: empty string is NULL');
DO $$
BEGIN
  PERFORM public.safe_stat_smallint('{"corners_home":"n/a"}'::jsonb,'corners_home');
  RAISE EXCEPTION 'FAIL: safe_stat accepted a malformed value';
EXCEPTION WHEN others THEN
  PERFORM public.assert(SQLERRM LIKE 'invalid_stat_value%', 'safe_stat: malformed value rejected');
END $$;

-- ===========================================================================
-- 3. evaluate_leg_hold_v3 identity semantics
-- ===========================================================================
SELECT public.assert(public.evaluate_leg_hold_v3(now(), now(), 10, 20, 10, 20, 'A','B','A','B') IS NULL,
  'v3: matching ids are safe');
SELECT public.assert(public.evaluate_leg_hold_v3(now(), now(), 10, 20, 20, 10, 'A','B','B','A') = 'team_direction_mismatch',
  'v3: inverted ids are a mismatch');
SELECT public.assert(public.evaluate_leg_hold_v3(now(), now(), -1, 20, 10, 20, 'A','B','A','B') = 'identity_unverifiable',
  'v3: malformed id fails closed, never name fallback');
SELECT public.assert(public.evaluate_leg_hold_v3(now(), now(), NULL, NULL, NULL, NULL, 'A','B','A','B') IS NULL,
  'v3: no id evidence falls back to names');
SELECT public.assert(public.evaluate_leg_hold_v3(now(), now(), NULL, NULL, NULL, NULL, 'A','B','B','A') = 'team_direction_mismatch',
  'v3: name inversion is a mismatch');
SELECT public.assert(public.evaluate_leg_hold_v3(now(), now(), 10, NULL, 10, NULL, 'A','B','A','B') IS NULL,
  'v3: partial id evidence verifies the remaining side by name');
SELECT public.assert(public.evaluate_leg_hold_v3(now(), now(), 10, 20, 10, NULL, 'A','B','A',NULL) = 'identity_unverifiable',
  'v3: partial id evidence with unusable name fails closed');
SELECT public.assert(public.evaluate_leg_hold_v3(now(), now(), 10, 20, 99, 20, 'A','B','A','B') = 'team_direction_mismatch',
  'v3: a single mismatching id fails closed');
SELECT public.assert(public.evaluate_leg_hold_v3(NULL, now(), 10, 20, 10, 20, 'A','B','A','B') = 'kickoff_unverifiable',
  'v3: missing kickoff is unverifiable');
SELECT public.assert(
  public.evaluate_leg_hold_v3(now(), now() + interval '48 hours', 10, 20, 10, 20, 'A','B','A','B') = 'kickoff_drift',
  'v3: >24h drift holds');

-- ===========================================================================
-- 4. ingest_fixture_result_tx — identity, stats provenance, safe parsing
-- ===========================================================================
INSERT INTO public.fixtures (id, league_id, "timestamp", status, date, teams_home, teams_away)
VALUES (9001, 39, EXTRACT(epoch FROM timestamptz '2026-03-01 15:00+00')::bigint, 'NS',
        timestamptz '2026-03-01 15:00+00',
        '{"id":10,"name":"Alpha FC"}'::jsonb, '{"id":20,"name":"Beta FC"}'::jsonb);

-- 4a. First ingestion writes goals and statistics.
SELECT public.ingest_fixture_result_tx(
  9001, 39, 'FT', timestamptz '2026-03-01 15:00+00', 10, 20, 'Alpha FC', 'Beta FC', 2, 1,
  '{"corners_home":7,"corners_away":3,"cards_home":2,"cards_away":1}'::jsonb);

SELECT public.assert(
  (SELECT goals_home = 2 AND goals_away = 1 AND corners_home = 7 AND cards_away = 1
     FROM public.fixture_results WHERE fixture_id = 9001),
  'ingest: first write stores goals and statistics');

-- 4b. Re-ingesting the same result without statistics preserves them
--     (same-result provenance).
SELECT public.ingest_fixture_result_tx(
  9001, 39, 'FT', timestamptz '2026-03-01 15:00+00', 10, 20, 'Alpha FC', 'Beta FC', 2, 1, '{}'::jsonb);
SELECT public.assert(
  (SELECT corners_home = 7 AND cards_home = 2 FROM public.fixture_results WHERE fixture_id = 9001),
  'ingest: identical result keeps existing statistics');

-- 4c. A score change drops the stale statistics.
SELECT public.ingest_fixture_result_tx(
  9001, 39, 'FT', timestamptz '2026-03-01 15:00+00', 10, 20, 'Alpha FC', 'Beta FC', 3, 1, '{}'::jsonb);
SELECT public.assert(
  (SELECT corners_home IS NULL AND corners_away IS NULL AND cards_home IS NULL AND cards_away IS NULL
     FROM public.fixture_results WHERE fixture_id = 9001),
  'ingest: score change clears stale statistics');

-- 4d. A league change is an identity change and clears statistics.
SELECT public.ingest_fixture_result_tx(
  9001, 39, 'FT', timestamptz '2026-03-01 15:00+00', 10, 20, 'Alpha FC', 'Beta FC', 3, 1,
  '{"corners_home":5,"corners_away":5}'::jsonb);
SELECT public.ingest_fixture_result_tx(
  9001, 45, 'FT', timestamptz '2026-03-01 15:00+00', 10, 20, 'Alpha FC', 'Beta FC', 3, 1, '{}'::jsonb);
SELECT public.assert(
  (SELECT corners_home IS NULL FROM public.fixture_results WHERE fixture_id = 9001),
  'ingest: league change clears statistics');
SELECT public.assert(
  (SELECT fr.league_id = 45 AND fx.league_id = 45
     FROM public.fixture_results fr JOIN public.fixtures fx ON fx.id = fr.fixture_id
    WHERE fr.fixture_id = 9001),
  'ingest: fixture and result league identity stay consistent');

-- 4e. A team identity change clears statistics and updates the fixture.
SELECT public.ingest_fixture_result_tx(
  9001, 45, 'FT', timestamptz '2026-03-01 15:00+00', 10, 20, 'Alpha FC', 'Beta FC', 3, 1,
  '{"corners_home":8,"corners_away":2}'::jsonb);
SELECT public.ingest_fixture_result_tx(
  9001, 45, 'FT', timestamptz '2026-03-01 15:00+00', 10, 21, 'Alpha FC', 'Gamma FC', 3, 1, '{}'::jsonb);
SELECT public.assert(
  (SELECT corners_home IS NULL AND corners_away IS NULL FROM public.fixture_results WHERE fixture_id = 9001),
  'ingest: team identity change clears statistics');
SELECT public.assert(
  (SELECT public.safe_jsonb_id(teams_away -> 'id') = 21 AND teams_away ->> 'name' = 'Gamma FC'
     FROM public.fixtures WHERE id = 9001),
  'ingest: fixture team identity is corrected in the same transaction');
SELECT public.assert(
  (SELECT count(*) > 0 FROM public.fixture_schedule_changes
    WHERE fixture_id = 9001 AND new_away_team_id = 21),
  'ingest: identity correction is audited');

-- 4f. Cosmetic naming differences are NOT an identity change, but a genuinely
--     different canonical name is.
SELECT public.ingest_fixture_result_tx(
  9001, 45, 'FT', timestamptz '2026-03-01 15:00+00', 10, 21, 'Alpha FC', 'Gamma FC', 3, 1,
  '{"corners_home":4,"corners_away":4}'::jsonb);
SELECT public.ingest_fixture_result_tx(
  9001, 45, 'FT', timestamptz '2026-03-01 15:00+00', 10, 21, 'Alpha Football Club', 'Gamma FC', 3, 1, '{}'::jsonb);
SELECT public.assert(
  (SELECT corners_home = 4 FROM public.fixture_results WHERE fixture_id = 9001),
  'ingest: cosmetic naming difference keeps statistics');
SELECT public.ingest_fixture_result_tx(
  9001, 45, 'FT', timestamptz '2026-03-01 15:00+00', 10, 21, 'Alpha United', 'Gamma FC', 3, 1, '{}'::jsonb);
SELECT public.assert(
  (SELECT corners_home IS NULL FROM public.fixture_results WHERE fixture_id = 9001),
  'ingest: canonical team-name change clears statistics');

-- 4g. A kickoff change clears statistics and is audited.
SELECT public.ingest_fixture_result_tx(
  9001, 45, 'FT', timestamptz '2026-03-01 15:00+00', 10, 21, 'Alpha United', 'Gamma FC', 3, 1,
  '{"corners_home":6,"corners_away":6}'::jsonb);
SELECT public.ingest_fixture_result_tx(
  9001, 45, 'FT', timestamptz '2026-03-08 15:00+00', 10, 21, 'Alpha United', 'Gamma FC', 3, 1, '{}'::jsonb);
SELECT public.assert(
  (SELECT corners_home IS NULL FROM public.fixture_results WHERE fixture_id = 9001),
  'ingest: kickoff change clears statistics');
SELECT public.assert(
  (SELECT kickoff_at = timestamptz '2026-03-08 15:00+00' FROM public.fixture_results WHERE fixture_id = 9001),
  'ingest: provider kickoff is authoritative');

-- 4h. Malformed statistics abort the whole transaction (no partial write).
DO $$
DECLARE v_before smallint;
BEGIN
  SELECT goals_home INTO v_before FROM public.fixture_results WHERE fixture_id = 9001;
  BEGIN
    PERFORM public.ingest_fixture_result_tx(
      9001, 45, 'FT', timestamptz '2026-03-08 15:00+00', 10, 21, 'Alpha United', 'Gamma FC', 9, 9,
      '{"corners_home":"n/a"}'::jsonb);
    RAISE EXCEPTION 'FAIL: malformed statistics were accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE 'invalid_stat_value%' THEN RAISE; END IF;
  END;
  PERFORM public.assert(
    (SELECT goals_home FROM public.fixture_results WHERE fixture_id = 9001) = v_before,
    'ingest: malformed statistics write nothing at all');
END $$;

-- 4i. Invalid identity payloads are rejected outright.
DO $$
BEGIN
  BEGIN
    PERFORM public.ingest_fixture_result_tx(
      9001, 0, 'FT', timestamptz '2026-03-08 15:00+00', 10, 21, 'A', 'B', 1, 0, '{}'::jsonb);
    RAISE EXCEPTION 'FAIL: zero league id accepted';
  EXCEPTION WHEN others THEN
    PERFORM public.assert(SQLERRM = 'invalid_league_id', 'ingest: zero league id rejected');
  END;
  BEGIN
    PERFORM public.ingest_fixture_result_tx(
      9001, 45, 'FT', timestamptz '2026-03-08 15:00+00', 10, 10, 'A', 'B', 1, 0, '{}'::jsonb);
    RAISE EXCEPTION 'FAIL: identical team ids accepted';
  EXCEPTION WHEN others THEN
    PERFORM public.assert(SQLERRM = 'invalid_team_ids', 'ingest: identical team ids rejected');
  END;
  BEGIN
    PERFORM public.ingest_fixture_result_tx(
      9002, 45, 'FT', timestamptz '2026-03-08 15:00+00', 10, 21, 'A', 'B', 1, 0, '{}'::jsonb);
    RAISE EXCEPTION 'FAIL: unknown fixture accepted';
  EXCEPTION WHEN others THEN
    PERFORM public.assert(SQLERRM = 'unknown_local_fixture', 'ingest: unknown local fixture rejected');
  END;
END $$;

-- 4j. Non-service callers can never ingest.
UPDATE public._test_ctx SET role = 'authenticated';
DO $$
BEGIN
  BEGIN
    PERFORM public.ingest_fixture_result_tx(
      9001, 45, 'FT', timestamptz '2026-03-08 15:00+00', 10, 21, 'A', 'B', 1, 0, '{}'::jsonb);
    RAISE EXCEPTION 'FAIL: authenticated caller ingested a result';
  EXCEPTION WHEN others THEN
    PERFORM public.assert(SQLERRM = 'service role required', 'ingest: non-service caller denied');
  END;
END $$;
UPDATE public._test_ctx SET role = 'service_role';

-- 4k. A fixture whose stored team id is malformed does not break ingestion,
--     and the corrected identity is written.
INSERT INTO public.fixtures (id, league_id, "timestamp", status, date, teams_home, teams_away)
VALUES (9003, 39, EXTRACT(epoch FROM timestamptz '2026-03-01 15:00+00')::bigint, 'NS',
        timestamptz '2026-03-01 15:00+00',
        '{"id":"bad","name":"Delta"}'::jsonb, '{"id":"31","name":"Epsilon"}'::jsonb);
SELECT public.ingest_fixture_result_tx(
  9003, 39, 'FT', timestamptz '2026-03-01 15:00+00', 30, 31, 'Delta', 'Epsilon', 1, 0, '{}'::jsonb);
SELECT public.assert(
  (SELECT public.safe_jsonb_id(teams_home -> 'id') = 30 FROM public.fixtures WHERE id = 9003),
  'ingest: malformed stored team id is replaced with the provider identity');
SELECT public.assert(
  (SELECT count(*) = 1 FROM public.fixture_results WHERE fixture_id = 9003),
  'ingest: fixture and result remain consistent after an identity repair');

SELECT 'ingestion identity RC3.2 suite passed' AS result;
