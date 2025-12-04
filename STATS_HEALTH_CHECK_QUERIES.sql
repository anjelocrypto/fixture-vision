-- =============================================================================
-- STATS HEALTH CHECK QUERIES
-- Run these queries to verify stats pipeline integrity
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. STALE FIXTURES CHECK
-- Fixtures older than 24h that are NOT finished (should be 0)
-- -----------------------------------------------------------------------------
SELECT 
  COUNT(*) AS stale_ns_count,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ HEALTHY'
    WHEN COUNT(*) < 10 THEN '⚠️ DEGRADED'
    ELSE '❌ CRITICAL'
  END AS status
FROM fixtures f
WHERE to_timestamp(f.timestamp) < NOW() - INTERVAL '24 hours'
  AND f.status NOT IN ('FT','AET','PEN','PST','CANC','ABD','AWD','WO');

-- Detailed view of stale fixtures (top 20)
SELECT 
  f.id AS fixture_id,
  l.name AS league_name,
  f.league_id,
  to_timestamp(f.timestamp) AS kickoff,
  f.status,
  (f.teams_home->>'name') AS home_team,
  (f.teams_away->>'name') AS away_team
FROM fixtures f
LEFT JOIN leagues l ON l.id = f.league_id
WHERE to_timestamp(f.timestamp) < NOW() - INTERVAL '24 hours'
  AND f.status NOT IN ('FT','AET','PEN','PST','CANC','ABD','AWD','WO')
ORDER BY f.timestamp DESC
LIMIT 20;

-- -----------------------------------------------------------------------------
-- 2. FT FIXTURES MISSING RESULTS
-- Finished fixtures without entries in fixture_results (should be 0)
-- -----------------------------------------------------------------------------
SELECT 
  COUNT(*) AS ft_missing_results,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ HEALTHY'
    WHEN COUNT(*) < 20 THEN '⚠️ DEGRADED'
    ELSE '❌ CRITICAL'
  END AS status
FROM fixtures f
LEFT JOIN fixture_results fr ON fr.fixture_id = f.id
WHERE f.status IN ('FT','AET','PEN')
  AND fr.fixture_id IS NULL;

-- Detailed view of FT fixtures missing results (top 20)
SELECT 
  f.id AS fixture_id,
  l.name AS league_name,
  f.league_id,
  to_timestamp(f.timestamp) AS kickoff,
  (f.teams_home->>'name') AS home_team,
  (f.teams_away->>'name') AS away_team
FROM fixtures f
LEFT JOIN leagues l ON l.id = f.league_id
LEFT JOIN fixture_results fr ON fr.fixture_id = f.id
WHERE f.status IN ('FT','AET','PEN')
  AND fr.fixture_id IS NULL
ORDER BY f.timestamp DESC
LIMIT 20;

-- -----------------------------------------------------------------------------
-- 3. MAJOR TEAMS CONSISTENCY CHECK
-- Compare cached goals vs recomputed from fixture_results
-- -----------------------------------------------------------------------------
WITH major_teams AS (
  SELECT team_id, team_name FROM (VALUES
    (33, 'Manchester United'),
    (50, 'Manchester City'),
    (40, 'Liverpool'),
    (42, 'Arsenal'),
    (47, 'Tottenham'),
    (541, 'Real Madrid'),
    (529, 'Barcelona'),
    (530, 'Atletico Madrid'),
    (157, 'Bayern Munich'),
    (165, 'Borussia Dortmund'),
    (496, 'Juventus'),
    (489, 'AC Milan'),
    (505, 'Inter Milan'),
    (499, 'Atalanta'),
    (85, 'PSG'),
    (80, 'Lyon')
  ) AS t(team_id, team_name)
),
team_check AS (
  SELECT 
    mt.team_id,
    mt.team_name,
    sc.goals AS cached_goals,
    sc.sample_size,
    (
      SELECT ROUND(AVG(
        CASE 
          WHEN (f.teams_home->>'id')::int = mt.team_id THEN fr.goals_home
          WHEN (f.teams_away->>'id')::int = mt.team_id THEN fr.goals_away
          ELSE NULL
        END
      )::numeric, 3)
      FROM (
        SELECT f.id, f.teams_home, f.teams_away
        FROM fixtures f
        WHERE f.status IN ('FT','AET','PEN')
          AND ((f.teams_home->>'id')::int = mt.team_id OR (f.teams_away->>'id')::int = mt.team_id)
        ORDER BY f.timestamp DESC
        LIMIT 5
      ) f
      LEFT JOIN fixture_results fr ON fr.fixture_id = f.id
    ) AS recomputed_goals
  FROM major_teams mt
  LEFT JOIN stats_cache sc ON sc.team_id = mt.team_id
)
SELECT 
  team_id,
  team_name,
  cached_goals,
  recomputed_goals,
  sample_size,
  ROUND(ABS(COALESCE(cached_goals, 0) - COALESCE(recomputed_goals, 0))::numeric, 3) AS diff,
  CASE 
    WHEN ABS(COALESCE(cached_goals, 0) - COALESCE(recomputed_goals, 0)) <= 0.15 THEN '✅'
    WHEN ABS(COALESCE(cached_goals, 0) - COALESCE(recomputed_goals, 0)) <= 0.5 THEN '⚠️'
    ELSE '❌'
  END AS status
FROM team_check
ORDER BY diff DESC;

-- -----------------------------------------------------------------------------
-- 4. GLOBAL CONSISTENCY CHECK
-- Find ALL teams where cached != recomputed (top 50 by diff)
-- -----------------------------------------------------------------------------
WITH team_comparison AS (
  SELECT 
    sc.team_id,
    sc.goals AS cached_goals,
    sc.sample_size,
    (
      SELECT ROUND(AVG(
        CASE 
          WHEN (f.teams_home->>'id')::int = sc.team_id THEN fr.goals_home
          WHEN (f.teams_away->>'id')::int = sc.team_id THEN fr.goals_away
          ELSE NULL
        END
      )::numeric, 3)
      FROM (
        SELECT f.id, f.teams_home, f.teams_away
        FROM fixtures f
        WHERE f.status IN ('FT','AET','PEN')
          AND ((f.teams_home->>'id')::int = sc.team_id OR (f.teams_away->>'id')::int = sc.team_id)
        ORDER BY f.timestamp DESC
        LIMIT 5
      ) f
      LEFT JOIN fixture_results fr ON fr.fixture_id = f.id
    ) AS recomputed_goals
  FROM stats_cache sc
  WHERE sc.sample_size > 0
)
SELECT 
  team_id,
  cached_goals,
  recomputed_goals,
  sample_size,
  ROUND(ABS(COALESCE(cached_goals, 0) - COALESCE(recomputed_goals, 0))::numeric, 3) AS diff
FROM team_comparison
WHERE recomputed_goals IS NOT NULL
  AND ABS(COALESCE(cached_goals, 0) - COALESCE(recomputed_goals, 0)) > 0.15
ORDER BY diff DESC
LIMIT 50;

-- Count teams with large diff
SELECT 
  COUNT(*) AS teams_with_large_diff,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ HEALTHY'
    WHEN COUNT(*) < 10 THEN '⚠️ DEGRADED'
    ELSE '❌ CRITICAL'
  END AS status
FROM (
  SELECT sc.team_id
  FROM stats_cache sc
  WHERE sc.sample_size > 0
    AND ABS(sc.goals - COALESCE((
      SELECT AVG(
        CASE 
          WHEN (f.teams_home->>'id')::int = sc.team_id THEN fr.goals_home
          WHEN (f.teams_away->>'id')::int = sc.team_id THEN fr.goals_away
          ELSE NULL
        END
      )
      FROM (
        SELECT f.id, f.teams_home, f.teams_away
        FROM fixtures f
        WHERE f.status IN ('FT','AET','PEN')
          AND ((f.teams_home->>'id')::int = sc.team_id OR (f.teams_away->>'id')::int = sc.team_id)
        ORDER BY f.timestamp DESC
        LIMIT 5
      ) f
      LEFT JOIN fixture_results fr ON fr.fixture_id = f.id
    ), 0)) > 0.15
) affected;

-- -----------------------------------------------------------------------------
-- 5. PIPELINE HEALTH SUMMARY
-- Quick overall health check
-- -----------------------------------------------------------------------------
SELECT 
  NOW() AS checked_at,
  (SELECT COUNT(*) FROM stats_cache) AS total_cached_teams,
  (SELECT COUNT(*) FROM stats_cache WHERE sample_size = 5) AS teams_with_full_sample,
  (SELECT COUNT(*) FROM fixtures WHERE status = 'NS' AND to_timestamp(timestamp) < NOW() - INTERVAL '24 hours') AS stale_ns_fixtures,
  (SELECT COUNT(*) FROM fixtures f 
   LEFT JOIN fixture_results fr ON fr.fixture_id = f.id 
   WHERE f.status IN ('FT','AET','PEN') AND fr.fixture_id IS NULL) AS ft_missing_results,
  (SELECT MAX(computed_at) FROM stats_cache) AS last_stats_update,
  (SELECT MAX(fetched_at) FROM fixture_results) AS last_results_fetch;

-- -----------------------------------------------------------------------------
-- 6. RECENT HEALTH CHECK LOGS
-- View recent stats-health-check runs
-- -----------------------------------------------------------------------------
SELECT 
  started_at,
  duration_ms,
  scanned,
  failed AS teams_with_diff,
  notes
FROM optimizer_run_logs
WHERE run_type = 'stats-health-check'
ORDER BY started_at DESC
LIMIT 10;
