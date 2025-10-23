-- Create countries table for caching
CREATE TABLE IF NOT EXISTS public.countries (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  flag TEXT,
  code TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create leagues table for caching
CREATE TABLE IF NOT EXISTS public.leagues (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  country_id INTEGER REFERENCES public.countries(id),
  season INTEGER NOT NULL,
  logo TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create fixtures table for caching
CREATE TABLE IF NOT EXISTS public.fixtures (
  id INTEGER PRIMARY KEY,
  league_id INTEGER REFERENCES public.leagues(id),
  date DATE NOT NULL,
  timestamp BIGINT,
  teams_home JSONB NOT NULL,
  teams_away JSONB NOT NULL,
  status TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create stats_cache table for team statistics
CREATE TABLE IF NOT EXISTS public.stats_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fixture_id INTEGER,
  team_id INTEGER NOT NULL,
  last5_stats JSONB NOT NULL,
  computed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(team_id)
);

-- Create analysis_cache table for optimizer results
CREATE TABLE IF NOT EXISTS public.analysis_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  fixture_id INTEGER NOT NULL UNIQUE,
  summary_json JSONB NOT NULL,
  computed_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_fixtures_date ON public.fixtures(date);
CREATE INDEX IF NOT EXISTS idx_fixtures_league_id ON public.fixtures(league_id);
CREATE INDEX IF NOT EXISTS idx_leagues_country_id ON public.leagues(country_id);
CREATE INDEX IF NOT EXISTS idx_stats_cache_team_id ON public.stats_cache(team_id);
CREATE INDEX IF NOT EXISTS idx_analysis_cache_fixture_id ON public.analysis_cache(fixture_id);

-- Enable RLS
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stats_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_cache ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access (data is public betting info)
CREATE POLICY "Countries are viewable by everyone"
ON public.countries FOR SELECT
USING (true);

CREATE POLICY "Leagues are viewable by everyone"
ON public.leagues FOR SELECT
USING (true);

CREATE POLICY "Fixtures are viewable by everyone"
ON public.fixtures FOR SELECT
USING (true);

CREATE POLICY "Stats cache is viewable by everyone"
ON public.stats_cache FOR SELECT
USING (true);

CREATE POLICY "Analysis cache is viewable by everyone"
ON public.analysis_cache FOR SELECT
USING (true);