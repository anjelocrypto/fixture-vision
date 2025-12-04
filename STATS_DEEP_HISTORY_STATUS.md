# Stats Deep History Implementation Status

## Overview

This document tracks the implementation of the Global Historical Fixtures & Stats Backfill system
and the strict integrity guards for TicketAI's stats pipeline.

---

## 1. UEFA & Cups Backfill Status

### 1.1 Supported Competitions

All UEFA and major domestic cup competitions are **fully configured** in `ALLOWED_LEAGUE_IDS`:

| Competition | League ID | Type | Country |
|-------------|-----------|------|---------|
| UEFA Champions League | 2 | International | UEFA |
| UEFA Europa League | 3 | International | UEFA |
| UEFA Europa Conference League | 848 | International | UEFA |
| FA Cup (England) | 45 | Domestic Cup | GB-ENG |
| EFL Cup / Carabao Cup | 48 | Domestic Cup | GB-ENG |
| Copa del Rey (Spain) | 143 | Domestic Cup | ES |
| Coppa Italia (Italy) | 137 | Domestic Cup | IT |
| DFB-Pokal (Germany) | 81 | Domestic Cup | DE |
| Coupe de France | 66 | Domestic Cup | FR |

### 1.2 Backfill Configuration

The `fixtures-history-backfill` edge function:
- ✅ Processes all leagues in `ALLOWED_LEAGUE_IDS` (including all cups above)
- ✅ Supports multiple seasons via `seasonsBack` parameter (default: 2)
- ✅ Upserts fixtures into `fixtures` table
- ✅ Fetches detailed statistics (corners, cards, fouls, offsides) into `fixture_results`
- ✅ Sets `source = 'history-backfill'` and correct status
- ✅ Tracks progress in `league_history_sync_state` table
- ✅ Cron job runs every 6 hours

### 1.3 Manual Backfill for UEFA & Cups

To manually trigger a backfill for all UEFA and major cups:

```bash
# Using curl with service role key
curl -X POST "https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/fixtures-history-backfill" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "leagueIds": [2, 3, 848, 45, 48, 143, 137, 81, 66],
    "seasonsBack": 2,
    "batchSize": 9,
    "fixturesPerLeague": 200,
    "force": false
  }'
```

**Parameters:**
- `leagueIds`: Specific leagues to backfill (default: all ALLOWED_LEAGUE_IDS)
- `seasonsBack`: How many seasons to import (default: 2)
- `batchSize`: Leagues processed per run (default: 5)
- `fixturesPerLeague`: Max fixtures per league per run (default: 50)
- `force`: Re-sync even if status is "completed" (default: false)

### 1.4 Check Backfill Progress

```sql
-- Overall progress by status
SELECT status, COUNT(*) AS league_seasons, SUM(total_fixtures_synced) AS fixtures
FROM league_history_sync_state
GROUP BY status ORDER BY status;

-- UEFA & Cups specific progress
SELECT 
  league_id,
  season,
  status,
  total_fixtures_synced,
  error_message,
  last_run_at
FROM league_history_sync_state
WHERE league_id IN (2, 3, 848, 45, 48, 143, 137, 81, 66)
ORDER BY league_id, season DESC;
```

---

## 2. Stats Consistency Audit

### 2.1 Overview

The `stats-consistency-audit` edge function verifies that our stats are 100% correct by comparing three data sources:

1. **API-Football** - Live data from the API (ground truth)
2. **Local DB** - Recomputed from `fixture_results` table
3. **stats_cache** - Our cached averages used by all tools

### 2.2 How to Run the Audit

```bash
# Full audit of UEFA + major leagues
curl -X POST "https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/stats-consistency-audit" \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "leagueIds": [2, 3, 848, 45, 143, 81, 137, 66, 39, 140, 135, 78, 61],
    "sampleSize": 5,
    "maxTeams": 50
  }'
```

**Parameters:**
- `leagueIds`: Leagues to audit (default: UEFA + major cups + top domestic leagues)
- `sampleSize`: Teams to sample per league (default: 3)
- `maxTeams`: Total teams limit (default: 30)

### 2.3 Validation Thresholds

| Metric | Threshold | Notes |
|--------|-----------|-------|
| Goals | 0.3 | **CRITICAL** - Must match closely |
| Corners | 1.0 | Acceptable variance for partial data |
| Cards | 0.8 | Yellow + Red combined |
| Fouls | 3.0 | Higher variance allowed |
| Offsides | 1.5 | Often missing in lower leagues |

### 2.4 What "Pass" Means

✅ **PASS** criteria:
- Goals API vs Cache diff ≤ 0.3 for all teams
- Goals DB vs Cache diff ≤ 0.3 (when DB has sufficient history)
- Other metrics (corners, cards, fouls, offsides) may have minor differences or be missing

❌ **FAIL** criteria:
- Any team with goals diff > 0.3
- Missing goals data from API or cache

### 2.5 Sample Output

```json
{
  "success": true,
  "leagues_processed": 9,
  "teams_checked": 27,
  "teams_with_failures": 0,
  "thresholds": {
    "goals": 0.3,
    "corners": 1.0,
    "cards": 0.8,
    "fouls": 3.0,
    "offsides": 1.5
  },
  "summary": {
    "api_vs_cache": {
      "goals": { "max_diff": 0.12, "failures": 0, "comparisons": 27 },
      "corners": { "max_diff": 0.4, "failures": 0, "comparisons": 24 }
    }
  },
  "samples": [
    {
      "league_id": 2,
      "team_id": 40,
      "team_name": "Liverpool",
      "metrics": [
        {
          "name": "goals",
          "api": 2.40,
          "cache": 2.40,
          "db": 2.40,
          "acceptable": true
        }
      ]
    }
  ]
}
```

### 2.6 Audit Logs

All audit runs are logged to `optimizer_run_logs` with:
- `run_type`: `'stats-consistency-audit'`
- `scanned`: Number of teams checked
- `failed`: Number of teams with any metric exceeding threshold
- `notes`: Summary of goals failures

```sql
-- View recent audit runs
SELECT 
  started_at,
  scanned,
  failed,
  duration_ms,
  notes
FROM optimizer_run_logs
WHERE run_type = 'stats-consistency-audit'
ORDER BY started_at DESC
LIMIT 10;
```

---

## 3. Stats Pipeline Architecture

### 3.1 Source of Truth

**API-Football** is the source of truth via `computeLastFiveAverages()` in `_shared/stats.ts`:
- Fetches last 20 FT fixtures for a team
- Selects 5 most recent completed matches
- Per-metric partial data averaging (goals always, others if available)

### 3.2 Pipeline Components

| Component | Schedule | Purpose |
|-----------|----------|---------|
| `stats-refresh-batch` | Every 10 min | Updates `stats_cache` (25 teams/batch) |
| `fixtures-history-backfill` | Every 6 hours | Imports historical data to `fixture_results` |
| `warmup-optimizer` | Every 30 min | Generates `optimized_selections` |
| `stats-consistency-audit` | On-demand | Verifies data consistency |

### 3.3 GOALS-FIRST Philosophy

**Goals are MANDATORY** - fixture is invalid if goals sample_size < 3:
- All tools (`analyze-fixture`, `filterizer-query`, `generate-ticket`) validate via `validateFixtureStats()`
- Fixtures without valid goals data are blocked
- CRITICAL violations only apply to GOALS metric

**Other metrics are NICE-TO-HAVE**:
- Missing corners/cards/fouls/offsides do NOT block fixtures
- Frontend shows "Not available" for missing metrics
- Per-metric availability tracked in validation response

---

## 4. Integrity Validation

### 4.1 Shared Module: `_shared/stats_integrity.ts`

- `validateFixtureStats(supabase, homeTeamId, awayTeamId)` - Single fixture validation
- `validateFixturesBatch(supabase, fixtures)` - Batch validation
- Returns rich details with per-metric availability

### 4.2 Tool Integrations

**Fixture Analyzer** (`analyze-fixture`):
- Returns `stats_available: false` if integrity fails
- Includes per-metric availability flags
- Frontend shows "Not available" for missing metrics

**Filterizer** (`filterizer-query`):
- Drops fixtures failing GOALS integrity checks
- Logs: `[STATS_INTEGRITY_FAIL] fixture X – reason Y – DROPPED`

**Ticket Creator** (`generate-ticket`):
- Same GOALS-first integrity checks as Filterizer
- Ensures all selections have reliable goals data

---

## 5. Diagnostic Queries

### 5.1 Upcoming Teams Coverage

```sql
WITH upcoming_teams AS (
  SELECT DISTINCT (teams_home->>'id')::int AS team_id FROM fixtures
  WHERE timestamp >= EXTRACT(EPOCH FROM NOW())
    AND timestamp <= EXTRACT(EPOCH FROM NOW() + INTERVAL '7 days')
  UNION
  SELECT DISTINCT (teams_away->>'id')::int AS team_id FROM fixtures
  WHERE timestamp >= EXTRACT(EPOCH FROM NOW())
    AND timestamp <= EXTRACT(EPOCH FROM NOW() + INTERVAL '7 days')
)
SELECT 
  COUNT(*) AS total,
  COUNT(sc.team_id) AS has_cache,
  ROUND(100.0 * COUNT(sc.team_id) / COUNT(*), 1) AS coverage_pct
FROM upcoming_teams ut
LEFT JOIN stats_cache sc ON sc.team_id = ut.team_id;
```

### 5.2 UEFA & Cups Fixture Results Coverage

```sql
SELECT 
  f.league_id,
  COUNT(DISTINCT f.id) AS total_fixtures,
  COUNT(DISTINCT fr.fixture_id) AS with_results,
  ROUND(100.0 * COUNT(DISTINCT fr.fixture_id) / NULLIF(COUNT(DISTINCT f.id), 0), 1) AS pct
FROM fixtures f
LEFT JOIN fixture_results fr ON fr.fixture_id = f.id
WHERE f.league_id IN (2, 3, 848, 45, 48, 143, 137, 81, 66)
  AND f.status IN ('FT', 'AET', 'PEN')
GROUP BY f.league_id
ORDER BY pct DESC;
```

### 5.3 Active CRITICAL Goals Violations

```sql
SELECT COUNT(*) AS critical_goals_violations
FROM stats_health_violations
WHERE severity = 'critical'
  AND metric = 'goals'
  AND resolved_at IS NULL;
```

---

## 6. Guarantees

1. **Fixture Analyzer, Filterizer, and Ticket Creator NEVER show unreliable stats**
   - All tools validate via `validateFixtureStats()` / `validateFixturesBatch()`
   - Fixtures without valid goals data are blocked
   
2. **Goals are always 100% correct** when shown
   - Computed from last 5 finished fixtures via API-Football
   - sample_size >= 3 required to pass validation
   
3. **Partial metrics handled gracefully**
   - If corners/cards/fouls/offsides unavailable, fixture is NOT blocked
   - Frontend shows "Not available" for missing metrics

4. **Data freshness automated**
   - `stats-refresh-batch-cron`: every 10 minutes
   - `fixtures-history-backfill-cron`: every 6 hours
   - `warmup-optimizer-cron`: every 30 minutes

---

## 7. Known Limitations

1. **API-Football Coverage Gaps**
   - Some lower leagues have incomplete statistics
   - Cup early rounds often lack detailed stats
   - **Solution**: Per-metric availability flags allow goals-only fixtures

2. **Cache Population Timing**
   - Full refresh of 3500+ teams takes ~24 hours
   - Stats-refresh processes ~150 teams/hour

3. **DB vs API Discrepancy**
   - `fixture_results` may have less history than API-Football
   - Audit validates only when DB has sufficient history (≥5 fixtures)

---

*Last Updated: 2025-12-04*
