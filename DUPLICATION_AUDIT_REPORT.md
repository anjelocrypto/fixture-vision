# TicketAI Codebase Duplication Audit Report

**Date**: 2025-12-04  
**Auditor**: Senior TypeScript + Supabase Engineer  
**Scope**: Full repository scan for duplicate files, code blocks, schemas, cron jobs, and dead code

---

## Executive Summary

✅ **GOOD NEWS**: The codebase has a well-organized single-source-of-truth architecture for stats logic.  
⚠️ **FINDINGS**: A few areas need attention, primarily around **cron job cleanup** and **minor type redefinitions**.

| Area | Status | Risk Level |
|------|--------|------------|
| Stats Logic | ✅ Clean | Low |
| Edge Functions | ✅ Clean | Low |
| Type Definitions | ⚠️ Minor Duplication | Low |
| Cron Jobs | ⚠️ Legacy Jobs Exist | Medium |
| Dead Code | ✅ Clean | Low |

---

## 1. Duplicate Files Scan

### 1.1 Files by Name Pattern

**No duplicate files found** with suffixes like `_old`, `_copy`, `_backup`, `_v2`, `_bak`, `-old`, `-copy`.

### 1.2 Similar Purpose Files

| file_a | file_b | is_duplicate | usage_status | recommendation |
|--------|--------|--------------|--------------|----------------|
| `_shared/stats.ts` | `_shared/stats_db.ts` | **NO** | Both active, different purposes | **KEEP BOTH** - `stats.ts` uses API-Football, `stats_db.ts` uses local DB |
| `_shared/stats_integrity.ts` | `stats-health-check/index.ts` | **NO** | Both active, different purposes | **KEEP BOTH** - `stats_integrity.ts` is shared validation, `stats-health-check` is cron job |
| `analyze-fixture/index.ts` | None | Unique | Active | ✅ No duplicate |
| `FixtureStatsDisplay.tsx` | None | Unique | Active | ✅ No duplicate |

**Answer to Q1-Q3**: All files are actively used and serve distinct purposes. No files need deletion.

---

## 2. Duplicate/Near-Duplicate Code Blocks

### 2.1 Last-5 Averages Computation

**Location 1**: `supabase/functions/_shared/stats.ts` → `computeLastFiveAverages()`
- Fetches from **API-Football directly**
- Uses league coverage filtering
- Returns `Last5Result` type
- Used by: `stats-refresh`, `analyze-fixture`, `debug-team-stats`

**Location 2**: `supabase/functions/_shared/stats_db.ts` → `recomputeTeamStatsFromDB()`
- Computes from **local DB** (fixtures + fixture_results)
- Returns `DBStatsResult` type
- Used by: `stats-health-check` (for validation only)

**Q5: Are they doing the same thing?**  
**NO** - They serve different purposes:
- `computeLastFiveAverages`: Source of truth for production stats (fresh API data)
- `recomputeTeamStatsFromDB`: Validation/audit tool to compare against local DB

**Q6: Should there be a single helper?**  
**NO** - Having both is intentional:
- Production uses API-Football for freshest data
- Validation uses DB to check data integrity

**Q7: Risk if one updated and not the other?**  
**LOW** - They serve different purposes and output different types. The key contract is that both should compute similar averages when data is complete.

### 2.2 Sample Size Validation

**Location 1**: `_shared/stats_integrity.ts` → `MIN_SAMPLE_SIZE = 3`
**Location 2**: `_shared/stats_db.ts` → `MIN_FIXTURES_FOR_RELIABLE_STATS = 3`
**Location 3**: `stats-health-check/index.ts` → `MIN_SAMPLE_SIZE = 3`

**Q5**: Same constant value in 3 places (all = 3)

**Q6**: Should be consolidated

**RECOMMENDATION**: Import from `_shared/stats_integrity.ts` in all places:
```typescript
// In stats_db.ts and stats-health-check/index.ts, change to:
import { MIN_SAMPLE_SIZE } from "../_shared/stats_integrity.ts";
```

### 2.3 Fixture Type Definitions

Multiple places define `interface Fixture`:
- `_shared/stats_db.ts:36` - For DB queries
- `src/components/CenterRail.tsx:8` - For UI component
- `results-refresh/index.ts:14` - For result processing
- `backfill-fixture-results/index.ts:8` - For backfill

**Q5**: These are **context-specific** interfaces, not true duplicates. Each defines only the fields needed for that module.

**Q6**: Could consolidate into a shared types file, but the benefit is minimal since they're scoped to different contexts.

**RECOMMENDATION**: Leave as-is. The DB types come from `src/integrations/supabase/types.ts` (auto-generated), and these are minimal local interfaces.

---

## 3. Edge Functions & Stats Pipeline Duplication

### 3.1 Edge Functions Inventory

```
supabase/functions/
├── _shared/                    # Shared helpers (single source of truth)
│   ├── stats.ts               # computeLastFiveAverages (API)
│   ├── stats_db.ts            # recomputeTeamStatsFromDB (DB)
│   ├── stats_integrity.ts     # validateFixtureStats (shared validation)
│   ├── leagues.ts             # ALLOWED_LEAGUE_IDS (single source)
│   └── ... (13 more shared modules)
├── analyze-fixture/           # Uses _shared/stats.ts + stats_integrity.ts ✅
├── filterizer-query/          # Uses _shared/stats_integrity.ts ✅
├── generate-ticket/           # Uses _shared/stats_integrity.ts ✅
├── stats-refresh/             # Uses _shared/stats.ts ✅
├── stats-health-check/        # Uses _shared/stats_db.ts ✅
└── fixtures-history-backfill/ # Uses _shared/leagues.ts ✅
```

**Q8: Multiple "last 5 matches" implementations?**  
**YES, intentionally**:
- `_shared/stats.ts`: Production implementation (API-based)
- `_shared/stats_db.ts`: Validation implementation (DB-based)

**Q9: Averages computed in multiple places?**  
**NO** - All edge functions import from `_shared/stats.ts` or `_shared/stats_db.ts`

**Q10: Sample size validation in multiple places?**  
**MINOR ISSUE** - `MIN_SAMPLE_SIZE` defined in 3 files (see section 2.2)

**Q11: Old/superseded utilities?**  
**NO** - `stats_integrity.ts` and `stats_db.ts` are both active and serve different purposes

---

## 4. Schemas/Types Duplication

### 4.1 Stats-Related Types

| Type | Location | Used By |
|------|----------|---------|
| `Last5Result` | `_shared/stats.ts` | Production stats |
| `DBStatsResult` | `_shared/stats_db.ts` | Validation |
| `StatsValidation` | `_shared/stats_integrity.ts` | All tools |
| `MetricAvailability` | `_shared/stats_integrity.ts` | All tools |
| `StatsCache` (DB type) | `types.ts` (auto-generated) | DB operations |

**Q12: Same shape in multiple files?**  
**NO** - Each type serves a distinct purpose

**Q13: Can shapes be moved to shared module?**  
Already done - `_shared/stats_integrity.ts` exports shared validation types

**Q14: Mismatches between schemas and DB/API?**  
**NO** - Types align with `src/integrations/supabase/types.ts` (auto-generated from DB)

---

## 5. Cron Jobs Duplication

### 5.1 Current Active Cron Jobs

```sql
SELECT jobid, jobname, schedule FROM cron.job ORDER BY jobid;
```

| jobid | jobname | schedule | status |
|-------|---------|----------|--------|
| 24 | cleanup-old-results | 0 4 1 * * | ✅ Housekeeping |
| 26 | purge-stale-prematch-selections-5m | */5 * * * * | ✅ Housekeeping |
| 27 | downgrade-expired-entitlements-5m | */5 * * * * | ✅ Billing |
| 28 | stats-refresh-batch-cron | */10 * * * * | ✅ Primary pipeline |
| 29 | warmup-optimizer-cron | */30 * * * * | ✅ Primary pipeline |
| 30 | results-refresh-30m | */30 9-23 * * * | ✅ Results |
| 31 | cron-fetch-fixtures-10m | */10 * * * * | ✅ Fixtures |
| 32 | backfill-fixture-results-daily | 30 2 * * * | ⚠️ Overlaps with #33 |
| 33 | backfill-fixture-results-weekly | 0 3 * * 0 | ⚠️ Overlaps with #32 |
| 34 | backfill-fixture-results-turbo | */10 * * * * | ⚠️ Too frequent |
| 37 | sync-injuries-12h | 0 */4 * * * | ✅ Injuries |
| 38 | sync-player-importance-daily | 0 3 * * * | ✅ Player data |
| 39 | stats-health-check-hourly | 0 * * * * | ✅ Monitoring |
| 40 | fixtures-history-backfill-cron | 0 */6 * * * | ✅ Historical data |

### 5.2 Issues Found

**Q15: Overlapping work?**  
**YES** - Three backfill jobs do similar work:
- `backfill-fixture-results-daily` (job 32)
- `backfill-fixture-results-weekly` (job 33)
- `backfill-fixture-results-turbo` (job 34) - runs every 10 minutes!

**Q16: Could cause double-processing?**  
**YES** - Job 34 (`turbo`) runs every 10 minutes, likely redundant with `results-refresh-30m`

**Q17: Recommendation?**  
**DELETE jobs 32, 33, 34** - Keep only:
- `results-refresh-30m` (job 30) for recent results
- `fixtures-history-backfill-cron` (job 40) for historical data

---

## 6. Dead Code & Legacy

### 6.1 Dead Code Scan

**No dead/unused files found** in:
- `src/components/` - All components are imported
- `src/pages/` - All pages are in routes
- `supabase/functions/` - All functions are either cron-triggered or API-called
- `_shared/` - All modules are imported by edge functions

### 6.2 Migration Files with Stale Cron Definitions

Several migration files contain cron.schedule calls for jobs that **no longer exist** or were superseded:

| Migration | Contains | Status |
|-----------|----------|--------|
| `20251023005403_*.sql` | `stats-refresh-job` | Superseded |
| `20251023234721_*.sql` | `full-refresh-pipeline`, `backfill-odds-job`, `optimize-selections-job`, `nearterm-refresh` | Superseded |
| `20251024040604_*.sql` | `stats-refresh-72h`, `backfill-48h-full`, `optimize-48h-full`, `backfill-6h-near`, `optimize-6h-near`, `backfill-1h-imminent`, `optimize-1h-imminent` | Superseded |

**Q18**: These are migration files - they ran once and created jobs that were later replaced.

**Q19**: **KEEP** migration files (immutable history), but the cron jobs they created have been superseded and removed.

---

## 7. Concrete Refactor Plan

### 7.1 Immediate Actions (Safe)

#### Action 1: Consolidate MIN_SAMPLE_SIZE constant
**Files to update**:
- `supabase/functions/_shared/stats_db.ts` - Import from stats_integrity
- `supabase/functions/stats-health-check/index.ts` - Import from stats_integrity

```typescript
// Change from:
const MIN_SAMPLE_SIZE = 3;

// To:
import { MIN_SAMPLE_SIZE } from "../_shared/stats_integrity.ts";
```

#### Action 2: Remove redundant backfill cron jobs
**Jobs to delete** (SQL):
```sql
SELECT cron.unschedule('backfill-fixture-results-daily');
SELECT cron.unschedule('backfill-fixture-results-weekly');
SELECT cron.unschedule('backfill-fixture-results-turbo');
```

### 7.2 No Action Needed

| Area | Reason |
|------|--------|
| `stats.ts` vs `stats_db.ts` | Different purposes (API vs DB) |
| Fixture interfaces | Context-specific, minimal overlap |
| Edge functions | Well-organized, use shared helpers |
| Migration files | Immutable history, cannot delete |

---

## 8. Automated Guardrail

### 8.1 Duplicate Check Script

Add to `package.json`:
```json
{
  "scripts": {
    "duplicate-check": "find . -type f \\( -name '*_old*' -o -name '*_copy*' -o -name '*_backup*' -o -name '*_bak*' -o -name '*-old*' -o -name '*-copy*' \\) -not -path './node_modules/*' -not -path './.git/*' | head -20"
  }
}
```

### 8.2 Usage
```bash
npm run duplicate-check
# Should return empty (no matches) in a clean codebase
```

---

## Summary

### ✅ What is Guaranteed Now

1. **Single source of truth** for stats computation: `_shared/stats.ts`
2. **Single source of truth** for validation: `_shared/stats_integrity.ts`
3. **Single source of truth** for league IDs: `_shared/leagues.ts`
4. **No hidden duplicate implementations** of last-5 averages logic
5. **All edge functions** correctly import from shared modules
6. **No dead code** in components, pages, or functions

### ⚠️ Remaining Items

1. **MIN_SAMPLE_SIZE** defined in 3 places (minor, recommended to consolidate)
2. **3 redundant backfill cron jobs** (recommend deletion)
3. **Migration files** contain old cron schedules (expected, immutable)

### 🔒 Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| Updating one stats module without the other | **LOW** | They serve different purposes (API vs DB) |
| Cron job conflicts | **MEDIUM** | Remove redundant backfill jobs |
| Future duplicate files | **LOW** | Add duplicate-check script |

---

*Report generated by automated audit on 2025-12-04*
