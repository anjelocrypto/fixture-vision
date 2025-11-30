-- Create player_injuries table for tracking injured, doubtful, and suspended players
CREATE TABLE IF NOT EXISTS public.player_injuries (
  player_id       integer NOT NULL,
  player_name     text    NOT NULL,
  team_id         integer NOT NULL,
  team_name       text    NOT NULL,
  league_id       integer NOT NULL,
  season          integer NOT NULL,
  position        text,
  injury_type     text,
  status          text,       -- injured, doubtful, suspended, etc.
  start_date      date,
  expected_return date,
  last_update     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, team_id, league_id, season)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_player_injuries_team_league ON public.player_injuries(team_id, league_id, season);
CREATE INDEX IF NOT EXISTS idx_player_injuries_status ON public.player_injuries(status);
CREATE INDEX IF NOT EXISTS idx_player_injuries_last_update ON public.player_injuries(last_update);

-- Enable RLS
ALTER TABLE public.player_injuries ENABLE ROW LEVEL SECURITY;

-- Service role can manage all rows
CREATE POLICY "Service role can manage player injuries"
ON public.player_injuries
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Authenticated users can read injury data
CREATE POLICY "Authenticated users can read player injuries"
ON public.player_injuries
FOR SELECT
USING (auth.uid() IS NOT NULL);