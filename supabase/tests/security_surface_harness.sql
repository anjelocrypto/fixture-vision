-- Isolated-database harness extension for the Gate D security migrations
-- (leaderboard privacy, definer-grant hardening, RC3 authorization changes).
-- Recreates only the production objects those migrations depend on.

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  username text UNIQUE,
  display_name text,
  preferred_lang text,
  username_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.market_coins (
  user_id uuid PRIMARY KEY,
  balance integer NOT NULL DEFAULT 1000,
  total_wagered integer NOT NULL DEFAULT 0,
  total_won integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.market_coins ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.prediction_markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id bigint,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prediction_markets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.market_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid REFERENCES public.prediction_markets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  outcome text,
  net_stake integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.market_positions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.market_leaderboard_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  balance integer NOT NULL DEFAULT 0,
  snapshot_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_trial_credits (
  user_id uuid PRIMARY KEY,
  credits integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW public.v_market_leaderboard AS
  SELECT mc.user_id, mc.balance FROM public.market_coins mc;

-- Routine stubs whose grants the security migrations revoke.
CREATE OR REPLACE FUNCTION public.is_user_subscriber(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$ SELECT false $$;

CREATE OR REPLACE FUNCTION public.ensure_trial_row()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $$ SELECT NULL::void $$;

CREATE OR REPLACE FUNCTION public.try_use_feature(feature_key text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $$ SELECT false $$;

CREATE OR REPLACE FUNCTION public.get_my_market_stats()
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$ SELECT '{}'::json $$;

CREATE OR REPLACE FUNCTION public.get_market_aggregates(_market_id uuid)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$ SELECT '{}'::json $$;

CREATE OR REPLACE FUNCTION public.create_profile_with_username(p_username text)
RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $$ SELECT '{}'::json $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT ON public.market_coins TO authenticated;
GRANT SELECT ON public.market_positions TO authenticated;
GRANT SELECT ON public.prediction_markets TO anon, authenticated;
GRANT SELECT ON public.market_leaderboard_snapshots TO anon, authenticated;
GRANT SELECT ON public.v_market_leaderboard TO anon, authenticated;
