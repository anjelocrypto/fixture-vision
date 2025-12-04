# Stats Deep History Implementation Status

## Overview

This document tracks the implementation of the Global Historical Fixtures & Stats Backfill system
and the strict integrity guards for TicketAI's stats pipeline.

## Implementation Components

### 1. Historical Fixtures Backfill System

**Edge Function**: `fixtures-history-backfill`
- Imports historical fixtures + results from API-Football into our DB
- Tracks progress via `league_history_sync_state` table
- Supports configurable seasons (default: 2 seasons back)
- Respects API rate limits with batching

**Sync State Table**: `league_history_sync_state`
- Tracks progress per league/season combo
- Status: pending → in_progress → completed/error
- Enables resumable backfills

### 2. DB-Based Stats Recomputation

**Shared Module**: `_shared/stats_db.ts`
- `recomputeTeamStatsFromDB()` - Pure DB-based stats calculation
- `getTeamDBFixtureCount()` - Check how much history we have
- `validateStatsAgainstDB()` - Compare cache vs DB

### 3. Stats Integrity Validation

**Shared Module**: `_shared/stats_integrity.ts`
- `validateFixtureStats()` - Single fixture validation
- `validateFixturesBatch()` - Batch validation for Filterizer/Ticket Creator
- Checks: cache exists, sample_size >= 3, no CRITICAL violations

### 4. Tool Integrations

**Fixture Analyzer** (`analyze-fixture`)
- Now returns `stats_available: false` if integrity fails
- Includes detailed status per team

**Filterizer** (`filterizer-query`)
- Drops fixtures failing integrity checks
- Logs: `[STATS_INTEGRITY_FAIL] fixture X – reason Y – DROPPED`

**Ticket Creator** (`generate-ticket`)
- Same integrity checks as Filterizer
- Ensures all selections have reliable stats

## Backfill Status by League Tier

### Top 5 Leagues
| League | Status | Seasons | Fixtures | Results |
|--------|--------|---------|----------|---------|
| Premier League (39) | Pending | 2024, 2023 | TBD | TBD |
| La Liga (140) | Pending | 2024, 2023 | TBD | TBD |
| Bundesliga (78) | Pending | 2024, 2023 | TBD | TBD |
| Serie A (135) | Pending | 2024, 2023 | TBD | TBD |
| Ligue 1 (61) | Pending | 2024, 2023 | TBD | TBD |

### Other Major Leagues
| League | Status | Notes |
|--------|--------|-------|
| Portuguese Liga (94) | Pending | Lower divisions may have partial stats |
| Dutch Eredivisie (88) | Pending | |
| Turkish Super Lig (203) | Pending | |
| Danish Superliga (119) | Pending | |
| Polish Ekstraklasa (106) | Pending | |

### UEFA Competitions
| Competition | Status | Notes |
|-------------|--------|-------|
| Champions League (2) | Pending | Full stats coverage |
| Europa League (3) | Pending | Full stats coverage |
| Conference League (848) | Pending | Full stats coverage |

### Cup Competitions
| Cup | Status | Notes |
|-----|--------|-------|
| FA Cup (45) | Pending | May have partial stats for early rounds |
| Copa del Rey (143) | Pending | |
| DFB-Pokal (81) | Pending | |
| Coppa Italia (137) | Pending | |

## Known Limitations

1. **API-Football Coverage Gaps**
   - Some lower leagues have incomplete statistics (corners, fouls, offsides may be null)
   - Cup competitions early rounds often lack detailed stats

2. **Rate Limiting**
   - Backfill processes ~50 fixtures per league per run
   - Full backfill of all leagues may take 24-48 hours

3. **DB vs API Discrepancy**
   - API-Football may have more historical data than our DB
   - Health check now only validates when DB has sufficient history (≥5 fixtures)

## How to Run Backfill

### Manual Run (Admin)
```bash
# From Supabase dashboard or via API
POST /functions/v1/fixtures-history-backfill
{
  "seasonsBack": 2,
  "batchSize": 5,
  "fixturesPerLeague": 50
}
```

### Cron Job
Schedule: Every 6 hours
```sql
SELECT cron.schedule(
  'fixtures-history-backfill-cron',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/fixtures-history-backfill',
    headers := '{"Content-Type": "application/json", "X-CRON-KEY": "<key>"}'::jsonb,
    body := '{"seasonsBack": 2, "batchSize": 5, "fixturesPerLeague": 50}'::jsonb
  );
  $$
);
```

## Acceptance Checks

Run these queries to verify system health:

```sql
-- 1. Teams with upcoming fixtures missing stats_cache
SELECT COUNT(*) as missing_cache
FROM (
  SELECT DISTINCT (teams_home->>'id')::int as team_id FROM fixtures
  WHERE timestamp >= EXTRACT(EPOCH FROM NOW())
    AND timestamp <= EXTRACT(EPOCH FROM NOW() + INTERVAL '7 days')
  UNION
  SELECT DISTINCT (teams_away->>'id')::int as team_id FROM fixtures
  WHERE timestamp >= EXTRACT(EPOCH FROM NOW())
    AND timestamp <= EXTRACT(EPOCH FROM NOW() + INTERVAL '7 days')
) t
WHERE NOT EXISTS (
  SELECT 1 FROM stats_cache sc WHERE sc.team_id = t.team_id
);

-- 2. Teams with sample_size < 3
SELECT COUNT(*) as low_sample
FROM stats_cache sc
WHERE sc.sample_size < 3
AND sc.team_id IN (
  SELECT DISTINCT (teams_home->>'id')::int FROM fixtures
  WHERE timestamp >= EXTRACT(EPOCH FROM NOW())
  UNION
  SELECT DISTINCT (teams_away->>'id')::int FROM fixtures
  WHERE timestamp >= EXTRACT(EPOCH FROM NOW())
);

-- 3. Active CRITICAL violations
SELECT COUNT(*) as critical_violations
FROM stats_health_violations
WHERE severity = 'critical'
AND resolved_at IS NULL;

-- 4. Backfill progress
SELECT 
  status,
  COUNT(*) as count,
  SUM(total_fixtures_synced) as total_fixtures
FROM league_history_sync_state
GROUP BY status;
```

## Next Steps

1. [ ] Schedule cron job for `fixtures-history-backfill`
2. [ ] Monitor backfill progress via `league_history_sync_state`
3. [ ] Re-run stats-health-check after backfill completes
4. [ ] Verify all acceptance checks pass
5. [ ] Update this document with final stats

---

Last Updated: 2025-12-04
