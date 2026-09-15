-- ===========================================================================
-- TICKET AI — reproducible STAGING integration seed.
--
-- Run ONLY against the dedicated staging project. It refuses to run if the
-- database contains production-scale data.
--
-- Prerequisites, in this order:
--   1. Apply the approved schema: every file in supabase/migrations, in
--      filename order (`supabase db push` against the staging project).
--   2. Deploy every edge function in supabase/functions to the same project.
--   3. Create the two synthetic auth users (email + password, confirmed):
--        staging-user-a@ticketai.test
--        staging-user-b@ticketai.test
--   4. Run this file with the service role.
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
BEGIN
  SELECT id INTO v_a FROM auth.users WHERE email = 'staging-user-a@ticketai.test';
  SELECT id INTO v_b FROM auth.users WHERE email = 'staging-user-b@ticketai.test';
  IF v_a IS NULL OR v_b IS NULL THEN
    RAISE EXCEPTION 'create the synthetic staging users first (see the header)';
  END IF;

  -- Reference data -----------------------------------------------------------
  INSERT INTO public.countries (name, code)
  VALUES ('Testland', 'TL')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.leagues (id, name, country, season)
  VALUES (9900, 'Staging League', 'Testland', 2026)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.fixtures (id, league_id, "timestamp", status, date, teams_home, teams_away)
  VALUES (990001, 9900, EXTRACT(epoch FROM now() - interval '2 days')::bigint, 'FT',
          now() - interval '2 days',
          '{"id":9001,"name":"Staging Home"}'::jsonb,
          '{"id":9002,"name":"Staging Away"}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  -- User A: one persisted ticket with two legs --------------------------------
  INSERT INTO public.generated_tickets (id, user_id, legs, total_odds, created_at)
  VALUES ('11111111-1111-4111-8111-111111111111', v_a, '[]'::jsonb, 2.10, now())
  ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id;

  INSERT INTO public.ticket_leg_outcomes (
    id, ticket_id, user_id, fixture_id, league_id, market, side, line, odds,
    selection_key, selection, source, picked_at, kickoff_at, result_status)
  VALUES
    ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', v_a,
     990001, 9900, 'goals', 'over', 1.5, 1.40, 'over_1_5', 'Over 1.5', 'staging-seed',
     now() - interval '3 days', now() - interval '2 days', 'PENDING'),
    ('33333333-3333-4333-8333-333333333334', '11111111-1111-4111-8111-111111111111', v_a,
     990001, 9900, 'goals', 'over', 2.5, 1.90, 'over_2_5', 'Over 2.5', 'staging-seed',
     now() - interval '3 days', now() - interval '2 days', 'PENDING')
  ON CONFLICT (id) DO NOTHING;

  -- User B: one persisted ticket with one leg ---------------------------------
  INSERT INTO public.generated_tickets (id, user_id, legs, total_odds, created_at)
  VALUES ('22222222-2222-4222-8222-222222222222', v_b, '[]'::jsonb, 1.75, now())
  ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id;

  INSERT INTO public.ticket_leg_outcomes (
    id, ticket_id, user_id, fixture_id, league_id, market, side, line, odds,
    selection_key, selection, source, picked_at, kickoff_at, result_status)
  VALUES
    ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', v_b,
     990001, 9900, 'goals', 'over', 1.5, 1.45, 'over_1_5', 'Over 1.5', 'staging-seed',
     now() - interval '3 days', now() - interval '2 days', 'PENDING')
  ON CONFLICT (id) DO NOTHING;
END $$;

SELECT 'staging integration seed applied' AS result;
