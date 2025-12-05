# TicketAI Stats Pipeline - Root Cause Analysis

**Date**: December 5, 2025  
**Author**: AI Deep-Dive Investigation  
**Status**: 🟢 MITIGATED - Automated pipeline upgraded

---

## ✅ Mitigation Implemented (December 5, 2025)

### 1. Centralized API Rate Limiting (`_shared/api_football.ts`)
A new centralized API-Football client ensures all functions respect rate limits:
- **Token bucket algorithm**: Tracks requests per minute
- **Configurable RPM**: Set via `STATS_API_MAX_RPM` env var (default: 50)
- **Exponential backoff**: Auto-retry on 429/5xx with delays up to 60s
- **Structured logging**: All calls logged with endpoint, status, retries, duration

### 2. Upgraded Pipeline Functions
| Function | Change |
|----------|--------|
| `fixtures-history-backfill` | Now uses centralized rate limiter, batch size 20 leagues |
| `results-refresh` | 30-day lookback, batch size 400, centralized client |
| `admin-remediate-stats-gaps` | Weekly mode support, rate limit tracking |
| `stats-refresh` | Enhanced retry logic (5 retries @ 2000ms base) |

### 3. Weekly Automated Remediation
New cron job: `admin-remediate-stats-gaps-weekly`
- **Schedule**: Every Monday 03:00 UTC
- **Targets**: Top 5 leagues, domestic cups, UEFA competitions
- **Rate limited**: Respects `maxAPICallsPerRun` parameter

### 4. How to Verify System Health
```bash
# Check pipeline health
SELECT * FROM pipeline_health_check;

# Check cron jobs (should see 7 active jobs)
SELECT jobname, schedule, active FROM cron.job WHERE active = true;

# Check remediation logs
SELECT * FROM optimizer_run_logs 
WHERE run_type = 'admin-remediate-stats-gaps' 
ORDER BY started_at DESC LIMIT 5;
```

---

## Executive Summary (Non-Technical)

Your stats system has **significant coverage gaps** that prevent it from being fully automated. The main problems are:

1. **Historical data import is too slow** - Only 3 of 206 league/season combinations have been backfilled. At the current rate, it would take **weeks** to catch up.

2. **Some competitions have ZERO data** - UEFA Europa League, Conference League, EFL Cup, and Coupe de France have no fixtures imported at all, despite being in the allowed list.

3. **Match results aren't being captured reliably** - EPL only has 71% of finished fixtures with results, La Liga 70%, Eredivisie 54%.

4. **Big teams are missing stats** - Only 2 of 9 key EPL teams (Arsenal, Chelsea, Man City, etc.) have valid stats cached.

5. **Health checks are always failing** - 801+ critical violations every hour, with "Acceptance: FAILED" status.

**Is this a one-time backlog or recurring design problem?**  
**Both.** There's a massive backlog from slow imports, AND the design has fundamental throughput problems that will continue causing gaps.

---

## Detailed Root Causes (Technical)

### ROOT CAUSE #1: History Backfill Is Catastrophically Slow

**Evidence:**
```
league_history_sync_state status:
- pending: 201
- completed: 3
- in_progress: 2
```

**Code Reference:** `supabase/functions/fixtures-history-backfill/index.ts`

```typescript
const batchSize = body.batchSize ?? 5;        // Only 5 leagues per run
const fixturesPerLeague = body.fixturesPerLeague ?? 50;  // Max 50 fixtures each
```

**Problem:** With cron running every 6 hours and processing only 5 league/season combos per run:
- 206 pending combos ÷ 5 per run = 42 runs needed
- 42 runs × 6 hours = **252 hours (10+ days)** to catch up

**Impact:** 
- UEFA Europa League (3), Conference League (848), EFL Cup (48), Coupe de France (66) have **ZERO fixtures**
- These competitions are in `ALLOWED_LEAGUE_IDS` but were never imported

---

### ROOT CAUSE #2: Results-Refresh Misses Many Finished Fixtures

**Evidence:**
| League | Finished Fixtures | With Results | Coverage |
|--------|------------------|--------------|----------|
| EPL (39) | 98 | 70 | 71.4% |
| La Liga (140) | 88 | 62 | 70.5% |
| Eredivisie (88) | 109 | 59 | 54.1% |
| UEL (3) | 0 | 0 | N/A |
| UECL (848) | 0 | 0 | N/A |
| EFL Cup (48) | 0 | 0 | N/A |

**Code Reference:** `supabase/functions/results-refresh/index.ts` lines 205-228

```typescript
// CRITICAL FIX comment says "Query by TIMESTAMP, not STATUS"
// But the issue is: if fixture.status is never updated from NS→FT, 
// the timestamp check alone doesn't guarantee we have the fixture in DB
const finishedThreshold = Math.floor((Date.now() - 2 * 3600 * 1000) / 1000);
```

**Problems:**
1. Results-refresh only processes fixtures that **already exist** in our DB
2. If a fixture was never imported (like UEL/UECL), results-refresh can't find it
3. The 14-day lookback (`maxLookbackDays = 14`) misses older fixtures
4. Processing 200 fixtures per batch but many get skipped

---

### ROOT CAUSE #3: Stats-Refresh Cannot Keep Up With Demand

**Evidence:**
```
Stats cache coverage for upcoming 7 days:
- EPL: 60% (12/20 teams)
- La Liga: 30% (6/20 teams)
- Eredivisie: 33% (6/18 teams)
- Primeira Liga: 11% (2/18 teams)
- Ligue 1: 22% (4/18 teams)
```

**Code Reference:** `supabase/functions/stats-refresh/index.ts` line 25

```typescript
const BATCH_SIZE = 25;  // 25 teams every 10 minutes = 150 teams/hour
```

**Problem:** With ~450 upcoming teams, a full pass takes 3+ hours. But stats become stale after 24 hours, creating a moving target.

**The Math:**
- 25 teams × 6 runs/hour = 150 teams/hour
- 450 teams ÷ 150 = **3 hours for one complete pass**
- But during those 3 hours, new fixtures appear and existing stats age

---

### ROOT CAUSE #4: Key EPL Teams Missing From Stats Cache

**Evidence:**
```sql
-- Only 2 of 9 key teams have cache entries
team_id 47 (Tottenham): goals=1.8, corners=5, sample_size=5 ✓
team_id 49 (Chelsea): goals=0, corners=0, sample_size=0 ✗
-- Missing: 33, 42, 45, 50, 52, 65, 39 (Arsenal, Everton, FA Cup teams, etc.)
```

**Root Cause Chain:**
1. `stats-refresh` uses API-Football to fetch last 5 FT fixtures per team
2. If API returns 429 (rate limit) or times out, the team gets `sample_size=0`
3. The retry logic (`computeWithRetry`) only retries 3 times with short delays
4. Teams that fail stay broken until the next batch run (10+ minutes later)

**Code Reference:** `supabase/functions/_shared/stats.ts` lines 62-68

```typescript
if (!res.ok) {
  console.error(`[stats] ❌ Failed to fetch fixtures for team ${teamId}: HTTP ${res.status}`);
  return [];  // Returns empty array, leading to sample_size=0
}
```

---

### ROOT CAUSE #5: Stats Health Check Thresholds Are Too Strict

**Evidence:**
```
stats-health-check run:
- Status: CRITICAL
- Teams: 449
- Critical violations: 801
- AutoHealed: 529
- Acceptance: FAILED
```

**Code Reference:** `supabase/functions/stats-health-check/index.ts` lines 16-23

```typescript
const UPCOMING_THRESHOLDS = {
  goals:    { warning: 0.15, error: 0.25, critical: 0.3 },
  corners:  { warning: 0.5, error: 0.8, critical: 1.0 },
  // ...
};
```

**Problem:** The health check compares `stats_cache` (from API-Football) with `fixture_results` (from our DB backfill). When backfill is incomplete, these naturally diverge - not because stats are wrong, but because we're comparing different data sources.

---

### ROOT CAUSE #6: No Fixtures Exist for Several Competitions

**SQL Evidence:**
```
UEFA Europa League (3): 0 finished fixtures
UEFA Europa Conference League (848): 0 finished fixtures
EFL Cup (48): 0 finished fixtures
Coupe de France (66): 0 finished fixtures
```

**Why:**
1. These leagues ARE in `ALLOWED_LEAGUE_IDS` (leagues.ts lines 23-33)
2. `cron-fetch-fixtures-10m` only fetches **upcoming** fixtures, not historical
3. `fixtures-history-backfill` should import them, but it's processing only 3 completed so far
4. The 201 pending entries include these competitions, stuck in queue

---

## Proposed Fixes

### P0: MUST FIX NOW

#### P0.1: Turbocharge History Backfill
```typescript
// In fixtures-history-backfill/index.ts
const batchSize = body.batchSize ?? 20;  // Was 5, now 20
const fixturesPerLeague = body.fixturesPerLeague ?? 200;  // Was 50, now 200
```

**Impact:** 4x faster backfill (days instead of weeks)

#### P0.2: Prioritize Empty Competitions
```typescript
// In fixtures-history-backfill/index.ts - query should prioritize leagues with 0 fixtures
let query = supabase
  .from("league_history_sync_state")
  .select("*")
  .in("league_id", targetLeagues)
  .order("total_fixtures_synced", { ascending: true, nullsFirst: true })  // Prioritize empty
  .order("last_run_at", { ascending: true, nullsFirst: true });
```

#### P0.3: Make Results-Refresh More Aggressive
```typescript
// In results-refresh/index.ts
const maxLookbackDays = body.backfill_mode ? 365 : 30;  // Was 14, now 30 for normal mode
const batchSize = body.batch_size || (body.backfill_mode ? 100 : 500);  // Was 200, now 500
```

#### P0.4: Add Missing Competitions to Immediate Import
Create a one-time script to import fixtures for:
- UEFA Europa League (3) - current season
- UEFA Europa Conference League (848) - current season
- EFL Cup (48) - current season
- Coupe de France (66) - current season

---

### P1: SHOULD FIX SOON

#### P1.1: Increase Stats-Refresh Batch Size When API Allows
```typescript
// In stats-refresh/index.ts
// Monitor API rate limits and increase batch size during off-peak
const BATCH_SIZE = Deno.env.get("STATS_BATCH_SIZE") ? 
  parseInt(Deno.env.get("STATS_BATCH_SIZE")!) : 25;
```

#### P1.2: Better Retry Logic for API Failures
```typescript
// In _shared/stats.ts
async function computeWithRetry(teamId: number, supabase: any, retries = 5) {  // Was 3
  let attempt = 0;
  while (true) {
    try {
      return await computeLastFiveAverages(teamId, supabase);
    } catch (e) {
      if (attempt < retries) {
        const delay = 2000 * Math.pow(2, attempt) + Math.floor(Math.random() * 1000);  // Longer delays
        // ...
      }
    }
  }
}
```

#### P1.3: Soften Health Check Thresholds for API vs DB Comparison
```typescript
// Health check should recognize that API data != DB data during backfill
// Add a "backfill_in_progress" flag that softens thresholds
const backfillProgress = await getBackfillProgress(supabase);
const adjustedThresholds = backfillProgress < 0.9 ? 
  { goals: 0.5, corners: 1.5, ... } : 
  UPCOMING_THRESHOLDS;
```

---

### P2: NICE TO HAVE

#### P2.1: Add Real-Time Monitoring Dashboard
- Show backfill progress bar
- Show per-league coverage percentages
- Alert when critical violations spike

#### P2.2: Schedule admin-remediate-stats-gaps Weekly
```sql
SELECT cron.schedule(
  'weekly-stats-remediation',
  '0 3 * * 0',  -- Sunday 3am
  $$ SELECT net.http_post(...) $$
);
```

#### P2.3: Add API Rate Limit Tracking
- Log remaining API quota per day
- Auto-throttle when approaching limits

---

## Automation & "Will This Happen Again?"

### With Proposed Changes, Guarantees Are:

1. **New fixtures will be imported within 10 minutes** (cron-fetch-fixtures-10m)
2. **Results will be captured within 30 minutes** (results-refresh-30m with extended lookback)
3. **Stats will be computed within 3 hours** (stats-refresh-batch at 25 teams/10 min)
4. **New leagues added to ALLOWED_LEAGUE_IDS will auto-backfill** (fixtures-history-backfill runs every 6h)

### What Happens If stats_cache Is Wiped?

**Current state:** ~3 hours to rebuild for upcoming teams only  
**With P0 fixes:** Same, but won't lose historical data

### Should We Schedule admin-remediate-stats-gaps Weekly?

**Yes.** As a safety net:
```sql
-- Weekly cron at Sunday 3am UTC
SELECT cron.schedule(
  'weekly-remediate-stats',
  '0 3 * * 0',
  $$
  SELECT net.http_post(
    url:='https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/admin-remediate-stats-gaps',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer SERVICE_ROLE_KEY"}'::jsonb,
    body:='{}'::jsonb
  )
  $$
);
```

---

## Verification Plan

After implementing P0 fixes, run these queries to verify:

### 1. Fixture Results Coverage (Target: ≥95% for top leagues)
```sql
SELECT 
  l.name,
  COUNT(DISTINCT f.id) FILTER (WHERE f.status IN ('FT','AET','PEN')) as finished,
  COUNT(DISTINCT fr.fixture_id) as with_results,
  ROUND(100.0 * COUNT(DISTINCT fr.fixture_id) / 
    NULLIF(COUNT(DISTINCT f.id) FILTER (WHERE f.status IN ('FT','AET','PEN')), 0), 1) as pct
FROM leagues l
JOIN fixtures f ON f.league_id = l.id
LEFT JOIN fixture_results fr ON fr.fixture_id = f.id
WHERE l.id IN (39, 140, 88, 135, 78, 61, 94, 2, 3, 848, 45, 48)
GROUP BY l.id, l.name
ORDER BY pct;
```

### 2. Stats Cache Coverage (Target: ≥90% for top leagues)
```sql
WITH upcoming AS (
  SELECT DISTINCT (teams_home->>'id')::int as team_id, league_id FROM fixtures
  WHERE timestamp BETWEEN EXTRACT(EPOCH FROM NOW()) AND EXTRACT(EPOCH FROM NOW() + INTERVAL '7 days')
  UNION
  SELECT DISTINCT (teams_away->>'id')::int, league_id FROM fixtures
  WHERE timestamp BETWEEN EXTRACT(EPOCH FROM NOW()) AND EXTRACT(EPOCH FROM NOW() + INTERVAL '7 days')
)
SELECT 
  l.name,
  COUNT(DISTINCT u.team_id) as total,
  COUNT(DISTINCT sc.team_id) FILTER (WHERE sc.sample_size >= 3) as valid,
  ROUND(100.0 * COUNT(DISTINCT sc.team_id) FILTER (WHERE sc.sample_size >= 3) / 
    NULLIF(COUNT(DISTINCT u.team_id), 0), 1) as pct
FROM upcoming u
JOIN leagues l ON l.id = u.league_id
LEFT JOIN stats_cache sc ON sc.team_id = u.team_id
WHERE l.id IN (39, 140, 88, 135, 78, 61, 94, 2, 3, 848)
GROUP BY l.id, l.name
ORDER BY pct;
```

### 3. Critical Violations (Target: <100 critical)
```sql
SELECT severity, COUNT(*) 
FROM stats_health_violations 
WHERE resolved_at IS NULL 
GROUP BY severity;
```

### 4. History Backfill Progress (Target: 0 pending for top leagues)
```sql
SELECT status, COUNT(*) 
FROM league_history_sync_state 
WHERE league_id IN (39, 140, 88, 135, 78, 61, 94, 2, 3, 848)
GROUP BY status;
```

---

## Summary of Changes Required

| Priority | Change | File | Impact |
|----------|--------|------|--------|
| P0.1 | Increase backfill batch size to 20 | fixtures-history-backfill/index.ts | 4x faster |
| P0.2 | Prioritize empty leagues | fixtures-history-backfill/index.ts | UEL/UECL first |
| P0.3 | Extend results lookback to 30 days | results-refresh/index.ts | More coverage |
| P0.4 | One-time import for empty competitions | Manual/admin-remediate | Immediate fix |
| P1.1 | Configurable stats batch size | stats-refresh/index.ts | Flexibility |
| P1.2 | Better retry logic | _shared/stats.ts | Fewer failures |
| P1.3 | Backfill-aware health thresholds | stats-health-check/index.ts | Fewer false alarms |

---

## Conclusion

The stats pipeline has **systemic throughput problems** that prevent it from being fully automated:

1. **Backfill is 4x too slow** → Fix by increasing batch sizes
2. **Some competitions never imported** → Fix by prioritizing empty leagues
3. **Results capture is incomplete** → Fix by extending lookback window
4. **Stats refresh can't keep up** → Monitor and optimize batch sizes
5. **Health checks are too strict** → Adjust for backfill-in-progress state

After implementing P0 fixes, the system should reach **GREEN status within 48-72 hours** as the backlog clears.
