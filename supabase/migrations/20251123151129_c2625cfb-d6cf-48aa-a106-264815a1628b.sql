-- Create table to store league statistics coverage analysis
CREATE TABLE IF NOT EXISTS public.league_stats_coverage (
  league_id INT PRIMARY KEY,
  league_name TEXT NOT NULL,
  country TEXT,
  is_cup BOOLEAN NOT NULL DEFAULT false,
  total_fixtures INT NOT NULL DEFAULT 0,
  fixtures_with_goals INT NOT NULL DEFAULT 0,
  fixtures_with_corners INT NOT NULL DEFAULT 0,
  fixtures_with_cards INT NOT NULL DEFAULT 0,
  fixtures_with_fouls INT NOT NULL DEFAULT 0,
  fixtures_with_offsides INT NOT NULL DEFAULT 0,
  goals_coverage_pct NUMERIC GENERATED ALWAYS AS (
    CASE WHEN total_fixtures > 0 THEN (fixtures_with_goals::numeric / total_fixtures * 100) ELSE 0 END
  ) STORED,
  corners_coverage_pct NUMERIC GENERATED ALWAYS AS (
    CASE WHEN total_fixtures > 0 THEN (fixtures_with_corners::numeric / total_fixtures * 100) ELSE 0 END
  ) STORED,
  cards_coverage_pct NUMERIC GENERATED ALWAYS AS (
    CASE WHEN total_fixtures > 0 THEN (fixtures_with_cards::numeric / total_fixtures * 100) ELSE 0 END
  ) STORED,
  fouls_coverage_pct NUMERIC GENERATED ALWAYS AS (
    CASE WHEN total_fixtures > 0 THEN (fixtures_with_fouls::numeric / total_fixtures * 100) ELSE 0 END
  ) STORED,
  offsides_coverage_pct NUMERIC GENERATED ALWAYS AS (
    CASE WHEN total_fixtures > 0 THEN (fixtures_with_offsides::numeric / total_fixtures * 100) ELSE 0 END
  ) STORED,
  skip_goals BOOLEAN GENERATED ALWAYS AS (
    CASE WHEN total_fixtures > 0 THEN (fixtures_with_goals::numeric / total_fixtures * 100) < 80 ELSE false END
  ) STORED,
  skip_corners BOOLEAN GENERATED ALWAYS AS (
    CASE WHEN total_fixtures > 0 THEN (fixtures_with_corners::numeric / total_fixtures * 100) < 30 ELSE false END
  ) STORED,
  skip_cards BOOLEAN GENERATED ALWAYS AS (
    CASE WHEN total_fixtures > 0 THEN (fixtures_with_cards::numeric / total_fixtures * 100) < 30 ELSE false END
  ) STORED,
  skip_fouls BOOLEAN GENERATED ALWAYS AS (
    CASE WHEN total_fixtures > 0 THEN (fixtures_with_fouls::numeric / total_fixtures * 100) < 30 ELSE false END
  ) STORED,
  skip_offsides BOOLEAN GENERATED ALWAYS AS (
    CASE WHEN total_fixtures > 0 THEN (fixtures_with_offsides::numeric / total_fixtures * 100) < 30 ELSE false END
  ) STORED,
  last_checked_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.league_stats_coverage ENABLE ROW LEVEL SECURITY;

-- Admins can read coverage data
CREATE POLICY "Admins can read coverage" ON public.league_stats_coverage
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- Service role can manage coverage
CREATE POLICY "Service role can manage coverage" ON public.league_stats_coverage
  FOR ALL USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_league_stats_coverage_skip_flags 
  ON public.league_stats_coverage(league_id, skip_goals, skip_corners, skip_cards, skip_fouls, skip_offsides);

-- Create a view for easy querying of problematic cups
CREATE OR REPLACE VIEW public.v_problematic_cups AS
SELECT 
  league_id,
  league_name,
  country,
  total_fixtures,
  goals_coverage_pct,
  corners_coverage_pct,
  cards_coverage_pct,
  fouls_coverage_pct,
  offsides_coverage_pct,
  skip_goals,
  skip_corners,
  skip_cards,
  skip_fouls,
  skip_offsides,
  last_checked_at
FROM public.league_stats_coverage
WHERE is_cup = true 
  AND (skip_corners = true OR skip_cards = true OR skip_fouls = true OR skip_offsides = true OR skip_goals = true)
ORDER BY corners_coverage_pct ASC, cards_coverage_pct ASC;