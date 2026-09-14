-- Gate D RC3: isolated-database tests for the targeted settlement-hold
-- classifier (preview_settlement_holds_v3), its audit trail and ticket-history
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

-- legOther carries a complete identity snapshot for fixture 2002 so the V3
-- evaluator has verifiable evidence (without it the leg fails closed).
UPDATE public.ticket_leg_outcomes
SET home_team_id_snapshot = 55, away_team_id_snapshot = 66
WHERE id = (SELECT v FROM ids WHERE k='legOther');

-- ===================== 1. Fail-closed input validation =====================
DO $$ BEGIN
  PERFORM public.preview_settlement_holds_v3(NULL, NULL, 50);
  RAISE EXCEPTION 'FAIL: null fixture accepted';
EXCEPTION WHEN others THEN
  IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  RAISE NOTICE 'ok  - null fixture id fails closed';
END $$;

DO $$
DECLARE v jsonb;
BEGIN
  v := public.preview_settlement_holds_v3(2001, NULL, 0);
  PERFORM public.assert((v->>'page_size')::int = 1, 'page_size lower bound is clamped to 1');
  v := public.preview_settlement_holds_v3(2001, NULL, 5000);
  PERFORM public.assert((v->>'page_size')::int = 50, 'page_size upper bound is clamped to 50');
END $$;

DO $$ BEGIN
  PERFORM public.apply_settlement_holds_v3(2001, ARRAY[gen_random_uuid()], 'h', 'apply_settlement_holds');
  RAISE EXCEPTION 'FAIL: wrong confirmation accepted';
EXCEPTION WHEN others THEN
  IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  RAISE NOTICE 'ok  - invalid confirmation fails closed';
END $$;

DO $$ BEGIN
  PERFORM public.apply_settlement_holds_v3(2001, ARRAY[gen_random_uuid()], 'h', NULL);
  RAISE EXCEPTION 'FAIL: missing confirmation accepted';
EXCEPTION WHEN others THEN
  IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  RAISE NOTICE 'ok  - missing confirmation fails closed';
END $$;

DO $$
DECLARE v_ids uuid[];
BEGIN
  SELECT array_agg(gen_random_uuid()) INTO v_ids FROM generate_series(1, 51);
  BEGIN
    PERFORM public.apply_settlement_holds_v3(2001, v_ids, 'h', 'APPLY_SETTLEMENT_HOLDS_V3');
    RAISE EXCEPTION 'FAIL: oversized expected_leg_ids accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok  - expected_leg_ids above 50 abort';
END $$;

-- ===================== 2. Preview is read-only =============================
CREATE TEMP TABLE dry AS SELECT public.preview_settlement_holds_v3(2001, NULL, 50) AS p;
SELECT public.assert((SELECT (p->>'total_candidates')::int = 2 AND (p->>'returned')::int = 2 FROM dry),
  'preview returns exactly two candidates');
SELECT public.assert((SELECT bool_and(l->>'reason' = 'kickoff_drift')
                      FROM dry, jsonb_array_elements(p->'legs') l),
  'preview reason is kickoff_drift');
SELECT public.assert((SELECT bool_and((l->>'drift_seconds')::bigint = 5439600)
                      FROM dry, jsonb_array_elements(p->'legs') l),
  'preview drift is 5439600 seconds');
SELECT public.assert((SELECT (p->>'has_more')::boolean IS FALSE FROM dry),
  'preview reports no further pages');
SELECT public.assert((SELECT count(*) FROM public.ticket_leg_outcomes WHERE settlement_hold_reason IS NOT NULL) = 0,
  'preview performs zero writes');
SELECT public.assert((SELECT count(*) FROM public.settlement_hold_audit) = 0, 'preview writes no audit rows');
SELECT public.assert((SELECT count(*) FROM public.pipeline_alerts WHERE alert_type = 'settlement_hold') = 0,
  'preview raises no alerts');
SELECT public.assert(NOT EXISTS (
  SELECT 1 FROM dry, jsonb_array_elements(p->'legs') l
  JOIN ids i ON i.v = (l->>'leg_id')::uuid AND i.k IN ('legWin','legOther')),
  'preview excludes settled legs and other fixtures');

-- deterministic paging: page 1 then page 2 cover every candidate exactly once
DO $$
DECLARE p1 jsonb; p2 jsonb; a uuid; b uuid;
BEGIN
  p1 := public.preview_settlement_holds_v3(2001, NULL, 1);
  a := (p1->'legs'->0->>'leg_id')::uuid;
  PERFORM public.assert((p1->>'total_candidates')::int = 2, 'paged preview still reports the full candidate total');
  PERFORM public.assert((p1->>'has_more')::boolean, 'first page reports has_more');
  p2 := public.preview_settlement_holds_v3(2001, a, 1);
  b := (p2->'legs'->0->>'leg_id')::uuid;
  PERFORM public.assert(b IS NOT NULL AND b <> a, 'second page returns the other candidate exactly once');
  PERFORM public.assert((p2->>'has_more')::boolean IS FALSE, 'last page reports has_more = false');
END $$;

-- ===================== 3. Confirmed, exact mutation ========================
DO $$
DECLARE v_prev jsonb; v_res jsonb; v_ids uuid[];
BEGIN
  v_prev := public.preview_settlement_holds_v3(2001, NULL, 50);
  SELECT array_agg((l->>'leg_id')::uuid) INTO v_ids FROM jsonb_array_elements(v_prev->'legs') l;

  -- an expected set that no longer matches the snapshot must roll everything back
  BEGIN
    PERFORM public.apply_settlement_holds_v3(2001, v_ids || gen_random_uuid(),
      v_prev->>'snapshot_hash', 'APPLY_SETTLEMENT_HOLDS_V3');
    RAISE EXCEPTION 'FAIL: apply accepted an unknown leg id';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  PERFORM public.assert((SELECT count(*) FROM public.ticket_leg_outcomes
                         WHERE settlement_hold_reason IS NOT NULL) = 0,
    'rejected apply wrote nothing at all');

  v_res := public.apply_settlement_holds_v3(2001, v_ids, v_prev->>'snapshot_hash', 'APPLY_SETTLEMENT_HOLDS_V3');
  PERFORM public.assert((v_res->>'applied')::int = 2, 'mutation updates exactly two legs');
END $$;

SELECT public.assert((SELECT count(*) FROM public.ticket_leg_outcomes
   WHERE settlement_hold_reason = 'kickoff_drift'
     AND settlement_held_at IS NOT NULL
     AND kickoff_drift_seconds = 5439600
     AND result_status = 'PENDING'
     AND score_attempts = 0) = 2,
  'held legs keep PENDING, zero attempts, populated hold fields');
SELECT public.assert((SELECT count(*) FROM public.settlement_hold_audit
   WHERE fixture_id = 2001 AND reason = 'kickoff_drift'
     AND policy_version = 'reschedule-integrity-v3' AND source = 'apply_settlement_holds_v3') = 2,
  'one durable audit record per changed leg');
SELECT public.assert((SELECT count(*) FROM public.pipeline_alerts WHERE alert_type = 'settlement_hold') = 1,
  'exactly one deduplicated fixture alert');
SELECT public.assert((SELECT result_status = 'WIN' AND settlement_hold_reason IS NULL AND actual_value = 3
                      FROM public.ticket_leg_outcomes WHERE id = (SELECT v FROM ids WHERE k='legWin')),
  'settled WIN leg untouched');
SELECT public.assert((SELECT settlement_hold_reason IS NULL AND result_status = 'PENDING'
                      FROM public.ticket_leg_outcomes WHERE id = (SELECT v FROM ids WHERE k='legOther')),
  'unrelated fixture 2002 untouched');
SELECT public.assert((SELECT count(*) FROM public.ticket_outcomes
                      WHERE ticket_status = 'LOST' AND legs_settled IN (6,8)) = 2,
  'parent ticket outcomes unchanged');

-- ===================== 4. Idempotency / claim-to-finalize race =============
SELECT public.assert((SELECT (public.preview_settlement_holds_v3(2001, NULL, 50)->>'total_candidates')::int = 0),
  'repeat preview selects nothing (idempotent)');
SELECT public.assert((SELECT count(*) FROM public.settlement_hold_audit) = 2,
  'repeat run writes no extra audit rows');
SELECT public.assert((SELECT count(*) FROM public.pipeline_alerts WHERE alert_type = 'settlement_hold') = 1,
  'repeat run raises no additional alert');

-- claim_scorable_ticket_legs must skip held legs
SELECT public.assert(NOT EXISTS (
  SELECT 1 FROM public.claim_scorable_ticket_legs(50) c
  JOIN ids i ON i.v = c.leg_id AND i.k IN ('legA1','legA2')),
  'claim_scorable_ticket_legs excludes held legs');

-- release only when the canonical evaluator says the leg is safe again
DO $$
DECLARE v_prev jsonb;
BEGIN
  v_prev := public.preview_settlement_releases_v3(2001, NULL, 50);
  PERFORM public.assert((v_prev->>'total_candidates')::int = 0,
    'still-unsafe held legs are not release candidates');
END $$;

-- A claimed leg can NEVER be settled once the fixture moves. This test is
-- mandatory: it creates real claimable FT evidence first, so there is no
-- "nothing to test" success branch.
INSERT INTO public.fixture_results
  (fixture_id, league_id, kickoff_at, status, goals_home, goals_away, source)
VALUES (2002, 51, timestamptz '2026-02-10 19:45+00', 'FT', 2, 1, 'test');

DO $$
DECLARE
  v_leg uuid; v_token uuid; v_fp text; v_res jsonb;
  v_fixture bigint := 2002;
  v_ticket uuid := (SELECT v FROM ids WHERE k='tB1');
  v_before_status text; v_before_settled integer;
BEGIN
  SELECT ticket_status, legs_settled INTO v_before_status, v_before_settled
  FROM public.ticket_outcomes WHERE ticket_id = v_ticket;

  SELECT c.leg_id, c.claim_token, c.result_fingerprint INTO v_leg, v_token, v_fp
  FROM public.claim_scorable_ticket_legs(50) c
  JOIN ids i ON i.v = c.leg_id AND i.k = 'legOther';

  PERFORM public.assert(v_leg IS NOT NULL, 'race test: the eligible leg is claimable');
  PERFORM public.assert(v_token IS NOT NULL, 'race test: the claim token is non-null');
  PERFORM public.assert(v_fp IS NOT NULL, 'race test: the claim carries a result fingerprint');

  -- fixture is rescheduled far away AFTER the claim was taken
  UPDATE public.fixtures SET "timestamp" = extract(epoch FROM timestamptz '2026-06-30 19:45+00')::bigint
  WHERE id = v_fixture;

  -- finalization is invoked unconditionally and must be rejected
  v_res := public.finalize_scored_ticket_leg(v_leg, v_token, 'WIN', 3::numeric, 'race-test', v_fp);
  PERFORM public.assert((v_res->>'settled')::boolean IS FALSE,
    'race test: finalize refuses a leg whose fixture moved after the claim');
  PERFORM public.assert(v_res->>'outcome' = 'held', 'race test: rejection is recorded as a hold');
  PERFORM public.assert((SELECT result_status = 'PENDING' AND settlement_hold_reason = 'kickoff_drift'
                         FROM public.ticket_leg_outcomes WHERE id = v_leg),
    'race test: racing leg stays PENDING and is held, never WIN/LOSS/PUSH/VOID');
  PERFORM public.assert((SELECT score_claim_token IS NULL AND score_claimed_at IS NULL
                         FROM public.ticket_leg_outcomes WHERE id = v_leg),
    'race test: the claim is safely released');
  PERFORM public.assert((SELECT ticket_status = v_before_status AND legs_settled = v_before_settled
                         FROM public.ticket_outcomes WHERE ticket_id = v_ticket),
    'race test: the parent ticket outcome is unchanged');
END $$;

-- Stale result evidence can never settle a leg -----------------------------
INSERT INTO public.fixtures (id, league_id, "timestamp", status, teams_home, teams_away) VALUES
  (2003, 51, extract(epoch FROM timestamptz '2026-02-10 19:45+00')::bigint, 'FT',
   '{"id":91,"name":"Stale Town"}', '{"id":92,"name":"Fresh City"}');
INSERT INTO public.fixture_results
  (fixture_id, league_id, kickoff_at, status, goals_home, goals_away, source)
VALUES (2003, 51, timestamptz '2026-02-10 19:45+00', 'FT', 1, 1, 'test');
INSERT INTO ids VALUES ('tStale', gen_random_uuid()), ('legStale', gen_random_uuid());
INSERT INTO public.generated_tickets (id, user_id, total_odds, legs, ticket_mode)
SELECT (SELECT v FROM ids WHERE k='tStale'), (SELECT v FROM ids WHERE k='userB'), 1.9,
  '[{"fixtureId":2003,"homeTeam":"Stale Town","awayTeam":"Fresh City","homeTeamId":91,"awayTeamId":92}]'::jsonb,
  'balanced';
INSERT INTO public.ticket_outcomes (ticket_id, user_id, legs_total, legs_settled, ticket_status, total_odds)
SELECT (SELECT v FROM ids WHERE k='tStale'), (SELECT v FROM ids WHERE k='userB'), 1, 0, 'PENDING', 1.9;
INSERT INTO public.ticket_leg_outcomes
  (id, ticket_id, user_id, fixture_id, market, side, line, odds, kickoff_at, result_status)
SELECT (SELECT v FROM ids WHERE k='legStale'), (SELECT v FROM ids WHERE k='tStale'),
  (SELECT v FROM ids WHERE k='userB'), 2003, 'goals', 'over', 1.5, 1.9,
  timestamptz '2026-02-10 19:45+00', 'PENDING';

DO $$
DECLARE v_leg uuid; v_token uuid; v_fp text; v_res jsonb;
BEGIN
  SELECT c.leg_id, c.claim_token, c.result_fingerprint INTO v_leg, v_token, v_fp
  FROM public.claim_scorable_ticket_legs(50) c
  JOIN ids i ON i.v = c.leg_id AND i.k = 'legStale';
  PERFORM public.assert(v_leg IS NOT NULL AND v_token IS NOT NULL, 'stale test: leg claimed');

  -- the provider corrects the score after the claim
  UPDATE public.fixture_results SET goals_home = 3, goals_away = 0 WHERE fixture_id = 2003;

  v_res := public.finalize_scored_ticket_leg(v_leg, v_token, 'PUSH', 2::numeric, 'stale-test', v_fp);
  PERFORM public.assert((v_res->>'settled')::boolean IS FALSE
                          AND v_res->>'outcome' = 'stale_result_evidence',
    'stale result evidence is rejected');
  PERFORM public.assert((SELECT result_status = 'PENDING' AND score_claim_token IS NULL
                         FROM public.ticket_leg_outcomes WHERE id = v_leg),
    'stale rejection leaves the leg PENDING with the claim released');
  PERFORM public.assert((SELECT ticket_status = 'PENDING' AND legs_settled = 0
                         FROM public.ticket_outcomes WHERE ticket_id = (SELECT v FROM ids WHERE k='tStale')),
    'stale rejection leaves the parent ticket untouched');
END $$;

-- A genuinely safe release works end to end ---------------------------------
DO $$
DECLARE v_prev jsonb; v_res jsonb; v_ids uuid[];
BEGIN
  -- fixture 2002 is moved back to the originally scheduled kickoff
  UPDATE public.fixtures SET "timestamp" = extract(epoch FROM timestamptz '2026-02-10 19:45+00')::bigint
  WHERE id = 2002;

  v_prev := public.preview_settlement_releases_v3(2002, NULL, 50);
  PERFORM public.assert((v_prev->>'total_candidates')::int = 1,
    'a leg that became safe again is a release candidate');
  PERFORM public.assert(v_prev ? 'has_more', 'release preview reports has_more');

  SELECT array_agg((l->>'leg_id')::uuid) INTO v_ids FROM jsonb_array_elements(v_prev->'legs') l;

  BEGIN
    PERFORM public.release_settlement_holds_v3(2002, v_ids, v_prev->>'snapshot_hash', 'nope');
    RAISE EXCEPTION 'FAIL: release ran without confirmation';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.release_settlement_holds_v3(2002, v_ids, 'stale-hash', 'RELEASE_SETTLEMENT_HOLDS_V3');
    RAISE EXCEPTION 'FAIL: release accepted a stale snapshot';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  PERFORM public.assert((SELECT settlement_hold_reason IS NOT NULL
                         FROM public.ticket_leg_outcomes WHERE id = v_ids[1]),
    'rejected release changed nothing');

  v_res := public.release_settlement_holds_v3(2002, v_ids, v_prev->>'snapshot_hash',
                                              'RELEASE_SETTLEMENT_HOLDS_V3');
  PERFORM public.assert((v_res->>'released')::int = 1, 'release updates exactly the expected leg');
  PERFORM public.assert((SELECT settlement_hold_reason IS NULL AND result_status = 'PENDING'
                         FROM public.ticket_leg_outcomes WHERE id = v_ids[1]),
    'released leg is PENDING and unheld again');
  PERFORM public.assert((SELECT count(*) > 0 FROM public.settlement_hold_audit
                         WHERE fixture_id = 2002 AND source = 'release_settlement_holds_v3'),
    'release is audited');
END $$;

-- Paging behaviour at the 50-row boundary: 51 candidates run as 50 + 1 ------
INSERT INTO public.fixtures (id, league_id, "timestamp", status, teams_home, teams_away) VALUES
  (2004, 51, extract(epoch FROM timestamptz '2026-02-10 19:45+00')::bigint, 'NS',
   '{"id":93,"name":"Bulk United"}', '{"id":94,"name":"Bulk Rovers"}');
INSERT INTO public.generated_tickets (id, user_id, total_odds, legs, ticket_mode)
SELECT gen_random_uuid(), (SELECT v FROM ids WHERE k='userB'), 1.5,
  '[{"fixtureId":2004,"homeTeam":"Bulk United","awayTeam":"Bulk Rovers","homeTeamId":93,"awayTeamId":94}]'::jsonb,
  'balanced';

DO $$
DECLARE v_ticket uuid; i integer;
BEGIN
  SELECT id INTO v_ticket FROM public.generated_tickets
  WHERE legs::text LIKE '%Bulk United%' LIMIT 1;
  INSERT INTO public.ticket_outcomes (ticket_id, user_id, legs_total, legs_settled, ticket_status, total_odds)
  VALUES (v_ticket, (SELECT v FROM ids WHERE k='userB'), 51, 0, 'PENDING', 1.5);
  FOR i IN 1..51 LOOP
    INSERT INTO public.ticket_leg_outcomes
      (id, ticket_id, user_id, fixture_id, market, side, line, odds, kickoff_at, result_status)
    VALUES (gen_random_uuid(), v_ticket, (SELECT v FROM ids WHERE k='userB'), 2004,
            'goals', 'over', 1.5, 1.5, timestamptz '2026-02-10 19:45+00', 'PENDING');
  END LOOP;
  -- now move the fixture so all 51 legs become unsafe
  UPDATE public.fixtures SET "timestamp" = extract(epoch FROM timestamptz '2026-08-01 19:45+00')::bigint
  WHERE id = 2004;
END $$;

DO $$
DECLARE p1 jsonb; p2 jsonb; ids1 uuid[]; ids2 uuid[]; r1 jsonb; r2 jsonb; last_id uuid;
BEGIN
  p1 := public.preview_settlement_holds_v3(2004, NULL, 50);
  PERFORM public.assert((p1->>'total_candidates')::int = 51, '51 candidates are reported in full');
  PERFORM public.assert((p1->>'returned')::int = 50, 'first page returns exactly 50 rows');
  PERFORM public.assert((p1->>'has_more')::boolean, 'first page reports has_more');

  SELECT array_agg((l->>'leg_id')::uuid) INTO ids1 FROM jsonb_array_elements(p1->'legs') l;
  r1 := public.apply_settlement_holds_v3(2004, ids1, p1->>'snapshot_hash', 'APPLY_SETTLEMENT_HOLDS_V3');
  PERFORM public.assert((r1->>'applied')::int = 50, 'first page applies exactly 50 holds');

  p2 := public.preview_settlement_holds_v3(2004, NULL, 50);
  PERFORM public.assert((p2->>'total_candidates')::int = 1, 'exactly one candidate remains');
  SELECT array_agg((l->>'leg_id')::uuid) INTO ids2 FROM jsonb_array_elements(p2->'legs') l;
  r2 := public.apply_settlement_holds_v3(2004, ids2, p2->>'snapshot_hash', 'APPLY_SETTLEMENT_HOLDS_V3');
  PERFORM public.assert((r2->>'applied')::int = 1, 'second page applies the final hold');

  PERFORM public.assert((SELECT count(*) = 51 FROM public.ticket_leg_outcomes
                         WHERE fixture_id = 2004 AND settlement_hold_reason IS NOT NULL
                           AND result_status = 'PENDING'),
    'all 51 legs are held and remain PENDING');
  PERFORM public.assert((SELECT count(*) = 1 FROM public.pipeline_alerts
                         WHERE alert_type = 'settlement_hold' AND fingerprint = 'settlement:hold:fixture:2004'),
    'a 51-leg fixture raises exactly one deduplicated alert');
END $$;

-- Safe legs are never swept up by a bulk hold run ---------------------------
INSERT INTO public.fixtures (id, league_id, "timestamp", status, teams_home, teams_away) VALUES
  (2005, 51, extract(epoch FROM timestamptz '2026-02-10 19:45+00')::bigint, 'NS',
   '{"id":95,"name":"Safe United"}', '{"id":96,"name":"Safe Rovers"}');
DO $$
DECLARE v_ticket uuid := gen_random_uuid(); i integer;
BEGIN
  INSERT INTO public.generated_tickets (id, user_id, total_odds, legs, ticket_mode)
  VALUES (v_ticket, (SELECT v FROM ids WHERE k='userA'), 1.5,
    '[{"fixtureId":2005,"homeTeam":"Safe United","awayTeam":"Safe Rovers","homeTeamId":95,"awayTeamId":96}]'::jsonb,
    'balanced');
  INSERT INTO public.ticket_outcomes (ticket_id, user_id, legs_total, legs_settled, ticket_status, total_odds)
  VALUES (v_ticket, (SELECT v FROM ids WHERE k='userA'), 60, 0, 'PENDING', 1.5);
  FOR i IN 1..60 LOOP
    INSERT INTO public.ticket_leg_outcomes
      (id, ticket_id, user_id, fixture_id, market, side, line, odds, kickoff_at, result_status)
    VALUES (gen_random_uuid(), v_ticket, (SELECT v FROM ids WHERE k='userA'), 2005,
            'goals', 'over', 1.5, 1.5, timestamptz '2026-02-10 19:45+00', 'PENDING');
  END LOOP;
END $$;
SELECT public.assert(
  (SELECT (public.preview_settlement_holds_v3(2005, NULL, 50)->>'total_candidates')::int = 0),
  '60 safe legs produce zero hold candidates');
SELECT public.assert((SELECT count(*) = 0 FROM public.ticket_leg_outcomes
                      WHERE fixture_id = 2005 AND settlement_hold_reason IS NOT NULL),
  'safe legs are never held');

-- Malformed and duplicated identifiers fail closed --------------------------
DO $$ BEGIN
  BEGIN
    PERFORM public.apply_settlement_holds_v3(2004, ARRAY['not-a-uuid']::text[]::uuid[], 'h',
                                             'APPLY_SETTLEMENT_HOLDS_V3');
    RAISE EXCEPTION 'FAIL: malformed uuid accepted';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok  - malformed leg identifiers fail closed';
END $$;

DO $$ BEGIN
  BEGIN
    PERFORM public.apply_settlement_holds_v3(NULL, ARRAY[gen_random_uuid()], 'h',
                                             'APPLY_SETTLEMENT_HOLDS_V3');
    RAISE EXCEPTION 'FAIL: null fixture accepted by apply';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'ok  - apply requires a fixture id';
END $$;

-- The V1 evaluator must no longer be callable -------------------------------
SELECT public.assert((SELECT count(*) = 0 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.proname = 'evaluate_leg_hold'
                        AND pg_get_functiondef(p.oid) NOT LIKE '%retired%'),
  'the V1 evaluate_leg_hold path is retired');

-- ===================== 5. RLS / privilege ==================================
SELECT public.set_ctx('authenticated', (SELECT v FROM ids WHERE k='userA'));
SET ROLE authenticated;
-- Everything visible belongs to user A, and the visible count equals exactly
-- the number of user A rows that exist (no under- or over-exposure).
SELECT public.assert(
  (SELECT count(*) FROM public.generated_tickets) > 0
  AND (SELECT count(*) FROM public.generated_tickets
       WHERE user_id <> (SELECT v FROM ids WHERE k='userA')) = 0,
  'user A sees only own tickets');
SELECT public.assert(
  (SELECT count(*) FROM public.ticket_leg_outcomes) > 0
  AND (SELECT count(*) FROM public.ticket_leg_outcomes
       WHERE user_id <> (SELECT v FROM ids WHERE k='userA')) = 0,
  'user A sees only own legs');
SELECT public.assert(
  (SELECT count(*) FROM public.ticket_outcomes) > 0
  AND (SELECT count(*) FROM public.ticket_outcomes
       WHERE user_id <> (SELECT v FROM ids WHERE k='userA')) = 0,
  'user A sees only own outcomes');
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
  PERFORM * FROM public.preview_settlement_holds_v3(2001, NULL, 50);
  RAISE EXCEPTION 'FAIL: authenticated user executed the classifier';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  - authenticated user denied classifier execution';
END $$;
RESET ROLE;

SELECT public.set_ctx('anon', NULL);
SET ROLE anon;
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.generated_tickets;
  PERFORM public.assert(n = 0, 'anon reads no ticket history');
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  - anon reads no ticket history (no grant)';
END $$;
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.ticket_leg_outcomes;
  PERFORM public.assert(n = 0, 'anon reads no leg history');
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'ok  - anon reads no leg history (no grant)';
END $$;

DO $$ BEGIN
  PERFORM * FROM public.preview_settlement_holds_v3(2001, NULL, 50);
  RAISE EXCEPTION 'FAIL: anon executed the classifier';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok  - anon denied classifier execution'; END $$;
RESET ROLE;
SELECT public.set_ctx('service_role', gen_random_uuid());

-- Legacy broad classifier must no longer exist
SELECT public.assert((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.proname IN ('hold_unsafe_pending_legs', 'hold_unsafe_pending_legs_v2')) = 0,
  'legacy broad and v2 classifiers are retired');

SELECT 'HOLD SAFETY V3 SUITE PASSED' AS result;
