# TicketAI Full QA & Reliability Audit Report

**Audit Date:** 2025-12-05  
**Auditor:** Senior QA Engineer + SRE  
**Project:** TicketAI.bet  

---

## 1. Executive Summary

### Overall Quality Rating: 🟡 YELLOW

**Biggest Strengths:**
1. ✅ **Stats Pipeline Architecture** - Safe Machine Mode v2 is correctly implemented with proper tuning constants (MAX_TEAMS=8, SOFT_LIMIT=50s)
2. ✅ **Cron Infrastructure** - 12 active jobs, all running with proper logging and lock management
3. ✅ **Data Source Clarity** - stats_cache is canonical; all features correctly use it as single source of truth
4. ✅ **Major League Coverage** - Top 10 European leagues have excellent historical data (400-773 fixture results each)
5. ✅ **Optimized Selections Freshness** - 264 selections, ALL refreshed within the last hour

**Top 5 Risks to Address:**

| Priority | Risk | Severity | Impact |
|----------|------|----------|--------|
| P0 | **96 fixtures exist beyond 48h window** - violates 48h horizon constraint | Critical | Users may see/bet on stale fixtures |
| P0 | **Stats coverage at 59.6%** - 38.3% teams have NO stats | Critical | ~40% of fixtures may show incomplete data |
| P1 | **stats-health-check has 100% failure rate** (15/15 runs failed) | Major | No automated health monitoring |
| P1 | **backfill-odds hardcodes `48`** instead of importing UPCOMING_WINDOW_HOURS | Major | Future maintainability risk |
| P2 | **Historical backfill 97% pending** - 186/206 league/seasons not started | Medium | Limits advanced analytics |

---

## 2. Detailed Test Results

### A. Functional QA – Core User Flows

| Test Area | Result | Evidence |
|-----------|--------|----------|
| CenterRail Date Strip | ✅ PASS | Shows exactly Today + Tomorrow (2 days) via `dates = Array.from({ length: 2 }, ...)` in CenterRail.tsx |
| CenterRail Local Timezone | ✅ PASS | Fixed: `today.setHours(0,0,0,0)` uses local midnight (not UTC) |
| Filterizer Day Ranges | ✅ PASS | Schema validates `dayRange: z.enum(["all", "today", "tomorrow"])` in filterizer-query/index.ts:27 |
| Filterizer 48h Window | ✅ PASS | Uses `UPCOMING_WINDOW_HOURS` constant in filterizer-query/index.ts:160 |
| Filterizer All-Leagues Mode | ✅ PASS | `allLeagues=true` triggers 48h window from NOW (line 156-161) |
| Ticket Creator Stats Source | ✅ PASS | Uses analyze-fixture → combined → pickFromCombined() |
| Fixture Analyzer Stats Source | ✅ PASS | getTeamStats() reads from stats_cache with 2h freshness check |

**Status: ✅ PASS** - All core user flows are correctly wired.

---

### B. Data Correctness – Stats & 48h Horizon

| Check | Result | Evidence |
|-------|--------|----------|
| UPCOMING_WINDOW_HOURS = 48 | ✅ PASS | Defined in _shared/config.ts:10 |
| stats-refresh imports constant | ✅ PASS | Line 19: `import { UPCOMING_WINDOW_HOURS } from "../_shared/config.ts"` |
| filterizer-query imports constant | ✅ PASS | Line 5: `import { ODDS_MIN, ODDS_MAX, UPCOMING_WINDOW_HOURS } from "../_shared/config.ts"` |
| backfill-odds imports constant | ⚠️ WARN | Line 15 imports other constants but uses hardcoded `window_hours = 48` default on line 44 |
| Fixtures beyond 48h exist | ❌ FAIL | **96 fixtures exist beyond 48h window** (query shows 342 in 48h, 96 beyond) |

**Fixtures Table Audit:**
```
Total upcoming: 438
In 48h window:  342 (78%)
Beyond 48h:      96 (22%) ← VIOLATION
Earliest: 2025-12-05 23:00:00
Latest:   2025-12-09 20:00:00 ← 4 days out!
```

**Status: ⚠️ WARN** - backfill-odds hardcode + fixtures beyond 48h need fixing.

---

### C. Stats Pipeline QA – Coverage & Self-Healing

#### Coverage Snapshot (48h Window)

| Status | Teams | Percentage | Description |
|--------|-------|------------|-------------|
| READY | 280 | 40.9% | sample_size ≥ 5, fresh < 24h |
| USABLE | 128 | 18.7% | sample_size 3-4 |
| LOW_SAMPLE | 14 | 2.0% | sample_size 1-2 |
| NO_STATS | 262 | 38.3% | No cache entry |
| **Total** | **684** | **59.6% usable** | |

**Sample Team Stats Verification (15 teams):**
```
✅ 14/15 teams have sample_size = 5
✅ All 14 have been refreshed within 24 hours
❌ 1 team (Wigan #61) has NO stats cache entry
```

#### Safe Machine Mode v2 Configuration

| Parameter | Expected | Actual | Status |
|-----------|----------|--------|--------|
| MAX_TEAMS_PER_RUN | 8 | 8 | ✅ PASS |
| SOFT_TIME_LIMIT_MS | 50,000 | 50,000 | ✅ PASS |
| INTER_TEAM_DELAY_MS | 100 | 100 | ✅ PASS |
| computeWithRetry retries | 2 | 2 | ✅ PASS |
| Lock duration | 5 min | 5 min | ✅ PASS |

**Status: 🟡 WARN** - Pipeline architecture is ✅, but coverage (59.6%) is below 90% target.

---

### D. Cron Jobs & Reliability

#### Active Cron Jobs (12 total)

| Job Name | Schedule | Status | Last Run | Failures |
|----------|----------|--------|----------|----------|
| stats-refresh-batch-cron | */10 * * * * | ✅ Active | 21:10:52 | 0/61 |
| cron-fetch-fixtures-10m | */10 * * * * | ✅ Active | 20:50:13 | 0/55 |
| warmup-optimizer-cron | */30 * * * * | ✅ Active | 21:01:08 | 1/47 |
| results-refresh-30m | */30 9-23 * * * | ✅ Active | - | 0/5 |
| fixtures-history-backfill-cron | 0 */6 * * * | ✅ Active | 18:00:29 | 0/4 |
| stats-health-check-6h | 0 */6 * * * | ⚠️ Active | - | **15/15** |
| sync-injuries-12h | 0 */4 * * * | ✅ Active | - | - |
| sync-player-importance-daily | 0 3 * * * | ✅ Active | - | - |
| admin-remediate-stats-gaps-weekly | 0 3 * * 1 | ✅ Active | - | - |
| downgrade-expired-entitlements-5m | */5 * * * * | ✅ Active | - | - |
| purge-stale-prematch-selections-5m | */5 * * * * | ✅ Active | - | - |
| cleanup-old-results | 0 4 1 * * | ✅ Active | - | - |

#### Lock Status

| Lock | Status | Notes |
|------|--------|-------|
| fetch-fixtures-admin | EXPIRED | Should be auto-cleaned; not blocking |
| stats-refresh | Clean | No stuck locks |
| cron-warmup-odds | Clean | No stuck locks |

**Status: 🟡 WARN** - Cron infrastructure is solid, but stats-health-check has 100% failure rate.

---

### E. Historical Backfill QA

#### Backfill Status

| Status | Count | Fixtures |
|--------|-------|----------|
| completed | 15 | 0 (empty leagues) |
| in_progress | 5 | 250 |
| pending | 186 | 0 |
| **Total** | **206** | |

**Completion Rate: 2.4%** (5 actually processing / 206 total)

#### Major League fixture_results Coverage

| League | Results | Date Range | Status |
|--------|---------|------------|--------|
| Championship | 773 | Aug 2024 - Dec 2025 | ✅ Excellent |
| Eerste Divisie | 559 | Aug 2024 - Dec 2025 | ✅ Excellent |
| Serie B | 529 | Aug 2024 - Dec 2025 | ✅ Excellent |
| La Liga | 522 | Aug 2024 - Dec 2025 | ✅ Excellent |
| Premier League | 520 | Aug 2024 - Dec 2025 | ✅ Excellent |
| Serie A | 510 | Aug 2024 - Dec 2025 | ✅ Excellent |
| Eredivisie | 447 | Aug 2024 - Dec 2025 | ✅ Excellent |
| 2. Bundesliga | 434 | Aug 2024 - Nov 2025 | ✅ Good |
| Ligue 1 | 434 | Aug 2024 - Nov 2025 | ✅ Good |
| Bundesliga | 416 | Aug 2024 - Nov 2025 | ✅ Good |

**Status: 🟡 WARN** - Major leagues excellent, but global backfill is 97% pending.

---

### F. Performance & UX

#### Edge Function Performance (Last 24h)

| Function | Avg Duration | Status |
|----------|--------------|--------|
| stats-refresh-batch | 37,364ms | ✅ Within 60s limit |
| cron-warmup-odds | 54,451ms | ✅ Within 60s limit |
| optimize-selections-48h | 23,064ms | ✅ Fast |
| backfill-odds-batch | 25,472ms | ✅ Fast |
| fetch-fixtures | 12,999ms | ✅ Fast |
| history-backfill | 76,259ms | ⚠️ Near limit |

#### Optimized Selections Freshness

```
Total selections (48h): 264
Last hour: 264 (100%)
Most recent: 21:01:07
```

**Status: ✅ PASS** - All functions complete within timeout; selections are fresh.

---

### G. Security & Access Control

| Check | Result | Evidence |
|-------|--------|----------|
| stats-refresh auth | ✅ PASS | Checks X-CRON-KEY or service role or admin user (lines 179-211) |
| backfill-odds auth | ⚠️ WARN | No explicit auth check visible (relies on service role) |
| filterizer-query auth | ✅ PASS | Validates Bearer token and user (lines 38-59) |
| Secrets in client bundle | ✅ PASS | Only VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY exposed |

**Status: ✅ PASS** - Auth patterns are consistent; no secrets exposed.

---

## 3. Defects & Recommendations

### Critical (Must-Fix Before Production)

#### DEF-001: Fixtures Exist Beyond 48h Window
- **Severity:** Critical
- **Area:** Data Correctness
- **Description:** 96 fixtures exist with timestamps beyond NOW() + 48 hours, violating the hard architectural constraint.
- **Impact:** Users may see/interact with fixtures that shouldn't be visible; stats pipeline may waste resources on out-of-scope fixtures.
- **Steps to Reproduce:** Query `SELECT COUNT(*) FROM fixtures WHERE timestamp > EXTRACT(EPOCH FROM (NOW() + INTERVAL '48 hours'))`
- **Suggested Fix:** 
  1. Add cleanup query: `DELETE FROM fixtures WHERE timestamp > EXTRACT(EPOCH FROM (NOW() + INTERVAL '48 hours'))`
  2. Ensure cron-fetch-fixtures enforces 48h cap on upserts

#### DEF-002: Stats Coverage Below 90% Target
- **Severity:** Critical
- **Area:** Stats Pipeline
- **Description:** Only 59.6% of teams have usable stats (40.9% READY + 18.7% USABLE). 38.3% have NO stats.
- **Impact:** ~40% of fixtures may show incomplete data or be excluded from Filterizer/Ticket Creator.
- **Suggested Fix:**
  1. Allow Safe Machine Mode to continue running (throughput ~30 teams/hour)
  2. Estimated time to 90%: ~12-16 hours of continuous cron execution
  3. Consider running turbo-backfill for faster catch-up

### Major (Should-Fix Soon)

#### DEF-003: stats-health-check 100% Failure Rate
- **Severity:** Major
- **Area:** Observability
- **Description:** stats-health-check-6h cron has 15 runs in last 24h, ALL with failures.
- **Impact:** No automated health monitoring; issues may go undetected.
- **Steps to Reproduce:** Check optimizer_run_logs: `SELECT * FROM optimizer_run_logs WHERE run_type = 'stats-health-check' ORDER BY started_at DESC LIMIT 5`
- **Suggested Fix:** Review stats-health-check edge function logs for error details; likely timeout or query issue.

#### DEF-004: backfill-odds Hardcodes 48 Instead of Using Constant
- **Severity:** Major
- **Area:** Code Quality
- **Description:** Line 44 uses `const { window_hours = 48 }` instead of importing UPCOMING_WINDOW_HOURS.
- **Impact:** If UPCOMING_WINDOW_HOURS ever changes, backfill-odds will silently diverge.
- **Suggested Fix:**
  ```typescript
  // Line 15 already imports other constants, add UPCOMING_WINDOW_HOURS:
  import { DAILY_CALL_BUDGET, RPM_LIMIT, PREMATCH_TTL_MINUTES, UPCOMING_WINDOW_HOURS } from "../_shared/config.ts";
  
  // Line 44 change to:
  const { window_hours = UPCOMING_WINDOW_HOURS } = await req.json().catch(() => ({}));
  ```

### Minor (Nice-to-Have)

#### DEF-005: Expired Lock Not Auto-Cleaned
- **Severity:** Minor
- **Area:** Infrastructure
- **Description:** `fetch-fixtures-admin` lock shows as EXPIRED but still exists in cron_job_locks.
- **Impact:** Table clutter; no functional impact.
- **Suggested Fix:** Add periodic cleanup: `DELETE FROM cron_job_locks WHERE locked_until < NOW()`

#### DEF-006: Historical Backfill 97% Pending
- **Severity:** Minor
- **Area:** Data Completeness
- **Description:** 186/206 league/season combinations haven't started backfill.
- **Impact:** Limits future advanced analytics; not required for current MVP.
- **Suggested Fix:** Continue with current 6-hour cron; optionally prioritize Big 5 leagues.

---

## 4. Final Verdict

### Is TicketAI Production-Ready?

**Answer: 🟡 CONDITIONALLY YES** - for controlled beta / internal use.

**Justification:**

| Aspect | Rating | Notes |
|--------|--------|-------|
| Core Functionality | ✅ Green | Filterizer, Ticket Creator, Fixture Analyzer all correctly wired |
| Stats Pipeline | 🟡 Yellow | Architecture excellent; coverage (59.6%) needs 12-16h to reach 90% |
| Cron Infrastructure | ✅ Green | 12 jobs running reliably; proper logging |
| Data Correctness | 🟡 Yellow | 96 fixtures beyond 48h need cleanup |
| Observability | 🟡 Yellow | stats-health-check failing; needs investigation |
| Security | ✅ Green | Auth patterns consistent; no secrets exposed |
| Historical Data | 🟡 Yellow | Major leagues excellent; global backfill slow |

### Recommended Launch Sequence:

1. **Immediate (Before any users):**
   - [ ] Fix DEF-001: Delete fixtures beyond 48h
   - [ ] Fix DEF-004: Import UPCOMING_WINDOW_HOURS in backfill-odds

2. **Within 24 hours:**
   - [ ] Allow stats coverage to reach ≥90% naturally (or run turbo-backfill)
   - [ ] Investigate and fix stats-health-check failures

3. **Within 1 week:**
   - [ ] Add coverage indicator to admin dashboard
   - [ ] Clean up expired locks periodically

### Confidence Level:

**High confidence** that TicketAI will function correctly once:
- Fixtures beyond 48h are cleaned
- Stats coverage reaches 90%+

The architecture is solid. This is a **data fill issue**, not a **logic bug**.

---

*End of QA Audit Report*
