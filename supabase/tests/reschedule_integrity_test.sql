-- Gate D reschedule-integrity behavioural tests (isolated database only).
-- Every assertion raises an exception on failure.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.assert(p_cond boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'ok  - %', p_label;
END $$;

-- ---------------------------------------------------------------- fixtures --
INSERT INTO public.fixtures (id, league_id, "timestamp", status, teams_home, teams_away)
VALUES
  (1001, 51, extract(epoch FROM timestamptz '2026-02-10 19:45+00')::bigint, 'NS',
   '{"id":7612,"name":"AFC Totton"}', '{"id":8657,"name":"Bath City"}'),
  (1002, 51, extract(epoch FROM timestamptz '2026-02-10 19:45+00')::bigint, 'NS',
   '{"id":11,"name":"Fenerbahçe"}', '{"id":22,"name":"Ferencvarosi TC"}'),
  (1003, 17, extract(epoch FROM timestamptz '2026-03-02 18:15+00')::bigint, 'NS',
   '{"id":33,"name":"Al-Ahli Jeddah"}', '{"id":44,"name":"Al-Duhail SC"}'),
  (1004, 51, extract(epoch FROM timestamptz '2026-02-10 19:45+00')::bigint, 'NS',
   '{"id":55,"name":"Slough Town"}', '{"id":66,"name":"Weston-super-Mare"}'),
  (1005, 17, extract(epoch FROM timestamptz '2026-03-02 18:15+00')::bigint, 'NS',
   '{"id":77,"name":"Team Alpha"}', '{"id":88,"name":"Team Beta"}');

-- T1: identical upsert creates no history row
UPDATE public.fixtures SET league_id = 51,
  "timestamp" = extract(epoch FROM timestamptz '2026-02-10 19:45+00')::bigint,
  status = 'NS',
  teams_home = '{"id":7612,"name":"AFC Totton"}',
  teams_away = '{"id":8657,"name":"Bath City"}'
WHERE id = 1001;
SELECT public.assert((SELECT count(*) FROM public.fixture_schedule_changes WHERE fixture_id = 1001) = 0,
  'T1 identical upsert creates no schedule-history row');
SELECT public.assert((SELECT original_kickoff_at IS NULL AND last_rescheduled_at IS NULL
                      FROM public.fixtures WHERE id = 1001),
  'T1 identical upsert leaves reschedule provenance NULL');

-- T2: kickoff change creates exactly one correct history row
UPDATE public.fixtures
SET "timestamp" = extract(epoch FROM timestamptz '2026-04-14 18:45+00')::bigint
WHERE id = 1001;
SELECT public.assert((SELECT count(*) FROM public.fixture_schedule_changes WHERE fixture_id = 1001) = 1,
  'T2 kickoff change creates exactly one history row');
SELECT public.assert((SELECT previous_kickoff_at = timestamptz '2026-02-10 19:45+00'
                        AND new_kickoff_at = timestamptz '2026-04-14 18:45+00'
                        AND previous_home_team_id = 7612 AND new_home_team_id = 7612
                        AND direction_swapped = false
                      FROM public.fixture_schedule_changes WHERE fixture_id = 1001),
  'T2 history row records the correct before/after values');
SELECT public.assert((SELECT original_kickoff_at = timestamptz '2026-02-10 19:45+00'
                        AND last_rescheduled_at IS NOT NULL
                      FROM public.fixtures WHERE id = 1001),
  'T2 first observed kickoff is captured as original_kickoff_at');

-- T2b: repeating the same value again adds nothing
UPDATE public.fixtures
SET "timestamp" = extract(epoch FROM timestamptz '2026-04-14 18:45+00')::bigint
WHERE id = 1001;
SELECT public.assert((SELECT count(*) FROM public.fixture_schedule_changes WHERE fixture_id = 1001) = 1,
  'T2b repeated identical kickoff writes no extra history row');

-- T2c: home/away swap is recorded and flagged
UPDATE public.fixtures
SET teams_home = '{"id":88,"name":"Team Beta"}',
    teams_away = '{"id":77,"name":"Team Alpha"}'
WHERE id = 1005;
SELECT public.assert((SELECT count(*) = 1 AND bool_and(direction_swapped)
                      FROM public.fixture_schedule_changes WHERE fixture_id = 1005),
  'T2c home/away swap creates one history row flagged as swapped');

-- ------------------------------------------------------------------- legs ---
INSERT INTO public.generated_tickets (id, user_id, legs) VALUES
  ('11111111-1111-1111-1111-111111111111', gen_random_uuid(),
   '[{"fixtureId":1001,"homeTeam":"AFC Totton","awayTeam":"Bath City","market":"goals"}]'),
  ('22222222-2222-2222-2222-222222222222', gen_random_uuid(),
   '[{"fixtureId":1002,"homeTeam":"Fenerbahce","awayTeam":"Ferencvarosi","market":"goals"}]'),
  ('33333333-3333-3333-3333-333333333333', gen_random_uuid(),
   '[{"fixtureId":1003,"homeTeam":"Al-Duhail SC","awayTeam":"Al-Ahli Jeddah","market":"goals"}]'),
  ('44444444-4444-4444-4444-444444444444', gen_random_uuid(),
   '[{"fixtureId":1004,"homeTeam":"Slough Town","awayTeam":"Weston super Mare","market":"goals"}]');

INSERT INTO public.ticket_outcomes (ticket_id, user_id, legs_total)
SELECT id, user_id, 1 FROM public.generated_tickets;

INSERT INTO public.fixture_results (fixture_id, status, goals_home, goals_away, kickoff_at)
VALUES (1001,'FT',2,1, timestamptz '2026-04-14 18:45+00'),
       (1002,'FT',1,1, timestamptz '2026-02-10 19:45+00'),
       (1003,'FT',3,0, timestamptz '2026-04-13 14:45+00'),
       (1004,'FT',2,2, timestamptz '2026-02-10 19:45+00');

-- 1001: >7d drift, matching identity      -> kickoff_drift hold
-- 1002: no drift, cosmetic name diff      -> eligible
-- 1003: inverted direction + big drift    -> team_direction_mismatch hold
-- 1004: 23h59m drift                      -> eligible
INSERT INTO public.ticket_leg_outcomes
  (id, ticket_id, user_id, fixture_id, league_id, market, side, line, kickoff_at, result_status)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   gen_random_uuid(),1001,51,'goals','over',1.5, timestamptz '2026-02-10 19:45+00','PENDING'),
  ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222',
   gen_random_uuid(),1002,3,'goals','over',1.5, timestamptz '2026-02-10 19:45+00','PENDING'),
  ('aaaaaaaa-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333',
   gen_random_uuid(),1003,17,'goals','over',1.5, timestamptz '2026-03-02 18:15+00','PENDING'),
  ('aaaaaaaa-0000-0000-0000-000000000004','44444444-4444-4444-4444-444444444444',
   gen_random_uuid(),1004,51,'goals','over',1.5, timestamptz '2026-02-10 19:45+00','PENDING');

-- fixture 1004 moved 23h59m only
UPDATE public.fixtures
SET "timestamp" = extract(epoch FROM (timestamptz '2026-02-10 19:45+00' + interval '23 hours 59 minutes'))::bigint
WHERE id = 1004;
-- fixture 1003 also moved far (direction already inverted above)
UPDATE public.fixtures
SET "timestamp" = extract(epoch FROM timestamptz '2026-04-13 14:45+00')::bigint
WHERE id = 1003;

-- T3: pure hold evaluation
SELECT public.assert(public.evaluate_leg_hold(
  timestamptz '2026-02-10 19:45+00', timestamptz '2026-02-11 19:44+00',
  7612, 8657, 7612, 8657, NULL, NULL, NULL, NULL) IS NULL,
  'T3 23h59m drift with matching identity stays eligible');

SELECT public.assert(public.evaluate_leg_hold(
  timestamptz '2026-02-10 19:45+00', timestamptz '2026-02-11 19:46+00',
  7612, 8657, 7612, 8657, NULL, NULL, NULL, NULL) = 'kickoff_drift',
  'T3 drift beyond 24h is held');

SELECT public.assert(public.evaluate_leg_hold(
  timestamptz '2026-02-10 19:45+00', timestamptz '2026-02-10 19:45+00',
  8657, 7612, 7612, 8657, NULL, NULL, NULL, NULL) = 'team_direction_mismatch',
  'T3 home/away inversion is held regardless of kickoff');

SELECT public.assert(public.evaluate_leg_hold(
  timestamptz '2026-02-10 19:45+00', timestamptz '2026-02-10 19:45+00',
  NULL, NULL, NULL, NULL, 'Fenerbahce', 'Ferencvarosi', 'Fenerbahçe', 'Ferencvarosi TC') IS NULL,
  'T3 cosmetic spelling/suffix differences do not cause a false hold');

-- T4: claim excludes held legs, keeps eligible ones, and never bumps attempts
--     on held legs.
CREATE TEMP TABLE claim1 AS SELECT * FROM public.claim_scorable_ticket_legs(50);

SELECT public.assert((SELECT count(*) FROM claim1) = 2, 'T4 exactly the two safe legs are claimable');
SELECT public.assert((SELECT bool_and(leg_id IN ('aaaaaaaa-0000-0000-0000-000000000002',
                                                 'aaaaaaaa-0000-0000-0000-000000000004')) FROM claim1),
  'T4 claimed legs are the eligible ones only');
SELECT public.assert((SELECT score_attempts = 0 FROM public.ticket_leg_outcomes
                      WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'T4 drift-held leg score_attempts untouched');
SELECT public.assert((SELECT score_attempts = 0 FROM public.ticket_leg_outcomes
                      WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  'T4 direction-held leg score_attempts untouched');
SELECT public.assert((SELECT count(*) = 2 FROM public.ticket_leg_outcomes
                      WHERE result_status = 'PENDING'
                        AND id IN ('aaaaaaaa-0000-0000-0000-000000000001',
                                   'aaaaaaaa-0000-0000-0000-000000000003')),
  'T4 held legs remain PENDING (no new status)');

-- T5: claims release cleanly and re-claim is idempotent for held legs
SELECT public.release_ticket_leg_score_claim(leg_id, claim_token) FROM claim1;
CREATE TEMP TABLE claim2 AS SELECT * FROM public.claim_scorable_ticket_legs(50);
SELECT public.assert((SELECT count(*) FROM claim2) = 2, 'T5 released legs are re-claimable');
SELECT public.assert((SELECT count(*) = 0 FROM public.ticket_leg_outcomes
                      WHERE id IN ('aaaaaaaa-0000-0000-0000-000000000001',
                                   'aaaaaaaa-0000-0000-0000-000000000003')
                        AND (score_claim_token IS NOT NULL OR score_attempts > 0)),
  'T5 repeated scorer runs never touch held legs');
SELECT public.release_ticket_leg_score_claim(leg_id, claim_token) FROM claim2;
SELECT public.assert((SELECT count(*) = 0 FROM public.ticket_leg_outcomes WHERE score_claim_token IS NOT NULL),
  'T5 scorer locks always release');

-- T6: ordinary FT scoring still works end to end for an eligible leg
CREATE TEMP TABLE claim3 AS SELECT * FROM public.claim_scorable_ticket_legs(1);
SELECT public.finalize_scored_ticket_leg(
  (SELECT leg_id FROM claim3), (SELECT claim_token FROM claim3), 'WIN', 2, 'test')
FROM claim3;
SELECT public.assert((SELECT count(*) = 1 FROM public.ticket_leg_outcomes
                      WHERE result_status = 'WIN' AND score_claim_token IS NULL),
  'T6 ordinary FT scoring still settles an eligible leg');

-- T7: kickoff_at and fixture_id are immutable
DO $$
BEGIN
  BEGIN
    UPDATE public.ticket_leg_outcomes SET kickoff_at = now()
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'FAIL: T7 kickoff_at was mutable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok  - T7 kickoff_at is immutable pick-time metadata';
END $$;

-- T8: hold classifier flags exactly the unsafe legs and dedupes alerts
CREATE TEMP TABLE hold1 AS SELECT * FROM public.hold_unsafe_pending_legs(100);
SELECT public.assert((SELECT held_legs = 2 AND held_fixtures = 2 FROM hold1),
  'T8 classifier holds exactly the two unsafe legs');
SELECT public.assert((SELECT settlement_hold_reason = 'kickoff_drift'
                        AND settlement_policy_version = 'reschedule-integrity-v1'
                        AND kickoff_drift_seconds > 86400
                      FROM public.ticket_leg_outcomes WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'T8 drift hold records reason, drift and policy version');
SELECT public.assert((SELECT settlement_hold_reason = 'team_direction_mismatch'
                      FROM public.ticket_leg_outcomes WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  'T8 inverted leg is held as team_direction_mismatch');
SELECT public.assert((SELECT count(*) = 2 FROM public.ticket_leg_outcomes
                      WHERE settlement_hold_reason IS NOT NULL AND result_status = 'PENDING'),
  'T8 held legs stay PENDING');
SELECT public.assert((SELECT count(*) = 2 FROM public.pipeline_alerts WHERE alert_type = 'settlement_hold'),
  'T8 one alert per fixture/reason');

SELECT * FROM public.hold_unsafe_pending_legs(100);
SELECT * FROM public.hold_unsafe_pending_legs(100);
SELECT public.assert((SELECT count(*) = 2 FROM public.pipeline_alerts WHERE alert_type = 'settlement_hold'),
  'T8 repeated classifier runs deduplicate alerts');

-- T9: held legs can never be claimed afterwards
CREATE TEMP TABLE claim4 AS SELECT * FROM public.claim_scorable_ticket_legs(1000);
SELECT public.assert((SELECT count(*) = 0 FROM claim4
                      WHERE leg_id IN ('aaaaaaaa-0000-0000-0000-000000000001',
                                       'aaaaaaaa-0000-0000-0000-000000000003')),
  'T9 claim batches cannot bypass holds');

-- T10: new tickets persist identity snapshots
SELECT public.persist_generated_ticket(
  '99999999-9999-9999-9999-999999999999'::uuid,
  jsonb_build_object('total_odds', 1.3, 'min_target', 1.2, 'max_target', 1.4,
    'legs', jsonb_build_array(jsonb_build_object('fixtureId',1002,'homeTeam','Fenerbahce',
      'awayTeam','Ferencvarosi','homeTeamId',11,'awayTeamId',22))),
  '[]'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'fixture_id',1002,'league_id',3,'market','goals','side','over','line',1.5,'odds',1.3,
    'selection_key','goals|over|1.5','selection','over 1.5','source','prematch',
    'kickoff_at','2026-02-10T19:45:00Z','home_team_id_snapshot',11,'away_team_id_snapshot',22)),
  jsonb_build_object('total_odds', 1.3)
) AS new_ticket_id \gset
SELECT public.assert((SELECT home_team_id_snapshot = 11 AND away_team_id_snapshot = 22
                        AND settlement_policy_version = 'reschedule-integrity-v1'
                        AND kickoff_at = timestamptz '2026-02-10 19:45+00'
                        AND league_id = 3 AND fixture_id = 1002
                      FROM public.ticket_leg_outcomes WHERE ticket_id = :'new_ticket_id'),
  'T10 new ticket legs persist fixture, league, kickoff, team IDs and policy version');

SELECT 'ALL RESCHEDULE-INTEGRITY TESTS PASSED' AS result;
