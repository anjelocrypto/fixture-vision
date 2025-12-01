-- ============================================================================
-- STATS PIPELINE SANITY CHECKS
-- ============================================================================
-- Copy-paste these queries into your SQL editor to verify stats health
-- Run daily or when suspecting data issues
-- ============================================================================

-- ============================================================================
-- 1. SAMPLE SIZE DISTRIBUTION
-- ============================================================================
-- Expected: Most teams should have sample_size = 5
-- Early-season teams may have 1-4
-- ============================================================================
SELECT 
  sample_size, 
  COUNT(*) AS teams_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS pct
FROM stats_cache
GROUP BY sample_size
ORDER BY sample_size;


-- ============================================================================
-- 2. AGE OF DATA
-- ============================================================================
-- Expected: hours_since_oldest < 48 (with 24h TTL)
-- If > 48 hours, cron might be stuck
-- ============================================================================
SELECT 
  MIN(computed_at) AS oldest_stat,
  MAX(computed_at) AS newest_stat,
  ROUND(EXTRACT(EPOCH FROM (NOW() - MIN(computed_at))) / 3600, 1) AS hours_since_oldest,
  ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(computed_at))) / 60, 1) AS minutes_since_newest,
  COUNT(*) AS total_teams_cached
FROM stats_cache;


-- ============================================================================
-- 3. TEAMS WITH NO CACHE BUT UPCOMING FIXTURES
-- ============================================================================
-- Expected: Empty or very few results
-- If many results, batch cron may be behind
-- ============================================================================
SELECT DISTINCT
  (f.teams_home->>'id')::int AS team_id,
  (f.teams_home->>'name') AS team_name,
  'missing_cache' AS issue
FROM fixtures f
LEFT JOIN stats_cache sc ON (f.teams_home->>'id')::int = sc.team_id
WHERE f.timestamp >= EXTRACT(EPOCH FROM NOW())
  AND f.timestamp <= EXTRACT(EPOCH FROM NOW() + INTERVAL '120 hours')
  AND sc.team_id IS NULL

UNION

SELECT DISTINCT
  (f.teams_away->>'id')::int AS team_id,
  (f.teams_away->>'name') AS team_name,
  'missing_cache' AS issue
FROM fixtures f
LEFT JOIN stats_cache sc ON (f.teams_away->>'id')::int = sc.team_id
WHERE f.timestamp >= EXTRACT(EPOCH FROM NOW())
  AND f.timestamp <= EXTRACT(EPOCH FROM NOW() + INTERVAL '120 hours')
  AND sc.team_id IS NULL
  
ORDER BY team_id
LIMIT 50;


-- ============================================================================
-- 4. SUSPICIOUS STATS: Teams with 5 matches but 0 goals average
-- ============================================================================
-- Expected: Empty result
-- If results found, investigate those teams manually
-- ============================================================================
SELECT 
  sc.team_id,
  sc.goals,
  sc.corners,
  sc.sample_size,
  sc.computed_at,
  COUNT(f.id) AS recent_fixtures
FROM stats_cache sc
LEFT JOIN fixtures f ON (
  ((f.teams_home->>'id')::int = sc.team_id OR (f.teams_away->>'id')::int = sc.team_id)
  AND f.status = 'FT'
  AND f.timestamp >= EXTRACT(EPOCH FROM NOW() - INTERVAL '90 days')
)
WHERE sc.sample_size = 5 AND sc.goals = 0
GROUP BY sc.team_id, sc.goals, sc.corners, sc.sample_size, sc.computed_at
HAVING COUNT(f.id) >= 5;


-- ============================================================================
-- 5. RANDOM BIG TEAMS CHECK
-- ============================================================================
-- Verify stats for major teams (easy to manually cross-check)
-- Team IDs: 33=Man City, 50=Man United, 157=Bayern, 529=Barcelona, 541=Real Madrid
-- ============================================================================
SELECT 
  team_id,
  goals,
  corners,
  cards,
  fouls,
  offsides,
  sample_size,
  computed_at,
  ROUND(EXTRACT(EPOCH FROM (NOW() - computed_at)) / 60, 0) AS age_minutes
FROM stats_cache
WHERE team_id IN (33, 50, 157, 529, 541)
ORDER BY team_id;


-- ============================================================================
-- 6. CROSS-CHECK: Man City (team_id=50) Goals Average vs Raw Fixtures
-- ============================================================================
-- Manually verify Man City's cached goals match their last 5 FT fixtures
-- Replace team_id=50 with any team you want to verify
-- ============================================================================
WITH man_city_fixtures AS (
  SELECT 
    f.id AS fixture_id,
    to_timestamp(f.timestamp) AS kickoff,
    f.status,
    (f.teams_home->>'name') AS home_team,
    (f.teams_away->>'name') AS away_team,
    CASE
      WHEN (f.teams_home->>'id')::int = 50 THEN (f.goals->>'home')::numeric
      WHEN (f.teams_away->>'id')::int = 50 THEN (f.goals->>'away')::numeric
      ELSE NULL
    END AS goals_for_man_city
  FROM fixtures f
  WHERE f.status = 'FT'
    AND f.timestamp >= EXTRACT(EPOCH FROM NOW() - INTERVAL '90 days')
    AND (
      (f.teams_home->>'id')::int = 50 OR
      (f.teams_away->>'id')::int = 50
    )
  ORDER BY f.timestamp DESC
  LIMIT 5
)
SELECT
  -- Individual matches
  fixture_id,
  kickoff,
  home_team,
  away_team,
  goals_for_man_city
FROM man_city_fixtures
ORDER BY kickoff DESC;

-- Then compute average
WITH man_city_fixtures AS (
  SELECT 
    CASE
      WHEN (f.teams_home->>'id')::int = 50 THEN (f.goals->>'home')::numeric
      WHEN (f.teams_away->>'id')::int = 50 THEN (f.goals->>'away')::numeric
      ELSE NULL
    END AS goals_for_man_city
  FROM fixtures f
  WHERE f.status = 'FT'
    AND f.timestamp >= EXTRACT(EPOCH FROM NOW() - INTERVAL '90 days')
    AND (
      (f.teams_home->>'id')::int = 50 OR
      (f.teams_away->>'id')::int = 50
    )
  ORDER BY f.timestamp DESC
  LIMIT 5
)
SELECT
  COUNT(*) AS matches_count,
  SUM(goals_for_man_city) AS total_goals,
  ROUND(AVG(goals_for_man_city)::numeric, 2) AS avg_goals_last5,
  (SELECT goals FROM stats_cache WHERE team_id = 50) AS cached_goals,
  ROUND(ABS(AVG(goals_for_man_city) - (SELECT goals FROM stats_cache WHERE team_id = 50))::numeric, 3) AS difference
FROM man_city_fixtures;


-- ============================================================================
-- 7. TEAMS WITH STALE STATS (>24 hours old)
-- ============================================================================
-- Expected: Empty or very few results
-- If many results, batch cron may be stuck
-- ============================================================================
SELECT 
  sc.team_id,
  sc.goals,
  sc.sample_size,
  sc.computed_at,
  ROUND(EXTRACT(EPOCH FROM (NOW() - sc.computed_at)) / 3600, 1) AS hours_old
FROM stats_cache sc
WHERE sc.computed_at < NOW() - INTERVAL '24 hours'
ORDER BY sc.computed_at ASC
LIMIT 50;


-- ============================================================================
-- 8. COVERAGE: Percentage of upcoming fixtures with cached stats
-- ============================================================================
-- Expected: >90% coverage
-- ============================================================================
WITH upcoming_teams AS (
  SELECT DISTINCT (teams_home->>'id')::int AS team_id
  FROM fixtures
  WHERE timestamp >= EXTRACT(EPOCH FROM NOW())
    AND timestamp <= EXTRACT(EPOCH FROM NOW() + INTERVAL '120 hours')
  UNION
  SELECT DISTINCT (teams_away->>'id')::int AS team_id
  FROM fixtures
  WHERE timestamp >= EXTRACT(EPOCH FROM NOW())
    AND timestamp <= EXTRACT(EPOCH FROM NOW() + INTERVAL '120 hours')
),
cached_teams AS (
  SELECT team_id FROM stats_cache
)
SELECT
  COUNT(DISTINCT ut.team_id) AS total_upcoming_teams,
  COUNT(DISTINCT ct.team_id) AS cached_teams,
  ROUND(100.0 * COUNT(DISTINCT ct.team_id) / NULLIF(COUNT(DISTINCT ut.team_id), 0), 1) AS coverage_pct
FROM upcoming_teams ut
LEFT JOIN cached_teams ct ON ut.team_id = ct.team_id;


-- ============================================================================
-- 9. RECENT BATCH RUNS (from optimizer_run_logs)
-- ============================================================================
-- Expected: Runs every ~10 minutes with processed > 0
-- ============================================================================
SELECT
  started_at,
  run_type,
  scanned,
  upserted AS processed,
  failed,
  duration_ms,
  (scope->>'batch_size')::int AS batch_size,
  (scope->>'window_hours')::int AS window_hours
FROM optimizer_run_logs
WHERE run_type = 'stats-refresh-batch'
ORDER BY started_at DESC
LIMIT 10;


-- ============================================================================
-- 10. EXTREME OUTLIERS: Teams with unrealistic stats
-- ============================================================================
-- Expected: Empty or very few results
-- Flags teams with goals > 5.0 or < 0.1 (likely data issues)
-- ============================================================================
SELECT
  team_id,
  goals,
  corners,
  cards,
  sample_size,
  computed_at,
  CASE
    WHEN goals > 5.0 THEN 'Unrealistically high goals'
    WHEN goals < 0.1 AND sample_size >= 5 THEN 'Unrealistically low goals'
    WHEN corners > 15.0 THEN 'Unrealistically high corners'
    WHEN corners < 0.5 AND sample_size >= 5 THEN 'Unrealistically low corners'
    ELSE 'Other outlier'
  END AS issue
FROM stats_cache
WHERE 
  (goals > 5.0 OR (goals < 0.1 AND sample_size >= 5)) OR
  (corners > 15.0 OR (corners < 0.5 AND sample_size >= 5))
ORDER BY goals DESC, corners DESC;


-- ============================================================================
-- USAGE INSTRUCTIONS
-- ============================================================================
-- 1. Run queries 1-3 daily for general health monitoring
-- 2. Run query 4 if suspecting wrong stats for specific teams
-- 3. Run query 6 to manually verify any suspicious team
-- 4. Run query 8 to check overall pipeline coverage
-- 5. Run query 9 to verify batch cron is running regularly
-- 6. Run query 10 to catch extreme outliers/data issues
-- ============================================================================
