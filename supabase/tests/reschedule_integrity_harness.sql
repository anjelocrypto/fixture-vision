-- Isolated-database harness for the Gate D reschedule-integrity migration.
-- Recreates only the production objects the migration depends on, so the
-- migration can be applied and exercised in a disposable database.

-- Roles are cluster-wide: tolerate a reused CI postgres service.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS public._test_ctx (role text NOT NULL DEFAULT 'service_role', uid uuid);
INSERT INTO public._test_ctx (role, uid) VALUES ('service_role', gen_random_uuid());

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT role FROM public._test_ctx LIMIT 1 $$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT uid FROM public._test_ctx LIMIT 1 $$;

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

CREATE TABLE public.fixtures (
  id bigint PRIMARY KEY,
  league_id integer,
  "timestamp" bigint,
  status text,
  date timestamptz,
  teams_home jsonb,
  teams_away jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.countries (
  id integer PRIMARY KEY,
  name text,
  code text,
  flag text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.leagues (
  id integer PRIMARY KEY,
  name text,
  country text,
  season integer,
  logo text,
  country_id integer
);



CREATE TABLE public.fixture_results (
  fixture_id bigint PRIMARY KEY,
  league_id integer,
  kickoff_at timestamptz,
  status text,
  goals_home smallint,
  goals_away smallint,
  corners_home smallint,
  corners_away smallint,
  cards_home smallint,
  cards_away smallint,
  fouls_home smallint,
  fouls_away smallint,
  offsides_home smallint,
  offsides_away smallint,
  source text,
  fetched_at timestamptz DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE public.generated_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  total_odds numeric,
  min_target numeric,
  max_target numeric,
  used_live boolean DEFAULT false,
  legs jsonb NOT NULL,
  ticket_mode text,
  ticket_model_prob numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ticket_outcomes (
  ticket_id uuid PRIMARY KEY,
  user_id uuid,
  legs_total integer,
  legs_settled integer DEFAULT 0,
  legs_won integer DEFAULT 0,
  legs_lost integer DEFAULT 0,
  legs_pushed integer DEFAULT 0,
  legs_void integer DEFAULT 0,
  ticket_status text DEFAULT 'PENDING',
  total_odds numeric,
  created_at timestamptz DEFAULT now(),
  settled_at timestamptz,
  ticket_mode text,
  ticket_model_prob numeric
);

CREATE TABLE public.ticket_leg_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  user_id uuid,
  fixture_id bigint NOT NULL,
  league_id integer,
  market text,
  side text,
  line numeric,
  odds numeric,
  selection_key text,
  selection text,
  source text,
  picked_at timestamptz,
  kickoff_at timestamptz,
  settled_at timestamptz,
  result_status text NOT NULL DEFAULT 'PENDING',
  actual_value numeric,
  scored_version text,
  derived_from_selection boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  model_prob numeric,
  score_claim_token uuid,
  score_claimed_at timestamptz,
  score_attempts integer NOT NULL DEFAULT 0
);

CREATE TABLE public.optimizer_cache (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fixture_id bigint, market text, side text, line numeric,
  combined_value numeric, bookmaker text, odds numeric, source text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.pipeline_alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fingerprint text UNIQUE NOT NULL,
  alert_type text,
  severity text,
  message text,
  details jsonb,
  occurrences integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz DEFAULT now(),
  last_seen_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text
);

-- Deduplicating alert recorder (mirrors production semantics).
CREATE OR REPLACE FUNCTION public.record_pipeline_alert(
  p_fingerprint text, p_alert_type text, p_severity text, p_message text, p_details jsonb)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.pipeline_alerts (fingerprint, alert_type, severity, message, details)
  VALUES (p_fingerprint, p_alert_type, p_severity, p_message, p_details)
  ON CONFLICT (fingerprint) DO UPDATE
    SET occurrences = public.pipeline_alerts.occurrences + 1,
        last_seen_at = now(),
        resolved_at = NULL
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Alert resolver (mirrors production minus the Supabase role guard).
CREATE OR REPLACE FUNCTION public.resolve_pipeline_alert(p_fingerprint text)
RETURNS integer LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_count integer;
BEGIN
  IF p_fingerprint IS NULL OR btrim(p_fingerprint) = '' THEN
    RAISE EXCEPTION 'fingerprint required';
  END IF;
  UPDATE public.pipeline_alerts
  SET resolved_at = now(), resolved_by = 'automatic_recovery'
  WHERE fingerprint = btrim(p_fingerprint) AND resolved_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- Production-identical scorer helpers (copied verbatim from production
-- pg_get_functiondef output) so scoring paths can be exercised here.
CREATE OR REPLACE FUNCTION public.release_ticket_leg_score_claim(p_leg_id uuid, p_claim_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  UPDATE public.ticket_leg_outcomes
  SET score_claim_token = NULL, score_claimed_at = NULL
  WHERE id = p_leg_id AND result_status = 'PENDING' AND score_claim_token = p_claim_token;
  RETURN FOUND;
END; $function$;

CREATE OR REPLACE FUNCTION public.finalize_scored_ticket_leg(
  p_leg_id uuid, p_claim_token uuid, p_result_status text, p_actual_value numeric, p_scored_version text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF auth.role() <> 'service_role' OR p_result_status NOT IN ('WIN','LOSS','PUSH','VOID') THEN
    RAISE EXCEPTION 'invalid score finalization request';
  END IF;
  UPDATE public.ticket_leg_outcomes
  SET result_status = p_result_status, actual_value = p_actual_value, settled_at = now(),
      scored_version = p_scored_version, score_claim_token = NULL, score_claimed_at = NULL
  WHERE id = p_leg_id AND result_status = 'PENDING' AND score_claim_token = p_claim_token;
  RETURN FOUND;
END; $function$;

-- Parent ticket refresh: mirrors production public.refresh_ticket_outcome minus
-- the service-role guard (the harness runs without Supabase auth helpers).
CREATE OR REPLACE FUNCTION public.refresh_ticket_outcome(p_ticket_id uuid)
RETURNS text LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  v_total integer; v_won integer; v_lost integer; v_pushed integer;
  v_void integer; v_settled integer; v_status text;
BEGIN
  PERFORM 1 FROM public.ticket_outcomes WHERE ticket_id = p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket outcome not found';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE result_status = 'WIN')::integer,
    count(*) FILTER (WHERE result_status = 'LOSS')::integer,
    count(*) FILTER (WHERE result_status = 'PUSH')::integer,
    count(*) FILTER (WHERE result_status = 'VOID')::integer
  INTO v_total, v_won, v_lost, v_pushed, v_void
  FROM public.ticket_leg_outcomes
  WHERE ticket_id = p_ticket_id;

  v_settled := v_won + v_lost + v_pushed + v_void;
  v_status := CASE
    WHEN v_lost > 0 THEN 'LOST'
    WHEN v_total > 0 AND v_void = v_total THEN 'VOID'
    WHEN v_total > 0 AND v_settled = v_total THEN 'WON'
    WHEN v_settled > 0 THEN 'PARTIAL'
    ELSE 'PENDING'
  END;

  UPDATE public.ticket_outcomes
  SET legs_total = v_total, legs_settled = v_settled, legs_won = v_won,
      legs_lost = v_lost, legs_pushed = v_pushed, legs_void = v_void,
      ticket_status = v_status,
      settled_at = CASE WHEN v_total > 0 AND v_settled = v_total THEN now() ELSE NULL END
  WHERE ticket_id = p_ticket_id;

  RETURN v_status;
END; $function$;
