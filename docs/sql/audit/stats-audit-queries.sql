-- =============================================================================
-- STATS AUDIT SQL QUERIES
-- =============================================================================
-- These queries help manually inspect stats_cache accuracy and team data.
-- Run these in the Supabase SQL editor or via psql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Count teams with fresh stats in next 48h
-- -----------------------------------------------------------------------------
-- Shows how many teams have fixtures in the next 48 hours and how many
-- of those have fresh (recently computed, sample_size >= 5) stats cached.

WITH upcoming_teams AS (
  SELECT DISTINCT (teams_home->>'id')::INT AS team_id
  FROM fixtures
  WHERE timestamp BETWEEN EXTRACT(EPOCH FROM NOW())
                      AND EXTRACT(EPOCH FROM NOW() + INTERVAL '48 hours')
  UNION
  SELECT DISTINCT (teams_away->>'id')::INT AS team_id
  FROM fixtures
  WHERE timestamp BETWEEN EXTRACT(EPOCH FROM NOW())
                      AND EXTRACT(EPOCH FROM NOW() + INTERVAL '48 hours')
)
SELECT
  COUNT(*)                                  AS total_teams_48h,
  COUNT(*) FILTER (
    WHERE sc.sample_size >= 5
      AND sc.computed_at >= NOW() - INTERVAL '24 hours'
  )                                         AS fresh_teams,
  ROUND(
    100.0 * COUNT(*) FILTER (
      WHERE sc.sample_size >= 5
        AND sc.computed_at >= NOW() - INTERVAL '24 hours'
    ) / NULLIF(COUNT(*), 0),
    1
  )                                         AS fresh_pct
FROM upcoming_teams ut
LEFT JOIN stats_cache sc ON sc.team_id = ut.team_id;


-- -----------------------------------------------------------------------------
-- 2) Inspect a single team's last-5 fixtures and per-fixture stats
-- -----------------------------------------------------------------------------
-- Replace 33 with the actual team_id you want to inspect.
-- Shows the most recent 10 finished fixtures for that team with all stats.

WITH team_fixtures AS (
  SELECT 
    fr.fixture_id,
    fr.kickoff_at,
    fr.league_id,
    l.name AS league_name,
    fr.goals_home,
    fr.goals_away,
    fr.corners_home,
    fr.corners_away,
    fr.cards_home,
    fr.cards_away,
    fr.fouls_home,
    fr.fouls_away,
    fr.offsides_home,
    fr.offsides_away,
    f.teams_home,
    f.teams_away,
    CASE 
      WHEN (f.teams_home->>'id')::INT = 33 THEN 'home'
      ELSE 'away'
    END AS team_side
  FROM fixture_results fr
  JOIN fixtures f ON f.id = fr.fixture_id
  LEFT JOIN leagues l ON l.id = fr.league_id
  WHERE (
    (f.teams_home->>'id')::INT = 33 OR
    (f.teams_away->>'id')::INT = 33
  )
  AND fr.status = 'FT'
  ORDER BY fr.kickoff_at DESC
  LIMIT 10
)
SELECT
  fixture_id,
  kickoff_at,
  league_name,
  team_side,
  CASE WHEN team_side = 'home' THEN goals_home ELSE goals_away END AS goals_for,
  CASE WHEN team_side = 'home' THEN corners_home ELSE corners_away END AS corners,
  CASE WHEN team_side = 'home' THEN cards_home ELSE cards_away END AS cards,
  CASE WHEN team_side = 'home' THEN fouls_home ELSE fouls_away END AS fouls,
  CASE WHEN team_side = 'home' THEN offsides_home ELSE offsides_away END AS offsides
FROM team_fixtures;


-- -----------------------------------------------------------------------------
-- 3) View stats_cache entry for a specific team
-- -----------------------------------------------------------------------------
-- Replace 33 with the team_id.

SELECT 
  team_id,
  goals,
  corners,
  cards,
  fouls,
  offsides,
  sample_size,
  last_five_fixture_ids,
  computed_at,
  source
FROM stats_cache
WHERE team_id = 33;


-- -----------------------------------------------------------------------------
-- 4) Teams with largest stats cache discrepancies (by league)
-- -----------------------------------------------------------------------------
-- Useful for identifying leagues with systematic data quality issues.

WITH upcoming_teams AS (
  SELECT DISTINCT 
    f.league_id,
    (teams_home->>'id')::INT AS team_id
  FROM fixtures f
  WHERE timestamp BETWEEN EXTRACT(EPOCH FROM NOW())
                      AND EXTRACT(EPOCH FROM NOW() + INTERVAL '48 hours')
  UNION
  SELECT DISTINCT 
    f.league_id,
    (teams_away->>'id')::INT AS team_id
  FROM fixtures f
  WHERE timestamp BETWEEN EXTRACT(EPOCH FROM NOW())
                      AND EXTRACT(EPOCH FROM NOW() + INTERVAL '48 hours')
)
SELECT 
  l.name AS league_name,
  ut.league_id,
  COUNT(DISTINCT ut.team_id) AS total_teams,
  COUNT(DISTINCT CASE WHEN sc.sample_size >= 5 
                        AND sc.computed_at >= NOW() - INTERVAL '24 hours'
                      THEN ut.team_id END) AS fresh_teams,
  ROUND(
    100.0 * COUNT(DISTINCT CASE WHEN sc.sample_size >= 5 
                                  AND sc.computed_at >= NOW() - INTERVAL '24 hours'
                                THEN ut.team_id END) / NULLIF(COUNT(DISTINCT ut.team_id), 0),
    1
  ) AS fresh_pct
FROM upcoming_teams ut
LEFT JOIN stats_cache sc ON sc.team_id = ut.team_id
LEFT JOIN leagues l ON l.id = ut.league_id
GROUP BY l.name, ut.league_id
ORDER BY fresh_pct ASC, l.name;


-- -----------------------------------------------------------------------------
-- 5) Sample of teams with potentially stale stats (computed > 24h ago)
-- -----------------------------------------------------------------------------

SELECT 
  sc.team_id,
  sc.goals,
  sc.corners,
  sc.sample_size,
  sc.computed_at,
  NOW() - sc.computed_at AS age
FROM stats_cache sc
WHERE sc.computed_at < NOW() - INTERVAL '24 hours'
  AND sc.sample_size >= 5
ORDER BY sc.computed_at ASC
LIMIT 20;
