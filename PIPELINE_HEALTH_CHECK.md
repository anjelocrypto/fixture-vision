# Pipeline Health Check

## Quick Health Check

Run this query anytime to see pipeline status:

```sql
SELECT * FROM pipeline_health_check;
```

## What to Look For

### ✅ Healthy Pipeline
- `health_status`: ✅ HEALTHY
- `coverage_pct`: ≥ 90.0%
- `stats_batch_minutes_ago`: < 20 minutes
- `warmup_minutes_ago`: < 40 minutes
- `active_pipeline_cron_jobs`: 2
- `total_cron_jobs`: 6

### ⚠️ Degraded Pipeline
- `coverage_pct`: 70-89%
- `stats_batch_minutes_ago`: 20-60 minutes
- Action: Monitor for improvement over next 30 minutes

### ❌ Critical Issues
- `coverage_pct`: < 70%
- `stats_batch_minutes_ago`: > 60 minutes
- `active_pipeline_cron_jobs`: ≠ 2
- Action: Check cron locks, release if stuck

## Manual Overrides (When Needed)

The pipeline runs 100% automatically, but you can manually trigger:

### Refresh Stats (120h force)
Manually refresh all team stats for next 120h window:
```
Admin Panel → Refresh Stats (120h • force)
```

### Warmup (120h force)  
Manually trigger odds fetch + optimizer:
```
Admin Panel → Warmup (120h • force)
```

### When to Use Manual Overrides
- After adding new leagues/countries
- After major rule changes
- If coverage drops below 70%
- If warmup hasn't run in > 2 hours

## Current Active Cron Jobs

| Job Name | Schedule | Purpose |
|----------|----------|---------|
| `stats-refresh-batch-cron` | Every 10 minutes | Refresh team stats (25 teams/batch) |
| `warmup-optimizer-cron` | Every 30 minutes | Fetch odds + optimize selections |
| `downgrade-expired-entitlements-5m` | Every 5 minutes | Expire subscriptions |
| `purge-stale-prematch-selections-5m` | Every 5 minutes | Clean old selections |
| `results-refresh-30m` | Every 30 min (9-23h) | Update match results |
| `cleanup-old-results` | Monthly (1st @ 4am) | Archive old data |

## Troubleshooting

### Stats coverage dropping
1. Check for stuck cron lock:
   ```sql
   SELECT * FROM cron_job_locks WHERE locked_until > now();
   ```
2. Release stuck lock if needed:
   ```sql
   SELECT release_cron_lock('stats-refresh');
   ```
3. Wait 10 minutes for next batch to run

### Warmup not running
1. Check last warmup time:
   ```sql
   SELECT * FROM pipeline_health_check;
   ```
2. If > 60 minutes, check for stuck lock:
   ```sql
   SELECT * FROM cron_job_locks WHERE job_name = 'cron-warmup-odds';
   ```
3. Release if needed:
   ```sql
   SELECT release_cron_lock('cron-warmup-odds');
   ```

### Filterizer showing few results
1. Verify stats coverage ≥ 90%
2. Verify last warmup < 60 minutes ago
3. Check optimized_selections has recent entries:
   ```sql
   SELECT COUNT(*), MAX(computed_at)
   FROM optimized_selections
   WHERE utc_kickoff > now();
   ```

## Expected Behavior

With 100% automation:
- **Stats**: Refreshed continuously, 25 teams every 10 minutes
- **Coverage**: Should maintain 90-100% for upcoming 120h window
- **Odds**: Refreshed every 30 minutes for 120h window
- **Selections**: Regenerated every 30 minutes
- **No manual intervention** required for normal operation

The founder should **never need to click admin buttons** unless:
- Testing new features
- Adding new leagues
- Recovering from infrastructure issues
- Forcing immediate refresh for time-sensitive scenarios
