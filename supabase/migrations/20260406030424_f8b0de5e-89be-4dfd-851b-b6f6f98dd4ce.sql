CREATE TABLE public.daily_safest_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id bigint NOT NULL,
  league_id integer NOT NULL,
  league_name text NOT NULL,
  home_team text NOT NULL,
  away_team text NOT NULL,
  market text NOT NULL,
  side text NOT NULL,
  line numeric NOT NULL,
  confidence_tier text NOT NULL DEFAULT 'high',
  daily_safety_score numeric NOT NULL DEFAULT 0,
  historical_hit_rate numeric NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  supporting_reason text NOT NULL DEFAULT '',
  freshness_status text NOT NULL DEFAULT 'fresh',
  warning_flags text[] NOT NULL DEFAULT '{}',
  odds numeric,
  kickoff_at timestamp with time zone NOT NULL,
  computed_at timestamp with time zone NOT NULL DEFAULT now(),
  generation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.daily_safest_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read daily insights"
  ON public.daily_safest_insights FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role manages daily insights"
  ON public.daily_safest_insights FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_daily_insights_computed ON public.daily_safest_insights (computed_at DESC);
CREATE INDEX idx_daily_insights_kickoff ON public.daily_safest_insights (kickoff_at);