# warmup-odds: Manual/Admin Warmup Function

## Purpose
This function is for **manual/admin use only** to trigger the odds refresh and optimizer pipeline on demand via the Admin UI.

## Production Pipeline
The **production automated pipeline** uses `cron-warmup-odds` which is called by pg_cron every 30 minutes.

## Key Differences

### warmup-odds (This File - Manual/Admin)
- Called manually by admin users via the UI
- Fire-and-forget pattern (triggers background tasks)
- Returns 202 immediately without waiting
- Used for manual overrides, testing, and recovery

### cron-warmup-odds (Production Cron)
- Called automatically by pg_cron every 30 minutes
- Synchronous pattern (waits for completion)
- Returns detailed metrics after completion
- Always returns HTTP 200 for pg_cron stability
- Uses cron lock to prevent overlaps

## Batch Processing Architecture

Both functions now use **batched processing**:
- `backfill-odds`: Processes 30 fixtures per invocation (avoids 504 timeouts)
- `optimize-selections-refresh`: Processes all fixtures with fresh stats/odds
- Rolling batch model maintains continuous coverage

## When to Use

Use **warmup-odds** (this function) when:
- You need to manually trigger a pipeline refresh
- Testing after code changes
- Recovering from a stuck state
- Force-refreshing specific time windows

The **cron-warmup-odds** function handles normal operations automatically.
