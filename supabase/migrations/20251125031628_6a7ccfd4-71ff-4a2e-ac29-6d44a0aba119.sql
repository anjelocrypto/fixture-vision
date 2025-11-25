-- Create h2h_cache table for Head-to-Head statistics
CREATE TABLE IF NOT EXISTS public.h2h_cache (
  team1_id integer NOT NULL,
  team2_id integer NOT NULL,
  goals numeric NOT NULL DEFAULT 0,
  corners numeric NOT NULL DEFAULT 0,
  cards numeric NOT NULL DEFAULT 0,
  fouls numeric NOT NULL DEFAULT 0,
  offsides numeric NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  last_fixture_ids bigint[] NOT NULL DEFAULT '{}',
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team1_id, team2_id),
  CONSTRAINT h2h_cache_team_order CHECK (team1_id < team2_id)
);

-- Enable RLS
ALTER TABLE public.h2h_cache ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read h2h_cache
CREATE POLICY "Authenticated users can read h2h cache"
ON public.h2h_cache
FOR SELECT
TO authenticated
USING (true);

-- Service role can manage h2h_cache
CREATE POLICY "Service role can manage h2h cache"
ON public.h2h_cache
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_h2h_cache_computed_at ON public.h2h_cache(computed_at);