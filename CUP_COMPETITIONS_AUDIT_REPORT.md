# Cup Competitions Audit Report
*Generated: December 3, 2025*
*Updated: December 3, 2025 - CUPS NOW FULLY SUPPORTED*

---

## Executive Summary

**✅ STATUS: FULLY SUPPORTED** - Major domestic cups have been added to `ALLOWED_LEAGUE_IDS` and will be treated identically to regular leagues in all pipelines.

| Cup Competition | League ID | Status | Country Code |
|-----------------|-----------|--------|--------------|
| FA Cup | 45 | ✅ SUPPORTED | GB-ENG |
| EFL Cup (Carabao Cup) | 48 | ✅ SUPPORTED | GB-ENG |
| Copa del Rey | 143 | ✅ SUPPORTED | ES |
| Coppa Italia | 137 | ✅ SUPPORTED | IT |
| DFB-Pokal | 81 | ✅ SUPPORTED | DE |
| Coupe de France | 66 | ✅ SUPPORTED | FR |

---

## Changes Made

### 1. `supabase/functions/_shared/leagues.ts`

**ALLOWED_LEAGUE_IDS** - Added all 6 cup IDs:
```typescript
// ============= DOMESTIC CUP COMPETITIONS =============
45,   // England FA Cup
48,   // England EFL Cup (League Cup / Carabao Cup)
143,  // Spain Copa del Rey
137,  // Italy Coppa Italia
81,   // Germany DFB-Pokal
66,   // France Coupe de France
```

**LEAGUE_TO_COUNTRY_CODE** - Added country mappings:
```typescript
// Domestic Cups
45: 'GB-ENG',   // FA Cup
48: 'GB-ENG',   // EFL Cup (Carabao Cup)
143: 'ES',      // Copa del Rey
137: 'IT',      // Coppa Italia
81: 'DE',       // DFB-Pokal
66: 'FR',       // Coupe de France
```

**CUP_LEAGUE_IDS** - New constant for easy reference:
```typescript
export const CUP_LEAGUE_IDS = [45, 48, 143, 137, 81, 66] as const;
```

**LEAGUE_NAMES** - Added cup display names:
```typescript
45: "FA Cup",
48: "EFL Cup (Carabao Cup)",
143: "Copa del Rey",
137: "Coppa Italia",
81: "DFB-Pokal",
66: "Coupe de France",
```

### 2. `league_stats_coverage` Table

All 6 cups have been added with `is_cup = true`:
- This flag is informational only - it does NOT exclude cups from any pipeline
- Cups are treated identically to regular leagues in Fixture Analyzer, Ticket Creator, Filterizer, etc.

---

## How Cups Work in the System

### Fixture Import Pipeline

Since cups are now in `ALLOWED_LEAGUE_IDS`, they will be:
- ✅ Imported by `fetch-fixtures` and `cron-fetch-fixtures`
- ✅ Included in upcoming fixtures lists
- ✅ Visible in Fixture Analyzer search
- ✅ Available in Ticket Creator and Filterizer

### Stats Pipeline (`stats_cache`)

Cup matches are **fully integrated** into last-5 stats:
- Teams playing in cups are discovered from `fixtures` table
- `stats-refresh` computes last-5 metrics for all teams (cups + leagues together)
- Fake-zero detection handles cup matches with missing stats
- Per-metric partial averaging ensures cups with only goals data don't corrupt corner/card averages

### Fixture Analyzer

When analyzing a cup match:
- ✅ Last-5 stats load from `stats_cache` (includes both cup and league matches)
- ✅ Injuries load correctly (competition-agnostic)
- ✅ H2H stats load correctly
- ✅ Combined metrics calculated identically to league matches

### Optimizer / Filterizer / Ticket Creator

Cup fixtures are:
- ✅ Considered as valid fixtures to optimize
- ✅ Included in historical backtesting windows
- ✅ Available in Filterizer and Ticket Creator

---

## Existing Cup Fixtures in Database

Legacy data already exists for some cups:

| Cup | Fixtures in DB |
|-----|----------------|
| FA Cup (45) | 19 |
| DFB-Pokal (81) | 4 |
| Coppa Italia (137) | 41 |
| Copa del Rey (143) | 122 |
| EFL Cup (48) | 0 (will populate on next import) |
| Coupe de France (66) | 0 (will populate on next import) |

---

## Validation SQL Queries

### Check cup fixtures
```sql
SELECT league_id, COUNT(*) as fixture_count 
FROM fixtures 
WHERE league_id IN (45, 48, 143, 137, 81, 66)
GROUP BY league_id
ORDER BY league_id;
```

### Check cup coverage settings
```sql
SELECT league_id, league_name, is_cup, country 
FROM league_stats_coverage 
WHERE league_id IN (45, 48, 143, 137, 81, 66)
ORDER BY league_id;
```

### Check upcoming cup fixtures (next 7 days)
```sql
SELECT f.id, f.league_id, l.name as league_name, 
       f.teams_home->>'name' as home, f.teams_away->>'name' as away,
       f.date, f.status
FROM fixtures f
JOIN leagues l ON l.id = f.league_id
WHERE f.league_id IN (45, 48, 143, 137, 81, 66)
  AND f.date >= CURRENT_DATE
  AND f.date <= CURRENT_DATE + INTERVAL '7 days'
ORDER BY f.date;
```

---

## Next Steps for Full Backfill

To populate historical data for cups, run the fixture fetch with these league IDs included:

1. **Automatic**: The next scheduled `cron-fetch-fixtures` run will automatically include cup fixtures
2. **Manual**: Trigger `fetch-fixtures` edge function to import current season fixtures immediately

After fixtures are imported, the stats pipeline will automatically:
- Discover teams from cup fixtures
- Compute last-5 stats for those teams
- Include cup matches in their form calculations

---

## Cup Support Status ✅

| Feature | Status |
|---------|--------|
| ✅ Cups in ALLOWED_LEAGUE_IDS | Complete |
| ✅ Country code mappings | Complete |
| ✅ league_stats_coverage rows | Complete |
| ✅ is_cup flag set | Complete |
| ✅ Fixture import enabled | Complete |
| ✅ Stats pipeline compatible | Yes |
| ✅ Fixture Analyzer compatible | Yes |
| ✅ Ticket Creator compatible | Yes |
| ✅ Filterizer compatible | Yes |
| ⏳ Historical fixture backfill | Pending (runs on next cron) |
| ⏳ Stats cache population | Pending (runs after fixtures import) |

---

## Risk Assessment

### Low Risk ✅
- Cup stats may have lower coverage for corners/cards/fouls (handled by per-metric partial averaging)
- Early cup rounds with small teams may have missing data (handled by fake-zero detection)

### No Risk ✅
- Type coercion issues (all ID comparisons use explicit Number() coercion)
- Cup matches corrupting league averages (cups are treated the same - no separate treatment)
- is_cup flag excluding cups from tools (flag is informational only, not used for filtering)

---

## Conclusion

Domestic cups are now **fully integrated** into the TicketAI system. They will behave exactly like existing supported leagues in all features: fixture import, stats pipeline, Fixture Analyzer, Ticket Creator, Filterizer, and all upcoming fixtures lists.

The next scheduled fixture import will populate cup fixtures, and the stats pipeline will automatically process teams appearing in those fixtures.
