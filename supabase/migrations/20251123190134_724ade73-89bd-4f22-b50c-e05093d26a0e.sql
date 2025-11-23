-- Populate league_stats_coverage from fixture_results
DELETE FROM league_stats_coverage;

WITH base AS (
  SELECT
    fr.league_id,
    l.name AS league_name,
    c.code AS country,
    (
      l.name ILIKE '%cup%' OR
      l.name ILIKE '%trophy%' OR
      l.name ILIKE '%super cup%' OR
      l.name ILIKE '%shield%' OR
      l.name ILIKE '%copa%' OR
      l.name ILIKE '%coupe%' OR
      l.name ILIKE '%pokal%' OR
      l.name ILIKE '%taca%'
    ) AS is_cup,
    fr.corners_home,
    fr.corners_away,
    fr.cards_home,
    fr.cards_away
  FROM fixture_results fr
  JOIN leagues l ON l.id = fr.league_id
  LEFT JOIN countries c ON c.id = l.country_id
  WHERE fr.kickoff_at >= now() - INTERVAL '12 months'
),
league_stats AS (
  SELECT
    league_id,
    league_name,
    country,
    is_cup,
    COUNT(*) AS total_fixtures,
    COUNT(*) AS fixtures_with_goals,
    COUNT(*) FILTER (WHERE corners_home IS NOT NULL AND corners_away IS NOT NULL) AS fixtures_with_corners,
    COUNT(*) FILTER (WHERE cards_home IS NOT NULL AND cards_away IS NOT NULL) AS fixtures_with_cards
  FROM base
  GROUP BY league_id, league_name, country, is_cup
)
INSERT INTO league_stats_coverage (
  league_id,
  league_name,
  country,
  is_cup,
  total_fixtures,
  fixtures_with_goals,
  fixtures_with_corners,
  fixtures_with_cards,
  fixtures_with_fouls,
  fixtures_with_offsides,
  last_checked_at,
  created_at
)
SELECT
  league_id,
  league_name,
  country,
  is_cup,
  total_fixtures,
  fixtures_with_goals,
  fixtures_with_corners,
  fixtures_with_cards,
  0 AS fixtures_with_fouls,
  0 AS fixtures_with_offsides,
  NOW() AS last_checked_at,
  NOW() AS created_at
FROM league_stats;

-- Log results
DO $$
DECLARE
  total_count INT;
  cup_count INT;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE is_cup) INTO total_count, cup_count FROM league_stats_coverage;
  RAISE NOTICE 'Populated league_stats_coverage: % total leagues, % cups', total_count, cup_count;
END $$;