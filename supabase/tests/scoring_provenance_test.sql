-- ===========================================================================
-- RC3.4 (B) — statistics provenance is enforced in claim AND finalization.
-- Covers: matching provenance, missing provenance, mismatching provenance,
-- an identity change AFTER claiming, the exact Alpha/Beta -> Gamma regression,
-- and unaffected goals-only scoring.
-- Every assertion raises on failure.
-- ===========================================================================
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

-- Shared helper: build a fixture, a ticket, its outcome row and one leg. -----
CREATE OR REPLACE FUNCTION public.t_seed_leg(
  p_fixture_id bigint,
  p_home_id bigint, p_home_name text,
  p_away_id bigint, p_away_name text,
  p_kickoff timestamptz,
  p_market text, p_line numeric,
  p_leg_home_id bigint, p_leg_away_id bigint
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_ticket uuid := gen_random_uuid();
  v_leg uuid := gen_random_uuid();
  v_user uuid := '00000000-0000-0000-0000-0000000000b1';
BEGIN
  INSERT INTO public.fixtures (id, league_id, "timestamp", status, date, teams_home, teams_away)
  VALUES (p_fixture_id, 39, EXTRACT(epoch FROM p_kickoff)::bigint, 'NS', p_kickoff,
          jsonb_build_object('id', p_home_id, 'name', p_home_name),
          jsonb_build_object('id', p_away_id, 'name', p_away_name))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.generated_tickets (id, user_id, legs, total_odds, created_at)
  VALUES (v_ticket, v_user, '[]'::jsonb, 1.9, now());

  INSERT INTO public.ticket_outcomes (ticket_id, user_id, legs_total, ticket_status, total_odds)
  VALUES (v_ticket, v_user, 1, 'PENDING', 1.9);

  INSERT INTO public.ticket_leg_outcomes (
    id, ticket_id, user_id, fixture_id, league_id, market, side, line, odds,
    selection_key, selection, source, picked_at, kickoff_at, result_status,
    home_team_id_snapshot, away_team_id_snapshot)
  VALUES (v_leg, v_ticket, v_user, p_fixture_id, 39, p_market, 'over', p_line, 1.9,
          p_market || '_over', 'Over', 'test', now() - interval '5 days', p_kickoff, 'PENDING',
          p_leg_home_id, p_leg_away_id);

  RETURN v_leg;
END $$;

-- ===========================================================================
-- 1. Matching provenance settles a statistics market
-- ===========================================================================
DO $$
DECLARE
  v_leg uuid;
  v_kick timestamptz := now() - interval '3 days';
  v_token uuid;
  v_fp text;
  v_res jsonb;
BEGIN
  v_leg := public.t_seed_leg(9201, 10, 'Alpha FC', 20, 'Beta FC', v_kick, 'corners', 9.5, 10, 20);
  PERFORM public.ingest_fixture_result_tx(
    9201, 39, 'FT', v_kick, 10, 20, 'Alpha FC', 'Beta FC', 2, 1,
    '{"corners_home":8,"corners_away":3}'::jsonb);

  PERFORM public.assert(public.result_stats_provenance(9201) = 'verified',
    'provenance: freshly ingested statistics are verified');

  SELECT c.claim_token, c.result_fingerprint INTO v_token, v_fp
  FROM public.claim_scorable_ticket_legs(10) c WHERE c.leg_id = v_leg;
  PERFORM public.assert(v_token IS NOT NULL, 'claim: verified statistics leg is claimable');

  v_res := public.finalize_scored_ticket_leg(v_leg, v_token, 'WIN', 11, 'test', v_fp);
  PERFORM public.assert((v_res->>'settled')::boolean,
    'finalize: verified statistics leg settles');
  PERFORM public.assert(
    (SELECT result_status = 'WIN' FROM public.ticket_leg_outcomes WHERE id = v_leg),
    'finalize: settled leg is WIN');
END $$;

-- ===========================================================================
-- 2. EXACT REGRESSION — Alpha/Beta statistics, fixture becomes Gamma:
--    a Gamma selection must NEVER settle from Beta's corners.
-- ===========================================================================
DO $$
DECLARE
  v_leg uuid;
  v_kick timestamptz := now() - interval '3 days';
  v_token uuid;
  v_fp text;
  v_res jsonb;
  v_claims integer;
BEGIN
  -- Alpha vs Beta ingested WITH statistics.
  INSERT INTO public.fixtures (id, league_id, "timestamp", status, date, teams_home, teams_away)
  VALUES (9202, 39, EXTRACT(epoch FROM v_kick)::bigint, 'NS', v_kick,
          '{"id":10,"name":"Alpha FC"}'::jsonb, '{"id":20,"name":"Beta FC"}'::jsonb);
  PERFORM public.ingest_fixture_result_tx(
    9202, 39, 'FT', v_kick, 10, 20, 'Alpha FC', 'Beta FC', 2, 1,
    '{"corners_home":8,"corners_away":3}'::jsonb);

  -- An INDEPENDENT fixture refresh replaces Beta with Gamma. The stored
  -- corners still belong to Alpha vs Beta.
  UPDATE public.fixtures SET teams_away = '{"id":21,"name":"Gamma FC"}'::jsonb WHERE id = 9202;

  PERFORM public.assert(public.result_stats_provenance(9202) = 'mismatch',
    'regression: statistics no longer match the current fixture identity');
  PERFORM public.assert(
    (SELECT corners_home = 8 FROM public.fixture_results WHERE fixture_id = 9202),
    'regression: the original stored values are preserved, not rewritten');

  -- A selection made against the CURRENT (Gamma) identity: no hold reason
  -- applies, so only provenance can protect it.
  v_leg := gen_random_uuid();
  INSERT INTO public.generated_tickets (id, user_id, legs, total_odds, created_at)
  VALUES ('00000000-0000-0000-0000-000000009202', '00000000-0000-0000-0000-0000000000b1',
          '[]'::jsonb, 1.9, now());
  INSERT INTO public.ticket_outcomes (ticket_id, user_id, legs_total, ticket_status, total_odds)
  VALUES ('00000000-0000-0000-0000-000000009202', '00000000-0000-0000-0000-0000000000b1', 1, 'PENDING', 1.9);
  INSERT INTO public.ticket_leg_outcomes (
    id, ticket_id, user_id, fixture_id, league_id, market, side, line, odds,
    selection_key, selection, source, picked_at, kickoff_at, result_status,
    home_team_id_snapshot, away_team_id_snapshot)
  VALUES (v_leg, '00000000-0000-0000-0000-000000009202', '00000000-0000-0000-0000-0000000000b1',
          9202, 39, 'corners', 'over', 9.5, 1.9, 'corners_over', 'Over 9.5', 'test',
          now() - interval '5 days', v_kick, 'PENDING', 10, 21);

  PERFORM public.assert(
    (SELECT hold_reason IS NULL FROM public.v_leg_settlement_evidence WHERE leg_id = v_leg),
    'regression: the Gamma selection matches the current identity (no hold reason)');

  SELECT count(*) INTO v_claims
  FROM public.claim_scorable_ticket_legs(10) c WHERE c.leg_id = v_leg;
  PERFORM public.assert(v_claims = 0, 'regression: the Gamma selection is never claimed');

  -- Even a forced claim cannot settle it.
  v_token := gen_random_uuid();
  UPDATE public.ticket_leg_outcomes
  SET score_claim_token = v_token, score_claimed_at = now() WHERE id = v_leg;
  SELECT result_fingerprint INTO v_fp FROM public.v_leg_settlement_evidence WHERE leg_id = v_leg;

  v_res := public.finalize_scored_ticket_leg(v_leg, v_token, 'WIN', 11, 'test', v_fp);
  PERFORM public.assert(v_res->>'outcome' = 'stats_provenance_unverified',
    'regression: finalization refuses the previous opponent''s corners');
  PERFORM public.assert(v_res->>'provenance' = 'mismatch', 'regression: refusal reports the mismatch');
  PERFORM public.assert(
    (SELECT result_status = 'PENDING' AND settled_at IS NULL AND actual_value IS NULL
       AND score_claim_token IS NULL
       FROM public.ticket_leg_outcomes WHERE id = v_leg),
    'regression: the leg stays PENDING and the claim is released');
END $$;

-- ===========================================================================
-- 3. Missing provenance (statistics present, no marker) never settles
-- ===========================================================================
DO $$
DECLARE
  v_leg uuid;
  v_kick timestamptz := now() - interval '3 days';
  v_token uuid;
  v_fp text;
  v_res jsonb;
  v_claims integer;
BEGIN
  v_leg := public.t_seed_leg(9203, 30, 'Delta FC', 40, 'Epsilon FC', v_kick, 'corners', 9.5, 30, 40);
  INSERT INTO public.fixture_results (fixture_id, league_id, kickoff_at, status,
                                      goals_home, goals_away, corners_home, corners_away,
                                      source, fetched_at)
  VALUES (9203, 39, v_kick, 'FT', 1, 0, 7, 5, 'legacy-import', now());

  PERFORM public.assert(public.result_stats_provenance(9203) = 'unverified',
    'missing provenance: legacy statistics are unverified');

  SELECT count(*) INTO v_claims
  FROM public.claim_scorable_ticket_legs(10) c WHERE c.leg_id = v_leg;
  PERFORM public.assert(v_claims = 0, 'missing provenance: never claimed');

  v_token := gen_random_uuid();
  UPDATE public.ticket_leg_outcomes SET score_claim_token = v_token, score_claimed_at = now()
  WHERE id = v_leg;
  SELECT result_fingerprint INTO v_fp FROM public.v_leg_settlement_evidence WHERE leg_id = v_leg;
  v_res := public.finalize_scored_ticket_leg(v_leg, v_token, 'WIN', 12, 'test', v_fp);
  PERFORM public.assert(v_res->>'outcome' = 'stats_provenance_unverified',
    'missing provenance: finalization refuses');
  PERFORM public.assert(
    (SELECT result_status = 'PENDING' FROM public.ticket_leg_outcomes WHERE id = v_leg),
    'missing provenance: leg stays PENDING');
END $$;

-- ===========================================================================
-- 4. An identity change AFTER claiming cannot bypass the guard
-- ===========================================================================
DO $$
DECLARE
  v_leg uuid;
  v_kick timestamptz := now() - interval '3 days';
  v_token uuid;
  v_fp text;
  v_res jsonb;
BEGIN
  v_leg := public.t_seed_leg(9204, 50, 'Zeta FC', 60, 'Eta FC', v_kick, 'cards', 3.5, 50, 60);
  PERFORM public.ingest_fixture_result_tx(
    9204, 39, 'FT', v_kick, 50, 60, 'Zeta FC', 'Eta FC', 1, 1,
    '{"cards_home":3,"cards_away":2}'::jsonb);

  SELECT c.claim_token, c.result_fingerprint INTO v_token, v_fp
  FROM public.claim_scorable_ticket_legs(10) c WHERE c.leg_id = v_leg;
  PERFORM public.assert(v_token IS NOT NULL, 'post-claim: leg was claimable while verified');

  -- The fixture identity changes after the claim; the selection is updated to
  -- the new identity, so nothing but provenance stands between the previous
  -- opponent's cards and a settlement.
  UPDATE public.fixtures SET teams_away = '{"id":61,"name":"Theta FC"}'::jsonb WHERE id = 9204;
  UPDATE public.ticket_leg_outcomes SET away_team_id_snapshot = 61 WHERE id = v_leg;

  v_res := public.finalize_scored_ticket_leg(v_leg, v_token, 'WIN', 5, 'test', v_fp);
  PERFORM public.assert(v_res->>'outcome' = 'stats_provenance_unverified',
    'post-claim: finalization re-checks provenance under the locks');
  PERFORM public.assert(
    (SELECT result_status = 'PENDING' AND settled_at IS NULL
       FROM public.ticket_leg_outcomes WHERE id = v_leg),
    'post-claim: the leg is not settled');
END $$;

-- ===========================================================================
-- 5. Goals-only scoring is unaffected by optional statistics
-- ===========================================================================
DO $$
DECLARE
  v_leg uuid;
  v_leg2 uuid;
  v_kick timestamptz := now() - interval '3 days';
  v_token uuid;
  v_fp text;
  v_res jsonb;
BEGIN
  -- 5a. No statistics at all.
  v_leg := public.t_seed_leg(9205, 70, 'Iota FC', 80, 'Kappa FC', v_kick, 'goals', 1.5, 70, 80);
  PERFORM public.ingest_fixture_result_tx(
    9205, 39, 'FT', v_kick, 70, 80, 'Iota FC', 'Kappa FC', 2, 1, '{}'::jsonb);
  SELECT c.claim_token, c.result_fingerprint INTO v_token, v_fp
  FROM public.claim_scorable_ticket_legs(10) c WHERE c.leg_id = v_leg;
  PERFORM public.assert(v_token IS NOT NULL, 'goals: claimable without any statistics');
  v_res := public.finalize_scored_ticket_leg(v_leg, v_token, 'WIN', 3, 'test', v_fp);
  PERFORM public.assert((v_res->>'settled')::boolean, 'goals: settles without statistics');

  -- 5b. Statistics present but with mismatching provenance: goals unaffected.
  v_leg2 := public.t_seed_leg(9206, 90, 'Lambda FC', 100, 'Mu FC', v_kick, 'goals', 2.5, 90, 100);
  PERFORM public.ingest_fixture_result_tx(
    9206, 39, 'FT', v_kick, 90, 100, 'Lambda FC', 'Mu FC', 3, 1,
    '{"corners_home":6,"corners_away":4}'::jsonb);
  UPDATE public.fixture_results SET stats_identity = 'stale-marker' WHERE fixture_id = 9206;
  PERFORM public.assert(public.result_stats_provenance(9206) = 'mismatch',
    'goals: fixture carries mismatching statistics provenance');
  SELECT c.claim_token, c.result_fingerprint INTO v_token, v_fp
  FROM public.claim_scorable_ticket_legs(10) c WHERE c.leg_id = v_leg2;
  PERFORM public.assert(v_token IS NOT NULL, 'goals: still claimable despite stale statistics');
  v_res := public.finalize_scored_ticket_leg(v_leg2, v_token, 'WIN', 4, 'test', v_fp);
  PERFORM public.assert((v_res->>'settled')::boolean,
    'goals: verified goals-only settlement is independent of optional statistics');
END $$;

-- ===========================================================================
-- 6. Read-only legacy inventory never mutates and never invents a marker
-- ===========================================================================
DO $$
DECLARE
  v_before text;
  v_after text;
  v_rows integer;
BEGIN
  SELECT md5(string_agg(COALESCE(stats_identity, '-') || ':' || fixture_id::text, '|' ORDER BY fixture_id))
  INTO v_before FROM public.fixture_results;

  SELECT count(*) INTO v_rows FROM public.legacy_stats_provenance_inventory();
  PERFORM public.assert(v_rows > 0, 'inventory: reports at least one class');
  PERFORM public.assert(
    (SELECT COALESCE(sum(fixture_rows), 0) FROM public.legacy_stats_provenance_inventory())
      = (SELECT count(*) FROM public.fixture_results),
    'inventory: every result row is classified exactly once');
  PERFORM public.assert(
    EXISTS (SELECT 1 FROM public.legacy_stats_provenance_inventory()
             WHERE provenance = 'unverified' AND has_statistics AND source = 'legacy-import'),
    'inventory: unverified legacy statistics are reported as such');

  SELECT md5(string_agg(COALESCE(stats_identity, '-') || ':' || fixture_id::text, '|' ORDER BY fixture_id))
  INTO v_after FROM public.fixture_results;
  PERFORM public.assert(v_before = v_after, 'inventory: read-only, no marker was manufactured');
END $$;

SELECT 'scoring provenance RC3.4 suite passed' AS result;
