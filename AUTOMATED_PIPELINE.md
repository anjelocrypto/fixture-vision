# TicketAI Automated Data Pipeline

## Overview

The TicketAI data pipeline runs automatically 24/7 using Supabase pg_cron scheduled jobs. No manual button clicks are required for daily operations.

## Automated Schedules

### 1. Stats Refresh (Every 10 Minutes)

**Schedule:** `*/10 * * * *` (every 10 minutes)  
**Function:** `stats-refresh` (batch mode)  
**Configuration:**
```json
{
  "window_hours": 120,
  "stats_ttl_hours": 24,
  "force": false
}
```

**What it does:**
- Processes **25 teams per batch** (BATCH_SIZE=25)
- Targets teams appearing in fixtures within next **120 hours**
- Refreshes teams with stale stats (older than **24 hours**)
- Prioritizes teams with NO cache, then oldest cache
- Uses `acquire_cron_lock` to prevent concurrent runs
- Average duration: **~30-40 seconds per batch**

**Capacity:**
- 6 batches/hour × 25 teams = **150 team refreshes/hour**
- 24 hours = **3,600 team refreshes/day**
- Sufficient to keep ~3,500-4,000 teams fresh with 24h TTL

### 2. Warmup/Optimizer (Every 30 Minutes)

**Schedule:** `*/30 * * * *` (every 30 minutes)  
**Function:** `cron-warmup-odds`  
**Configuration:**
```json
{
  "window_hours": 120
}
```

**What it does:**
1. Calls `backfill-odds` - Fetches latest odds from API-Football for upcoming fixtures
2. Calls `optimize-selections-refresh` - Generates optimized selections using stats + odds
3. Logs run details to `optimizer_run_logs`
4. Releases cron lock on completion or error

**Purpose:**
- Keeps `optimized_selections` table fresh for Filterizer, Ticket Creator, Winner panels
- Ensures odds are up-to-date (odds change frequently)
- Recalculates model probabilities and edge percentages

## How It Works

### Data Flow
```
stats-refresh (10m) → stats_cache
                           ↓
cron-warmup-odds (30m) → backfill-odds → odds_cache
                           ↓
                    optimize-selections-refresh → optimized_selections
                           ↓
                    Filterizer / Ticket Creator / Winners
```

### Lock Mechanism
- Both jobs use `cron_job_locks` table to prevent overlaps
- If a job is already running, the next invocation skips gracefully
- Locks automatically expire after 15-60 minutes (configurable)

### Authentication
- All cron calls use `X-CRON-KEY` header (stored in `app_settings`)
- Edge functions validate key via `get_cron_internal_key()` RPC
- Manual admin calls from UI also work (use user whitelist auth)

## Manual Overrides (Admin Panel)

The admin buttons in the UI still work and are safe to use as **manual overrides**:

### When to Use Manual Overrides
1. **After major league expansion** - Run "Refresh Stats (120h • force)" manually
2. **Before important matches** - Force refresh specific window
3. **Testing/debugging** - Verify pipeline works after code changes
4. **Recovery from issues** - Clear locks, force full refresh

### Admin Buttons
- **Refresh Stats (120h • force)** - Force-refreshes all teams (bypasses TTL)
- **Warmup (120h • force)** - Force-runs entire pipeline
- **Optimizer (120h)** - Re-generates selections for 120h window
- **🔓 Release Lock** - Manually releases stuck cron locks

**Important:** Manual calls and cron jobs use the same lock mechanism, so they won't conflict.

## Monitoring

### Check Pipeline Health

#### 1. Stats Coverage
```sql
-- Teams with fresh stats for next 120h
WITH upcoming_teams AS (
  SELECT DISTINCT
    (f.teams_home->>'id')::int AS team_id
  FROM fixtures f
  WHERE f.timestamp BETWEEN EXTRACT(EPOCH FROM now())
                        AND EXTRACT(EPOCH FROM now() + interval '120 hours')
  UNION
  SELECT DISTINCT
    (f.teams_away->>'id')::int AS team_id
  FROM fixtures f
  WHERE f.timestamp BETWEEN EXTRACT(EPOCH FROM now())
                        AND EXTRACT(EPOCH FROM now() + interval '120 hours')
)
SELECT
  COUNT(*) AS total_teams,
  COUNT(*) FILTER (WHERE sc.computed_at >= now() - interval '24 hours') AS fresh_stats,
  ROUND(100.0 * COUNT(*) FILTER (WHERE sc.computed_at >= now() - interval '24 hours') / COUNT(*), 1) AS coverage_pct
FROM upcoming_teams ut
LEFT JOIN stats_cache sc ON sc.team_id = ut.team_id;
```

**Target:** Coverage ≥ 90%

#### 2. Recent Stats Batch Runs
```sql
-- Last 10 stats-refresh-batch runs
SELECT 
  started_at,
  upserted,
  failed,
  duration_ms,
  scope->>'batch_size' as batch_size,
  scope->>'window_hours' as window_hours
FROM optimizer_run_logs
WHERE run_type = 'stats-refresh-batch'
ORDER BY started_at DESC
LIMIT 10;
```

#### 3. Recent Optimizer Runs
```sql
-- Last 5 optimizer runs
SELECT 
  run_type,
  started_at,
  scanned,
  upserted,
  failed,
  duration_ms
FROM optimizer_run_logs
WHERE run_type LIKE 'optimize-selections%' OR run_type = 'cron-warmup-odds'
ORDER BY started_at DESC
LIMIT 5;
```

#### 4. Check Cron Locks
```sql
-- Active cron locks
SELECT 
  job_name,
  locked_at,
  locked_until,
  locked_by,
  EXTRACT(EPOCH FROM (locked_until - now())) / 60 as minutes_remaining
FROM cron_job_locks
WHERE locked_until > now();
```

If locks are stuck beyond expected duration, use admin "🔓 Release Lock" button.

### Edge Function Logs
Monitor logs in Lovable Cloud backend for:
- `[stats-refresh] Batch complete: X processed, Y failed, ~Z remaining`
- `[cron-warmup-odds] Complete in Xms`
- `[optimize-selections-refresh] Generated X selections from Y fixtures`

## API Rate Limits

### API-Football Limits
- **Free tier:** ~50-60 requests/minute
- **Pro tier:** Higher limits (varies by plan)

### Current Usage (Safe)
- **stats-refresh:** 25 teams × ~1 API call/team = ~25 calls per 10-minute batch = **~2.5 calls/minute**
- **backfill-odds:** Varies by fixtures in window, typically 10-30 fixtures per 30-minute run = **~0.3-1 call/minute**
- **Total:** ~3-4 API calls/minute (well under limits)

### Rate Limit Safety
- Built-in retry logic with exponential backoff
- Rate limiting between requests in batch loops
- Lock mechanism prevents concurrent API hammering

## Troubleshooting

### Problem: Filterizer shows very few results
**Likely cause:** Stats coverage is low  
**Solution:**
1. Check stats coverage (SQL above) - should be ≥90%
2. If low, manually click "Refresh Stats (120h • force)" 3-4 times
3. Wait for cron to catch up (1-2 hours)

### Problem: "Stats refresh already running" error
**Cause:** Cron lock is held  
**Solution:** Use admin "🔓 Release Lock" button, then retry

### Problem: Cron jobs not running
**Check:**
1. Verify cron jobs exist:
   ```sql
   SELECT * FROM cron.job WHERE jobname LIKE '%cron%';
   ```
2. Check `app_settings` has `CRON_INTERNAL_KEY`
3. Review Edge Function logs for auth errors

### Problem: Coverage drops below 90%
**Cause:** High fixture volume or API limits  
**Solution:**
- Cron will automatically catch up over 6-12 hours
- Or manually force-refresh specific windows
- Consider upgrading API-Football plan if persistent

## Configuration

### Adjusting Schedules
To change cron frequencies, update the schedules:

```sql
-- Example: Change stats-refresh to every 5 minutes
SELECT cron.unschedule('stats-refresh-batch-cron');
SELECT cron.schedule(
  'stats-refresh-batch-cron',
  '*/5 * * * *',  -- Every 5 minutes instead of 10
  $$ ... $$
);
```

### Adjusting Batch Size
To process more/fewer teams per batch, edit `BATCH_SIZE` in:
`supabase/functions/stats-refresh/index.ts`

**Current:** `BATCH_SIZE = 25` (~30-40s per batch)  
**Safe range:** 15-40 teams (must stay under 60s Edge Function timeout)

### Adjusting Windows
To change data window coverage, modify `window_hours`:
- **Current:** 120h (5 days)
- **Alternatives:** 72h (3 days), 168h (7 days)

## Summary

✅ **Automated:** Stats, odds, and selections refresh automatically  
✅ **Safe:** Respects API limits, prevents concurrent runs  
✅ **Resilient:** Lock mechanism, retry logic, graceful failures  
✅ **Observable:** Detailed logs, SQL diagnostics, admin UI  
✅ **Manual Override:** Admin buttons work for emergency fixes  

**You no longer need to click buttons daily** - the pipeline runs itself!
