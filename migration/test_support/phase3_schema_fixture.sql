CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '');
$$;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_entitlements (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  plan text NOT NULL,
  status text NOT NULL,
  current_period_end timestamptz NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  source text,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.webhook_events (
  event_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_trial_credits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  remaining_uses integer NOT NULL DEFAULT 5,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_rate_limits (
  user_id uuid NOT NULL,
  feature text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, feature, window_start)
);

CREATE OR REPLACE FUNCTION public.is_user_whitelisted() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;

CREATE OR REPLACE FUNCTION public.ensure_trial_row() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.user_trial_credits (user_id)
  VALUES (auth.uid()) ON CONFLICT (user_id) DO NOTHING;
$$;

CREATE TABLE public.generated_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  total_odds numeric NOT NULL,
  min_target numeric NOT NULL,
  max_target numeric NOT NULL,
  used_live boolean NOT NULL DEFAULT false,
  legs jsonb NOT NULL,
  ticket_mode text,
  ticket_model_prob numeric,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.optimizer_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id bigint NOT NULL,
  market text NOT NULL,
  side text NOT NULL,
  line numeric NOT NULL,
  combined_value numeric NOT NULL,
  bookmaker text,
  odds numeric,
  source text,
  computed_at timestamptz DEFAULT now()
);

CREATE TABLE public.ticket_leg_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.generated_tickets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  fixture_id bigint NOT NULL,
  league_id integer,
  market text NOT NULL,
  side text NOT NULL,
  line numeric NOT NULL,
  odds numeric NOT NULL,
  selection_key text NOT NULL,
  selection text NOT NULL,
  source text NOT NULL DEFAULT 'prematch',
  picked_at timestamptz NOT NULL DEFAULT now(),
  kickoff_at timestamptz,
  settled_at timestamptz,
  result_status text NOT NULL DEFAULT 'PENDING',
  actual_value numeric,
  scored_version text,
  derived_from_selection boolean NOT NULL DEFAULT false,
  model_prob numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, fixture_id, market, side, line)
);

CREATE TABLE public.ticket_outcomes (
  ticket_id uuid PRIMARY KEY REFERENCES public.generated_tickets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  legs_total integer NOT NULL DEFAULT 0,
  legs_settled integer NOT NULL DEFAULT 0,
  legs_won integer NOT NULL DEFAULT 0,
  legs_lost integer NOT NULL DEFAULT 0,
  legs_pushed integer NOT NULL DEFAULT 0,
  legs_void integer NOT NULL DEFAULT 0,
  ticket_status text NOT NULL DEFAULT 'PENDING',
  total_odds numeric NOT NULL,
  ticket_mode text,
  ticket_model_prob numeric,
  settled_at timestamptz
);

CREATE TABLE public.optimized_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id bigint NOT NULL,
  league_id integer NOT NULL,
  country_code text,
  utc_kickoff timestamptz NOT NULL,
  market text NOT NULL,
  side text NOT NULL,
  line numeric NOT NULL,
  bookmaker text,
  odds numeric,
  is_live boolean DEFAULT false,
  edge_pct numeric,
  model_prob numeric,
  sample_size integer,
  combined_snapshot jsonb,
  rules_version text,
  source text DEFAULT 'api-football',
  computed_at timestamptz DEFAULT now(),
  UNIQUE (fixture_id, market, side, line, bookmaker, is_live)
);

CREATE TABLE public.green_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id integer NOT NULL,
  market text NOT NULL,
  side text NOT NULL,
  line_norm numeric NOT NULL,
  odds_band text NOT NULL,
  sample_size integer NOT NULL,
  wins integer NOT NULL,
  losses integer NOT NULL,
  hit_rate_pct numeric NOT NULL,
  roi_pct numeric NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cron_job_locks (
  job_name text PRIMARY KEY,
  locked_until timestamptz NOT NULL,
  locked_by text,
  locked_at timestamptz DEFAULT now()
);

CREATE TABLE public.fixture_results (
  fixture_id bigint PRIMARY KEY,
  goals_home smallint NOT NULL,
  goals_away smallint NOT NULL,
  corners_home smallint,
  corners_away smallint,
  cards_home smallint,
  cards_away smallint,
  status text NOT NULL
);

CREATE TABLE public.pipeline_alerts (
  id serial PRIMARY KEY,
  alert_type text NOT NULL,
  severity text NOT NULL,
  message text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text
);

INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-000000000001');
