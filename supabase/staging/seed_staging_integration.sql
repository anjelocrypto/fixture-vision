-- ===========================================================================
-- TICKET AI — reproducible STAGING integration seed (RC3.4).
--
-- Run ONLY against the dedicated staging project. It refuses to run if the
-- database contains production-scale data.
--
-- Prerequisites, in this order:
--   1. Apply the reviewed CLEAN BASELINE (supabase/staging/README_BASELINE.md).
--      Never replay the historical migration directory — see
--      migration/DO_NOT_REPLAY_LEGACY.sql.
--   2. Deploy every edge function in supabase/functions to the same project.
--   3. Create the two synthetic auth users (email + password, confirmed):
--        staging-user-a@ticketai.test
--        staging-user-b@ticketai.test
--   4. Run this file with the service role. It is IDEMPOTENT: running it twice
--      must succeed and must leave exactly the same rows.
--
-- The synthetic ids below are also hard-coded in
-- src/test/rls-enforcement.test.ts — keep both in sync.
-- ===========================================================================
\set ON_ERROR_STOP on

DO $$
DECLARE v_fixtures bigint;
BEGIN
  SELECT count(*) INTO v_fixtures FROM public.fixtures;
  IF v_fixtures > 5000 THEN
    RAISE EXCEPTION 'refusing to seed: this looks like a production database (% fixtures)', v_fixtures;
  END IF;
END $$;

DO $$
DECLARE
  v_a uuid;
  v_b uuid;
  v_country_id integer;
  v_kickoff timestamptz := date_trunc('second', now() - interval '2 days');
BEGIN
  SELECT id INTO v_a FROM auth.users WHERE email = 'staging-user-a@ticketai.test';
  SELECT id INTO v_b FROM auth.users WHERE email = 'staging-user-b@ticketai.test';
  IF v_a IS NULL OR v_b IS NULL THEN
    RAISE EXCEPTION 'create the synthetic staging users first (see the header)';
  END IF;

  -- Reference data -----------------------------------------------------------
  -- countries.id is generated; resolve it instead of assuming a value.
  -- countries.code is UNIQUE: resolve by code, never by name.
  SELECT id INTO v_country_id FROM public.countries WHERE code = 'TL';
  IF v_country_id IS NULL THEN
    INSERT INTO public.countries (name, code, flag)
    VALUES ('Testland', 'TL', 'https://example.invalid/tl.svg')
    RETURNING id INTO v_country_id;
  END IF;

  -- leagues has country_id (integer), not a country text column.
  INSERT INTO public.leagues (id, name, country_id, season)
  VALUES (9900, 'Staging League', v_country_id, 2026)
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name, country_id = EXCLUDED.country_id, season = EXCLUDED.season;

  -- fixtures.date is DATE NOT NULL; teams are NOT NULL jsonb.
  INSERT INTO public.fixtures (id, league_id, "timestamp", status, date, teams_home, teams_away)
  VALUES (990001, 9900, EXTRACT(epoch FROM v_kickoff)::bigint, 'FT', v_kickoff::date,
          '{"id":9001,"name":"Staging Home"}'::jsonb,
          '{"id":9002,"name":"Staging Away"}'::jsonb)
  ON CONFLICT (id) DO UPDATE
    SET league_id = EXCLUDED.league_id, status = EXCLUDED.status;

  -- User A: one persisted ticket with two legs --------------------------------
  INSERT INTO public.generated_tickets
    (id, user_id, legs, total_odds, min_target, max_target, ticket_mode, created_at)
  VALUES ('11111111-1111-4111-8111-111111111111', v_a, '[]'::jsonb, 2.10, 2.00, 2.50, 'safe', now())
  ON CONFLICT (id) DO UPDATE
    SET user_id = EXCLUDED.user_id, total_odds = EXCLUDED.total_odds;

  INSERT INTO public.ticket_outcomes
    (ticket_id, user_id, legs_total, total_odds, ticket_status, ticket_mode)
  VALUES ('11111111-1111-4111-8111-111111111111', v_a, 2, 2.10, 'PENDING', 'safe')
  ON CONFLICT (ticket_id) DO UPDATE
    SET user_id = EXCLUDED.user_id, legs_total = EXCLUDED.legs_total;

  INSERT INTO public.ticket_leg_outcomes (
    id, ticket_id, user_id, fixture_id, league_id, market, side, line, odds,
    selection_key, selection, source, picked_at, kickoff_at, result_status)
  VALUES
    ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', v_a,
     990001, 9900, 'goals', 'over', 1.5, 1.40, 'over_1_5', 'Over 1.5', 'staging-seed',
     v_kickoff - interval '1 day', v_kickoff, 'PENDING'),
    ('33333333-3333-4333-8333-333333333334', '11111111-1111-4111-8111-111111111111', v_a,
     990001, 9900, 'goals', 'over', 2.5, 1.90, 'over_2_5', 'Over 2.5', 'staging-seed',
     v_kickoff - interval '1 day', v_kickoff, 'PENDING')
  ON CONFLICT (id) DO NOTHING;

  -- User B: one persisted ticket with one leg ---------------------------------
  INSERT INTO public.generated_tickets
    (id, user_id, legs, total_odds, min_target, max_target, ticket_mode, created_at)
  VALUES ('22222222-2222-4222-8222-222222222222', v_b, '[]'::jsonb, 1.75, 1.50, 2.00, 'safe', now())
  ON CONFLICT (id) DO UPDATE
    SET user_id = EXCLUDED.user_id, total_odds = EXCLUDED.total_odds;

  INSERT INTO public.ticket_outcomes
    (ticket_id, user_id, legs_total, total_odds, ticket_status, ticket_mode)
  VALUES ('22222222-2222-4222-8222-222222222222', v_b, 1, 1.75, 'PENDING', 'safe')
  ON CONFLICT (ticket_id) DO UPDATE
    SET user_id = EXCLUDED.user_id, legs_total = EXCLUDED.legs_total;

  INSERT INTO public.ticket_leg_outcomes (
    id, ticket_id, user_id, fixture_id, league_id, market, side, line, odds,
    selection_key, selection, source, picked_at, kickoff_at, result_status)
  VALUES
    ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', v_b,
     990001, 9900, 'goals', 'over', 1.5, 1.45, 'over_1_5', 'Over 1.5', 'staging-seed',
     v_kickoff - interval '1 day', v_kickoff, 'PENDING')
  ON CONFLICT (id) DO NOTHING;

  -- Synthetic prediction-market data (market endpoints and leaderboard tests) --
  INSERT INTO public.market_coins (user_id) VALUES (v_a)
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.market_coins (user_id) VALUES (v_b)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.prediction_markets
    (id, title, description, category, market_type, status, fixture_id, closes_at, odds_yes, odds_no)
  VALUES ('55555555-5555-4555-8555-555555555555',
          'Staging market: Over 1.5 goals',
          'Synthetic staging market. Never resolved by the suite.',
          'football', 'binary', 'open', 990001, now() + interval '7 days', 1.80, 2.00)
  ON CONFLICT (id) DO UPDATE
    SET status = EXCLUDED.status, closes_at = EXCLUDED.closes_at;
END $$;

SELECT 'staging integration seed applied' AS result;
