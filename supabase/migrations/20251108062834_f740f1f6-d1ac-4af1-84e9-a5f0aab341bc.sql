-- Team Totals (Over 1.5) - Model-Only Feature
-- Table to store candidate selections for team totals market

CREATE TABLE IF NOT EXISTS public.team_totals_candidates (
  id                  BIGSERIAL PRIMARY KEY,
  fixture_id          BIGINT NOT NULL,
  league_id           INT NOT NULL,
  team_id             INT NOT NULL,
  team_context        TEXT NOT NULL CHECK (team_context IN ('home','away')),
  line                NUMERIC(3,1) NOT NULL DEFAULT 1.5,
  
  -- Model inputs
  season_scoring_rate NUMERIC(5,3),
  opponent_season_conceding_rate NUMERIC(5,3),
  opponent_recent_conceded_2plus INT,
  recent_sample_size  INT,
  
  rules_passed        BOOLEAN NOT NULL DEFAULT FALSE,
  rules_version       TEXT NOT NULL DEFAULT 'v1.0',
  utc_kickoff         TIMESTAMPTZ NOT NULL,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE (fixture_id, team_id, team_context)
);

CREATE INDEX IF NOT EXISTS idx_team_totals_kickoff
  ON public.team_totals_candidates (utc_kickoff DESC, league_id);

-- Enable RLS on the table
ALTER TABLE public.team_totals_candidates ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can read
CREATE POLICY "Authenticated users can read team totals"
  ON public.team_totals_candidates
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Service role can manage
CREATE POLICY "Service role can manage team totals"
  ON public.team_totals_candidates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Pre-match view (security invoker)
CREATE OR REPLACE VIEW public.v_team_totals_prematch
WITH (security_invoker = true) AS
SELECT c.*
FROM public.team_totals_candidates c
JOIN public.fixtures f ON f.id = c.fixture_id
WHERE f.status IN ('NS','TBD')
  AND c.utc_kickoff >= (now() + interval '5 minutes')
  AND c.rules_passed = TRUE;

-- Grant SELECT on view
GRANT SELECT ON public.v_team_totals_prematch TO authenticated;