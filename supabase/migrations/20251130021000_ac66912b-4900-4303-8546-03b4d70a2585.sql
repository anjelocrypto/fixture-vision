-- Create player_importance table to track player significance for injury impact calculations
CREATE TABLE IF NOT EXISTS public.player_importance (
  player_id integer NOT NULL,
  team_id integer NOT NULL,
  league_id integer NOT NULL,
  season integer NOT NULL,
  importance numeric NOT NULL CHECK (importance >= 0 AND importance <= 1),
  minutes_played integer DEFAULT 0,
  matches_played integer DEFAULT 0,
  matches_started integer DEFAULT 0,
  goals integer DEFAULT 0,
  assists integer DEFAULT 0,
  last_update timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, team_id, league_id, season)
);

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_player_importance_team_league_season 
  ON public.player_importance(team_id, league_id, season);

CREATE INDEX IF NOT EXISTS idx_player_importance_importance 
  ON public.player_importance(importance DESC) WHERE importance >= 0.6;

-- Enable RLS
ALTER TABLE public.player_importance ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read player importance
CREATE POLICY "Authenticated users can read player importance"
  ON public.player_importance FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Service role can manage player importance
CREATE POLICY "Service role can manage player importance"
  ON public.player_importance FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.player_importance IS 'Player importance scores (0.0-1.0) for injury impact calculations. Based on minutes played, matches started, goals+assists. Only significant injuries (importance >= 0.6) trigger goal reduction.';
COMMENT ON COLUMN public.player_importance.importance IS 'Normalized importance score 0.0-1.0. Calculated from: (minutes_played / max_minutes_in_team) × 0.6 + (goals+assists normalized) × 0.4. Players with importance >= 0.6 are considered key players.';
