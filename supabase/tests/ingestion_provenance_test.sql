-- RC3.3: statistics provenance across an intervening fixture update, the
-- single schedule-history recorder, and scoring protection during an
-- identity transition. Every assertion raises on failure.
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
-- 1. Statistics never survive an intervening fixture identity update
-- ===========================================================================
INSERT INTO public.fixtures (id, league_id, "timestamp", status, date, teams_home, teams_away)
VALUES (9101, 39, EXTRACT(epoch FROM timestamptz '2026-04-01 15:00+00')::bigint, 'NS',
        timestamptz '2026-04-01 15:00+00',
        '{"id":10,"name":"Alpha FC"}'::jsonb, '{"id":20,"name":"Beta FC"}'::jsonb);

-- 1a. Alpha vs Beta ingested with statistics.
SELECT public.ingest_fixture_result_tx(
  9101, 39, 'FT', timestamptz '2026-04-01 15:00+00', 10, 20, 'Alpha FC', 'Beta FC', 2, 1,
  '{"corners_home":7,"corners_away":3,"cards_home":2,"cards_away":1}'::jsonb);
SELECT public.assert(
  (SELECT corners_home = 7 AND stats_identity IS NOT NULL
     FROM public.fixture_results WHERE fixture_id = 9101),
  'provenance: statistics stored with an identity marker');

-- 1b. An INDEPENDENT fixture refresh replaces Beta with Gamma.
UPDATE public.fixtures
SET teams_away = '{"id":21,"name":"Gamma FC"}'::jsonb
WHERE id = 9101;

-- 1c. Goals-only ingestion for the new identity must NOT keep Beta's stats.
SELECT public.ingest_fixture_result_tx(
  9101, 39, 'FT', timestamptz '2026-04-01 15:00+00', 10, 21, 'Alpha FC', 'Gamma FC', 2, 1, '{}'::jsonb);
SELECT public.assert(
  (SELECT corners_home IS NULL AND corners_away IS NULL AND cards_home IS NULL AND cards_away IS NULL
          AND stats_identity IS NULL
     FROM public.fixture_results WHERE fixture_id = 9101),
  'provenance: intervening identity update invalidates the previous statistics');

-- 1d. Statistics for the new identity are stored and then preserved across an
--     identical repeat (verified same-result provenance).
SELECT public.ingest_fixture_result_tx(
  9101, 39, 'FT', timestamptz '2026-04-01 15:00+00', 10, 21, 'Alpha FC', 'Gamma FC', 2, 1,
  '{"corners_home":4,"corners_away":4}'::jsonb);
SELECT public.ingest_fixture_result_tx(
  9101, 39, 'FT', timestamptz '2026-04-01 15:00+00', 10, 21, 'Alpha FC', 'Gamma FC', 2, 1, '{}'::jsonb);
SELECT public.assert(
  (SELECT corners_home = 4 AND corners_away = 4 FROM public.fixture_results WHERE fixture_id = 9101),
  'provenance: identical verified identity keeps its own statistics');

-- ===========================================================================
-- 2. Exactly one schedule-history recorder
-- ===========================================================================
INSERT INTO public.fixtures (id, league_id, "timestamp", status, date, teams_home, teams_away)
VALUES (9102, 39, EXTRACT(epoch FROM timestamptz '2026-04-02 15:00+00')::bigint, 'NS',
        timestamptz '2026-04-02 15:00+00',
        '{"id":30,"name":"Delta FC"}'::jsonb, '{"id":40,"name":"Epsilon FC"}'::jsonb);

-- 2a. One meaningful transition (NS -> FT) produces exactly one event.
SELECT public.ingest_fixture_result_tx(
  9102, 39, 'FT', timestamptz '2026-04-02 15:00+00', 30, 40, 'Delta FC', 'Epsilon FC', 1, 0, '{}'::jsonb);
SELECT public.assert(
  (SELECT count(*) = 1 FROM public.fixture_schedule_changes WHERE fixture_id = 9102),
  'recorder: a meaningful transition is recorded exactly once');

-- 2b. An identical repeat records nothing at all.
SELECT public.ingest_fixture_result_tx(
  9102, 39, 'FT', timestamptz '2026-04-02 15:00+00', 30, 40, 'Delta FC', 'Epsilon FC', 1, 0, '{}'::jsonb);
SELECT public.assert(
  (SELECT count(*) = 1 FROM public.fixture_schedule_changes WHERE fixture_id = 9102),
  'recorder: an identical repeat records zero additional events');

-- 2c. A kickoff move is one further event, not two.
SELECT public.ingest_fixture_result_tx(
  9102, 39, 'FT', timestamptz '2026-04-09 15:00+00', 30, 40, 'Delta FC', 'Epsilon FC', 1, 0, '{}'::jsonb);
SELECT public.assert(
  (SELECT count(*) = 2 FROM public.fixture_schedule_changes WHERE fixture_id = 9102),
  'recorder: a kickoff move adds exactly one event');
SELECT public.assert(
  (SELECT count(DISTINCT source) = 1 FROM public.fixture_schedule_changes WHERE fixture_id = 9102),
  'recorder: only one recorder writes schedule history');

-- ===========================================================================
-- 3. Scoring is protected while identity changes
-- ===========================================================================
INSERT INTO public.fixtures (id, league_id, "timestamp", status, date, teams_home, teams_away)
VALUES (9103, 39, EXTRACT(epoch FROM timestamptz '2026-04-03 15:00+00')::bigint, 'NS',
        timestamptz '2026-04-03 15:00+00',
        '{"id":50,"name":"Zeta FC"}'::jsonb, '{"id":60,"name":"Eta FC"}'::jsonb);

INSERT INTO public.generated_tickets (id, user_id, legs, total_odds, created_at)
VALUES ('00000000-0000-0000-0000-000000009103', '00000000-0000-0000-0000-0000000000a1',
        '[]'::jsonb, 2.0, now());

INSERT INTO public.ticket_leg_outcomes (
  id, ticket_id, user_id, fixture_id, league_id, market, side, line, odds,
  selection_key, selection, source, picked_at, kickoff_at, result_status,
  home_team_id_snapshot, away_team_id_snapshot)
VALUES
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-000000009103',
   '00000000-0000-0000-0000-0000000000a1', 9103, 39, 'goals', 'over', 1.5, 1.4,
   'over_1_5', 'Over 1.5', 'test', now(), timestamptz '2026-04-03 15:00+00', 'PENDING', 50, 60),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-000000009103',
   '00000000-0000-0000-0000-0000000000a1', 9103, 39, 'goals', 'over', 2.5, 1.9,
   'over_2_5', 'Over 2.5', 'test', now(), timestamptz '2026-04-03 15:00+00', 'PENDING', 50, 60);

-- 3a. Ingesting a DIFFERENT away team holds the legs that no longer match.
SELECT public.ingest_fixture_result_tx(
  9103, 39, 'FT', timestamptz '2026-04-03 15:00+00', 50, 61, 'Zeta FC', 'Theta FC', 3, 0, '{}'::jsonb);
SELECT public.assert(
  (SELECT count(*) = 2 FROM public.ticket_leg_outcomes
    WHERE fixture_id = 9103 AND result_status = 'PENDING' AND settlement_hold_reason IS NOT NULL),
  'scoring guard: identity transition holds every unmatched pending leg');
SELECT public.assert(
  (SELECT count(*) = 2 FROM public.settlement_hold_audit WHERE fixture_id = 9103),
  'scoring guard: every hold is audited');
SELECT public.assert(
  (SELECT count(*) = 0 FROM public.ticket_leg_outcomes
    WHERE fixture_id = 9103 AND result_status <> 'PENDING'),
  'scoring guard: no leg is settled during an identity transition');

SELECT 'ingestion provenance RC3.3 suite passed' AS result;
