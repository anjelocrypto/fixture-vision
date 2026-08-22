-- Gate D RC2: isolated-database tests for the targeted settlement-hold
-- classifier (hold_unsafe_pending_legs_v2), its audit trail and ticket-history
-- RLS. Every assertion raises on failure.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.assert(p_cond boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'ok  - %', p_label;
END $$;

CREATE OR REPLACE FUNCTION public.set_ctx(p_role text, p_uid uuid)
RETURNS void LANGUAGE sql AS $$ UPDATE public._test_ctx SET role = p_role, uid = p_uid $$;

-- Production-identical RLS on the ticket-history surface -------------------
ALTER TABLE public.generated_tickets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_outcomes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_leg_outcomes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_tickets    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_outcomes      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_leg_outcomes  FORCE ROW LEVEL SECURITY;

CREATE POLICY gt_owner_select ON public.generated_tickets
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY to_owner_select ON public.ticket_outcomes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY tlo_owner_select ON public.ticket_leg_outcomes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY tlo_service ON public.ticket_leg_outcomes
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.generated_tickets, public.ticket_outcomes, public.ticket_leg_outcomes
  TO authenticated;
GRANT ALL ON public.generated_tickets, public.ticket_outcomes, public.ticket_leg_outcomes
  TO service_role;

GRANT SELECT ON public._test_ctx TO anon, authenticated;

-- Fixtures / tickets --------------------------------------------------------
INSERT INTO public.fixtures (id, league_id, "timestamp", status, teams_home, teams_away) VALUES
  (2001, 51, extract(epoch FROM timestamptz '2026-04-14 18:45+00')::bigint, 'NS',
   '{"id":7612,"name":"AFC Totton"}', '{"id":8657,"name":"Bath City"}'),
  (2002, 51, extract(epoch FROM timestamptz '2026-02-10 19:45+00')::bigint, 'NS',
   '{"id":55,"name":"Slough Town"}', '{"id":66,"name":"Weston-super-Mare"}');

CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
INSERT INTO ids VALUES
  ('userA', gen_random_uuid()), ('userB', gen_random_uuid()),
  ('tA1', gen_random_uuid()), ('tA2', gen_random_uuid()), ('tB1', gen_random_uuid()),
  ('legA1', gen_random_uuid()), ('legA2', gen_random_uuid()),
  ('legWin', gen_random_uuid()), ('legOther', gen_random_uuid());
GRANT SELECT ON ids TO anon, authenticated;

INSERT INTO public.generated_tickets (id, user_id, total_odds, legs, ticket_mode)
SELECT (SELECT v FROM ids WHERE k='tA1'), (SELECT v FROM ids WHERE k='userA'), 34.65,
       '[{"fixtureId":2001,"homeTeam":"AFC Totton","awayTeam":"Bath City"}]'::jsonb, 'high_risk'
UNION ALL SELECT (SELECT v FROM ids WHERE k='tA2'), (SELECT v FROM ids WHERE k='userA'), 19.41,
       '[{"fixtureId":2001,"homeTeam":"AFC Totton","awayTeam":"Bath City"}]'::jsonb, 'balanced'
UNION ALL SELECT (SELECT v FROM ids WHERE k='tB1'), (SELECT v FROM ids WHERE k='userB'), 6.0,
       '[{"fixtureId":2001,"homeTeam":"AFC Totton","awayTeam":"Bath City"}]'::jsonb, 'balanced';

INSERT INTO public.ticket_outcomes (ticket_id, user_id, legs_total, legs_settled, ticket_status, total_odds)
SELECT (SELECT v FROM ids WHERE k='tA1'), (SELECT v FROM ids WHERE k='userA'), 9, 8, 'LOST', 34.65
UNION ALL SELECT (SELECT v FROM ids WHERE k='tA2'), (SELECT v FROM ids WHERE k='userA'), 7, 6, 'LOST', 19.41
UNION ALL SELECT (SELECT v FROM ids WHERE k='tB1'), (SELECT v FROM ids WHERE k='userB'), 4, 4, 'WON', 6.0;

INSERT INTO public.ticket_leg_outcomes
  (id, ticket_id, user_id, fixture_id, market, side, line, odds, kickoff_at, result_status, actual_value)
SELECT (SELECT v FROM ids WHERE k='legA1'), (SELECT v FROM ids WHERE k='tA1'),
       (SELECT v FROM ids WHERE k='userA'), 2001, 'goals','over',1.5,1.4,
       timestamptz '2026-02-10 19:45+00','PENDING',NULL::numeric
UNION ALL SELECT (SELECT v FROM ids WHERE k='legA2'), (SELECT v FROM ids WHERE k='tA2'),
       (SELECT v FROM ids WHERE k='userA'), 2001, 'goals','over',1.5,1.4,
       timestamptz '2026-02-10 19:45+00','PENDING',NULL::numeric
UNION ALL SELECT (SELECT v FROM ids WHERE k='legWin'), (SELECT v FROM ids WHERE k='tB1'),
       (SELECT v FROM ids WHERE k='userB'), 2001, 'goals','over',1.5,1.4,
       timestamptz '2026-02-10 19:45+00','WIN',3::numeric
UNION ALL SELECT (SELECT v FROM ids WHERE k='legOther'), (SELECT v FROM ids WHERE k='tB1'),
       (SELECT v FROM ids WHERE k='userB'), 2002, 'goals','over',2.5,1.9,
       timestamptz '2026-02-10 19:45+00','PENDING',NULL;

-- ===================== 1. Fail-closed input validation =====================
DO $$ BEGIN
  PERFORM * FROM public.hold_unsafe_pending_legs_v2(NULL, 2, true, NULL);
  RAISE EXCEPTION 'FAIL: null fixture accepted';
EXCEPTION WHEN sqlstate '22023' THEN RAISE NOTICE 'ok  - null fixture id fails closed'; END $$;

DO $$ BEGIN
  PERFORM * FROM public.hold_unsafe_pending_legs_v2(2001, 0, true, NULL);
  RAISE EXCEPTION 'FAIL: max_rows 0 accepted';
EXCEPTION WHEN sqlstate '22023' THEN RAISE NOTICE 'ok  - max_rows lower bound enforced'; END $$;

DO $$ BEGIN
  PERFORM * FROM public.hold_unsafe_pending_legs_v2(2001, 51, true, NULL);
  RAISE EXCEPTION 'FAIL: max_rows 51 accepted';
EXCEPTION WHEN sqlstate '22023' THEN RAISE NOTICE 'ok  - max_rows upper bound enforced'; END $$;

DO $$ BEGIN
  PERFORM * FROM public.hold_unsafe_pending_legs_v2(2001, 2, false, 'apply_settlement_holds');
  RAISE EXCEPTION 'FAIL: wrong confirmation accepted';
EXCEPTION WHEN sqlstate '22023' THEN RAISE NOTICE 'ok  - invalid confirmation fails closed'; END $$;

DO $$ BEGIN
  PERFORM * FROM public.hold_unsafe_pending_legs_v2(2001, 2, false, NULL);
  RAISE EXCEPTION 'FAIL: missing confirmation accepted';
EXCEPTION WHEN sqlstate '22023' THEN RAISE NOTICE 'ok  - missing confirmation fails closed'; END $$;

DO $$ BEGIN
  PERFORM * FROM public.hold_unsafe_pending_legs_v2(2001, 1, true, NULL);
  RAISE EXCEPTION 'FAIL: candidates exceeding max_rows accepted';
EXCEPTION WHEN sqlstate '22023' THEN RAISE NOTICE 'ok  - selected rows above max_rows abort'; END $$;

-- ===================== 2. Dry run ==========================================
CREATE TEMP TABLE dry AS SELECT * FROM public.hold_unsafe_pending_legs_v2(2001, 2, true, NULL);
SELECT public.assert((SELECT count(*) FROM dry) = 2, 'dry run returns exactly two candidates');
SELECT public.assert((SELECT bool_and(reason = 'kickoff_drift') FROM dry), 'dry run reason is kickoff_drift');
SELECT public.assert((SELECT bool_and(drift_seconds = 5439600) FROM dry), 'dry run drift is 5439600 seconds');
SELECT public.assert((SELECT bool_and(result_status = 'PENDING' AND applied = false) FROM dry),
  'dry run marks nothing as applied');
SELECT public.assert((SELECT bool_and(selected_count = 2 AND updated_count = 0) FROM dry),
  'dry run reports selected=2 updated=0');
SELECT public.assert((SELECT count(*) FROM public.ticket_leg_outcomes WHERE settlement_hold_reason IS NOT NULL) = 0,
  'dry run performs zero writes');
SELECT public.assert((SELECT count(*) FROM public.settlement_hold_audit) = 0, 'dry run writes no audit rows');
SELECT public.assert((SELECT count(*) FROM public.pipeline_alerts WHERE alert_type = 'settlement_hold') = 0,
  'dry run raises no alerts');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM dry WHERE fixture_id <> 2001),
  'dry run cannot escape the targeted fixture');
SELECT public.assert(NOT EXISTS (SELECT 1 FROM dry d JOIN ids i ON i.v = d.leg_id AND i.k IN ('legWin','legOther')),
  'dry run excludes settled legs and other fixtures');

-- ===================== 3. Mutation =========================================
CREATE TEMP TABLE applied1 AS
  SELECT * FROM public.hold_unsafe_pending_legs_v2(2001, 2, false, 'APPLY_SETTLEMENT_HOLDS');
SELECT public.assert((SELECT bool_and(updated_count = 2 AND selected_count = 2) FROM applied1),
  'mutation updates exactly two legs');
SELECT public.assert((SELECT count(*) FROM public.ticket_leg_outcomes
   WHERE settlement_hold_reason = 'kickoff_drift'
     AND settlement_held_at IS NOT NULL
     AND kickoff_drift_seconds = 5439600
     AND result_status = 'PENDING'
     AND score_attempts = 0) = 2,
  'held legs keep PENDING, zero attempts, populated hold fields');
SELECT public.assert((SELECT count(*) FROM public.settlement_hold_audit
   WHERE fixture_id = 2001 AND reason = 'kickoff_drift'
     AND policy_version = 'reschedule-integrity-v1' AND source = 'hold_unsafe_pending_legs_v2') = 2,
  'one durable audit record per changed leg');
SELECT public.assert((SELECT count(*) FROM public.pipeline_alerts WHERE alert_type = 'settlement_hold') = 1,
  'exactly one deduplicated fixture/reason alert');
SELECT public.assert((SELECT result_status = 'WIN' AND settlement_hold_reason IS NULL AND actual_value = 3
                      FROM public.ticket_leg_outcomes WHERE id = (SELECT v FROM ids WHERE k='legWin')),
  'settled WIN leg untouched');
SELECT public.assert((SELECT settlement_hold_reason IS NULL AND result_status = 'PENDING'
                      FROM public.ticket_leg_outcomes WHERE id = (SELECT v FROM ids WHERE k='legOther')),
  'unrelated fixture 2002 untouched');
SELECT public.assert((SELECT count(*) FROM public.ticket_outcomes
                      WHERE ticket_status = 'LOST' AND legs_settled IN (6,8)) = 2,
  'parent ticket outcomes unchanged');

-- ===================== 4. Idempotency / concurrency ========================
CREATE TEMP TABLE applied2 AS
  SELECT * FROM public.hold_unsafe_pending_legs_v2(2001, 2, false, 'APPLY_SETTLEMENT_HOLDS');
SELECT public.assert((SELECT count(*) FROM applied2) = 0, 'repeat mutation selects nothing (idempotent)');
SELECT public.assert((SELECT count(*) FROM public.settlement_hold_audit) = 2,
  'repeat mutation writes no extra audit rows');
SELECT public.assert((SELECT count(*) FROM public.ticket_leg_outcomes
                      WHERE settlement_hold_reason IS NOT NULL) = 2,
  'held-leg count stays at two');
SELECT public.assert((SELECT count(*) FROM public.pipeline_alerts WHERE alert_type = 'settlement_hold') = 1,
  'repeat mutation raises no additional alert');

-- claim_scorable_ticket_legs must skip held legs
SELECT public.assert(NOT EXISTS (
  SELECT 1 FROM public.claim_scorable_ticket_legs(50) c
  JOIN ids i ON i.v = c.leg_id AND i.k IN ('legA1','legA2')),
  'claim_scorable_ticket_legs excludes held legs');

-- ===================== 5. RLS / privilege ==================================
SELECT public.set_ctx('authenticated', (SELECT v FROM ids WHERE k='userA'));
SET ROLE authenticated;
SELECT public.assert((SELECT count(*) FROM public.generated_tickets) = 2, 'user A sees only own tickets');
SELECT public.assert((SELECT count(*) FROM public.ticket_leg_outcomes) = 2, 'user A sees only own legs');
SELECT public.assert((SELECT count(*) FROM public.ticket_outcomes) = 2, 'user A sees only own outcomes');
SELECT public.assert((SELECT count(*) FROM public.generated_tickets gt
                      WHERE gt.id = (SELECT v FROM ids WHERE k='tB1')) = 0,
  'guessed ticket id of user B returns nothing');
SELECT public.assert((SELECT count(*) FROM public.ticket_leg_outcomes tlo
                      JOIN public.generated_tickets gt ON gt.id = tlo.ticket_id
                      WHERE gt.user_id = (SELECT v FROM ids WHERE k='userB')) = 0,
  'nested relationship cannot reach user B history');

DO $$ BEGIN
  UPDATE public.ticket_leg_outcomes SET settlement_hold_reason = NULL, result_status = 'WIN';
  IF FOUND THEN RAISE EXCEPTION 'FAIL: authenticated user modified outcome/hold fields'; END IF;
  RAISE NOTICE 'ok  - authenticated user cannot modify outcome or hold fields';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  - authenticated user cannot modify outcome or hold fields (denied)';
END $$;

DO $$ BEGIN
  PERFORM * FROM public.hold_unsafe_pending_legs_v2(2001, 2, true, NULL);
  RAISE EXCEPTION 'FAIL: authenticated user executed the classifier';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  - authenticated user denied classifier execution';
END $$;
RESET ROLE;

SELECT public.set_ctx('anon', NULL);
SET ROLE anon;
SELECT public.assert((SELECT count(*) FROM public.generated_tickets) = 0, 'anon reads no ticket history');
SELECT public.assert((SELECT count(*) FROM public.ticket_leg_outcomes) = 0, 'anon reads no leg history');
DO $$ BEGIN
  PERFORM * FROM public.hold_unsafe_pending_legs_v2(2001, 2, true, NULL);
  RAISE EXCEPTION 'FAIL: anon executed the classifier';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  - anon denied classifier execution'; END $$;
RESET ROLE;
SELECT public.set_ctx('service_role', gen_random_uuid());

-- Legacy broad classifier must no longer exist
SELECT public.assert((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.proname = 'hold_unsafe_pending_legs') = 0,
  'legacy broad classifier is retired');

SELECT 'HOLD SAFETY V2 SUITE PASSED' AS result;
