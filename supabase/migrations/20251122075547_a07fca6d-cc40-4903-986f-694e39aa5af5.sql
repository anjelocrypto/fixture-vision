-- Remove 6h filter from pipeline_health_check to show true warmup staleness
CREATE OR REPLACE VIEW pipeline_health_check AS
WITH stats_summary AS (
  SELECT
    COUNT(DISTINCT tm.team_id) AS total_teams,
    COUNT(DISTINCT sc.team_id) AS fresh_stats,
    ROUND(
      100.0 * COUNT(DISTINCT sc.team_id) 
      / NULLIF(COUNT(DISTINCT tm.team_id), 0), 
      1
    ) AS coverage_pct
  FROM (
    SELECT DISTINCT (teams_home->>'id')::INT AS team_id
    FROM fixtures
    WHERE timestamp >= EXTRACT(EPOCH FROM NOW())
      AND timestamp <= EXTRACT(EPOCH FROM (NOW() + INTERVAL '120 hours'))
    UNION
    SELECT DISTINCT (teams_away->>'id')::INT AS team_id
    FROM fixtures
    WHERE timestamp >= EXTRACT(EPOCH FROM NOW())
      AND timestamp <= EXTRACT(EPOCH FROM (NOW() + INTERVAL '120 hours'))
  ) AS tm
  LEFT JOIN stats_cache sc
    ON sc.team_id = tm.team_id
    AND sc.computed_at >= NOW() - INTERVAL '24 hours'
),
latest_batches AS (
  SELECT 
    MAX(started_at) FILTER (WHERE run_type = 'stats-refresh-batch') AS last_stats_batch,
    MAX(started_at) FILTER (WHERE run_type = 'cron-warmup-odds') AS last_warmup_optimizer
  FROM optimizer_run_logs
),
cron_counts AS (
  SELECT
    COUNT(*) FILTER (WHERE jobname IN ('stats-refresh-batch-cron', 'warmup-optimizer-cron')) AS active_pipeline_cron_jobs,
    COUNT(*) AS total_cron_jobs
  FROM cron.job
)
SELECT
  NOW() AS checked_at,
  ss.total_teams,
  ss.fresh_stats,
  ss.coverage_pct,
  lb.last_stats_batch,
  CASE 
    WHEN lb.last_stats_batch IS NOT NULL 
    THEN ROUND(EXTRACT(EPOCH FROM (NOW() - lb.last_stats_batch)) / 60)
    ELSE NULL
  END AS stats_batch_minutes_ago,
  lb.last_warmup_optimizer,
  CASE 
    WHEN lb.last_warmup_optimizer IS NOT NULL 
    THEN ROUND(EXTRACT(EPOCH FROM (NOW() - lb.last_warmup_optimizer)) / 60)
    ELSE NULL
  END AS warmup_minutes_ago,
  cc.active_pipeline_cron_jobs,
  cc.total_cron_jobs,
  CASE
    WHEN lb.last_warmup_optimizer IS NULL THEN '❌ CRITICAL (NO WARMUP SEEN)'
    WHEN EXTRACT(EPOCH FROM (NOW() - lb.last_warmup_optimizer)) / 60 > 60 THEN '❌ CRITICAL (WARMUP STALE)'
    WHEN ss.coverage_pct < 70.0 THEN '❌ CRITICAL (LOW COVERAGE)'
    WHEN EXTRACT(EPOCH FROM (NOW() - lb.last_warmup_optimizer)) / 60 > 40 THEN '⚠️ DEGRADED (WARMUP DELAYED)'
    WHEN ss.coverage_pct < 90.0 THEN '⚠️ DEGRADED (COVERAGE BELOW 90%)'
    WHEN cc.active_pipeline_cron_jobs != 2 THEN '⚠️ DEGRADED (WRONG CRON COUNT)'
    ELSE '✅ HEALTHY'
  END AS health_status
FROM stats_summary ss
CROSS JOIN latest_batches lb
CROSS JOIN cron_counts cc;