-- Basketball Data Pipeline Tables
-- Mirrors football pipeline: fixtures, fixture_results, stats_cache

-- 1. Basketball Teams
CREATE TABLE IF NOT EXISTS public.basketball_teams (
  id SERIAL PRIMARY KEY,
  api_id INTEGER NOT NULL,
  league_key TEXT NOT NULL,
  name TEXT NOT NULL,
  short_name TEXT,
  country TEXT,
  logo TEXT,
  api_source TEXT NOT NULL DEFAULT 'basketball', -- 'nba' or 'basketball'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (api_id, league_key)
);

-- 2. Basketball Games (equivalent to fixtures)
CREATE TABLE IF NOT EXISTS public.basketball_games (
  id SERIAL PRIMARY KEY,
  api_game_id INTEGER NOT NULL,
  league_key TEXT NOT NULL,
  season TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  status_short TEXT NOT NULL DEFAULT 'NS', -- NS, Q1, Q2, Q3, Q4, OT, FT, etc.
  home_team_id INTEGER NOT NULL REFERENCES public.basketball_teams(id),
  away_team_id INTEGER NOT NULL REFERENCES public.basketball_teams(id),
  home_score INTEGER,
  away_score INTEGER,
  total_points INTEGER GENERATED ALWAYS AS (COALESCE(home_score, 0) + COALESCE(away_score, 0)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (api_game_id, league_key)
);

-- 3. Basketball Game Team Stats (boxscore per team per game)
CREATE TABLE IF NOT EXISTS public.basketball_game_team_stats (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES public.basketball_games(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES public.basketball_teams(id),
  is_home BOOLEAN NOT NULL,
  points INTEGER NOT NULL,
  -- Field goals
  fgm INTEGER, -- Field Goals Made
  fga INTEGER, -- Field Goals Attempted
  fgp NUMERIC, -- Field Goal Percentage
  -- 3-Pointers
  tpm INTEGER, -- 3-Point Made
  tpa INTEGER, -- 3-Point Attempted
  tpp NUMERIC, -- 3-Point Percentage
  -- Free Throws
  ftm INTEGER,
  fta INTEGER,
  ftp NUMERIC,
  -- Rebounds
  rebounds_off INTEGER,
  rebounds_def INTEGER,
  rebounds_total INTEGER,
  -- Other stats
  assists INTEGER,
  steals INTEGER,
  blocks INTEGER,
  turnovers INTEGER,
  fouls INTEGER,
  -- Additional NBA stats
  fast_break_points INTEGER,
  points_in_paint INTEGER,
  second_chance_points INTEGER,
  points_off_turnovers INTEGER,
  biggest_lead INTEGER,
  plus_minus INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, team_id)
);

-- 4. Basketball Stats Cache (team averages + last 5 form)
CREATE TABLE IF NOT EXISTS public.basketball_stats_cache (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES public.basketball_teams(id),
  league_key TEXT NOT NULL,
  season TEXT NOT NULL,
  sample_size INTEGER NOT NULL DEFAULT 0,
  -- Season averages
  ppg_for NUMERIC NOT NULL DEFAULT 0, -- Points Per Game (scored)
  ppg_against NUMERIC NOT NULL DEFAULT 0, -- Points Per Game (conceded)
  ppg_total NUMERIC NOT NULL DEFAULT 0, -- Total points per game
  rpg_total NUMERIC NOT NULL DEFAULT 0, -- Rebounds per game
  apg_total NUMERIC NOT NULL DEFAULT 0, -- Assists per game
  tpm_avg NUMERIC NOT NULL DEFAULT 0, -- 3-pointers made per game
  fgp_avg NUMERIC NOT NULL DEFAULT 0, -- Field goal %
  -- Last 5 form
  last5_ppg_for NUMERIC NOT NULL DEFAULT 0,
  last5_ppg_against NUMERIC NOT NULL DEFAULT 0,
  last5_ppg_total NUMERIC NOT NULL DEFAULT 0,
  last5_tpm_avg NUMERIC NOT NULL DEFAULT 0,
  last5_rpg_total NUMERIC NOT NULL DEFAULT 0,
  last5_wins INTEGER NOT NULL DEFAULT 0,
  last5_losses INTEGER NOT NULL DEFAULT 0,
  last5_game_ids INTEGER[] DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, league_key, season)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_basketball_games_date ON public.basketball_games(date);
CREATE INDEX IF NOT EXISTS idx_basketball_games_league_date ON public.basketball_games(league_key, date);
CREATE INDEX IF NOT EXISTS idx_basketball_games_status ON public.basketball_games(status_short);
CREATE INDEX IF NOT EXISTS idx_basketball_game_team_stats_game ON public.basketball_game_team_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_basketball_stats_cache_team ON public.basketball_stats_cache(team_id);
CREATE INDEX IF NOT EXISTS idx_basketball_teams_api ON public.basketball_teams(api_id, league_key);

-- Enable RLS
ALTER TABLE public.basketball_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basketball_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basketball_game_team_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.basketball_stats_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Authenticated users can read, service role can manage
CREATE POLICY "Authenticated users can read basketball teams"
  ON public.basketball_teams FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role manages basketball teams"
  ON public.basketball_teams FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Authenticated users can read basketball games"
  ON public.basketball_games FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role manages basketball games"
  ON public.basketball_games FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Authenticated users can read basketball game stats"
  ON public.basketball_game_team_stats FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role manages basketball game stats"
  ON public.basketball_game_team_stats FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Authenticated users can read basketball stats cache"
  ON public.basketball_stats_cache FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role manages basketball stats cache"
  ON public.basketball_stats_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_basketball_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_basketball_teams_updated_at
  BEFORE UPDATE ON public.basketball_teams
  FOR EACH ROW EXECUTE FUNCTION public.update_basketball_updated_at();

CREATE TRIGGER update_basketball_games_updated_at
  BEFORE UPDATE ON public.basketball_games
  FOR EACH ROW EXECUTE FUNCTION public.update_basketball_updated_at();

CREATE TRIGGER update_basketball_stats_cache_updated_at
  BEFORE UPDATE ON public.basketball_stats_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_basketball_updated_at();