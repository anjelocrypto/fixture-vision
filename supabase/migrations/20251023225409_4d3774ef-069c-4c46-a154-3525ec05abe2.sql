-- Create optimized_selections table for precomputed bet selections
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
  odds numeric NOT NULL,
  is_live boolean DEFAULT false,
  edge_pct numeric,
  model_prob numeric,
  sample_size integer,
  combined_snapshot jsonb,
  rules_version text,
  source text DEFAULT 'api-football',
  computed_at timestamptz DEFAULT now(),
  UNIQUE(fixture_id, market, side, line, bookmaker, is_live)
);

-- Create indexes for efficient querying
CREATE INDEX idx_opt_sel_window ON public.optimized_selections(utc_kickoff, league_id);
CREATE INDEX idx_opt_sel_market ON public.optimized_selections(market, line, odds DESC);
CREATE INDEX idx_opt_sel_fixture ON public.optimized_selections(fixture_id);

-- Enable RLS
ALTER TABLE public.optimized_selections ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read
CREATE POLICY "Authenticated users can read optimized selections"
ON public.optimized_selections
FOR SELECT
TO authenticated
USING (true);

-- Service role has full access
CREATE POLICY "Service role can manage optimized selections"
ON public.optimized_selections
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');