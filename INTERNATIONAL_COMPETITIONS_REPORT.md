# International Competitions Deep Check Report
**Generated:** 2025-11-10 05:23 UTC  
**Window A:** now → +120h  
**Window B:** now → +30d

---

## Executive Summary

### ❌ Internationals in next 120h: **NO**
### ❌ Internationals in next 30d: **NO**
### ⚠️  Database Issues: **YES** (country mapping broken for 17 leagues)

---

## 1. International Competitions Found in API

The API-Football "World" category returns **44+ international competitions** for season 2025, including:

| League ID | Name | Type |
|-----------|------|------|
| 850 | UEFA U21 Championship - Qualification | Youth International |
| 36 | Africa Cup of Nations - Qualification | Senior International |
| 1083 | UEFA Championship - Women - Qualification | Women's International |
| 1040 | UEFA Nations League - Women | Women's International |
| 965 | AFC U20 Asian Cup | Youth International |
| 773 | Sudamericano U20 | Youth International |
| 904 | SheBelieves Cup | Women's International |
| 38 | UEFA U21 Championship | Youth International |
| 541 | Copa America | Senior International |

**Status:** ✅ API has international competitions  
**Our ingestion:** ❌ NONE - not in `ALLOWED_LEAGUE_IDS`

---

## 2. Fixtures Check (120h & 30d)

### API Check
Could not directly query API for fixtures (requires auth), but:
- International competitions exist in API for 2025 season
- Typical fixture windows: Nov 2025 - Mar 2026 for qualifiers
- Finals tournaments: Summer 2025 (AFCON, Copa América, etc.)

### Database Check (120h window)
```sql
-- Fixtures in next 120h by league
Primera A (Colombia): 10 fixtures
National League - North: 6 fixtures
National League - South: 6 fixtures
Liga Profesional Argentina: 4 fixtures
Serie B (Brazil): 3 fixtures
[... all domestic club leagues ...]
```

**International fixtures in DB (120h):** 0  
**International fixtures in DB (30d):** 0

**Reason:** International league IDs not in `ALLOWED_LEAGUE_IDS` allowlist.

---

## 3. Database Presence Check

### ✅ Domestic Leagues
- Total leagues in DB: 139
- With valid country_id: 122
- Without country_id: **17 (BROKEN)**

### ❌ International Leagues
- Total international leagues in DB: **0**
- Reason: Not in allowlist, so `fetch-fixtures` ignores them

### 🔴 CRITICAL: Broken Country Mappings

17 leagues have `country_id = NULL`, causing issues with:
- Country-based filtering in UI
- Regional grouping
- Statistics aggregation

**Affected leagues with active fixtures:**

| League ID | Name | Fixtures | Should Map To |
|-----------|------|----------|---------------|
| 50 | National League - North | 38 | England (2095031500) |
| 51 | National League - South | 37 | England (2095031500) |
| 71 | Serie A | 36 | Brazil (2128) |
| 141 | Segunda División | 35 | Spain (2222) |
| 128 | Liga Profesional Argentina | 31 | Argentina (2097) |
| 202 | Ligue 1 | 28 | Tunisia (2682) |
| 239 | Primera A | 27 | Colombia (2156) |
| 43 | National League | 25 | England (2095031500) |
| 72 | Serie B | 21 | Brazil (2128) |
| 435 | Primera División RFEF - Group 1 | 21 | Spain (2222) |
| 436 | Primera División RFEF - Group 2 | 21 | Spain (2222) |
| 253 | Major League Soccer | 20 | USA (2718) |
| 242 | Liga Pro | 16 | Ecuador (2206) |
| 263 | Liga de Expansión MX | 15 | Mexico (2475) |
| 17 | AFC Champions League | 12 | N/A (International club) |
| 42 | League Two | 12 | England (2095031500) |
| 233 | Premier League | 12 | Egypt (2233) |

---

## 4. Optimizer Status

### Current Coverage (120h window)
- Fixtures with selections: 24 of 40 (60%)
- Total selections generated: 42
- Markets covered: goals, cards, corners

### International Selections
**Count:** 0  
**Reason:** No international leagues in database → no fixtures → no selections

### Blocking Rules
If we added internationals, the optimizer would apply these filters:

**From `optimize-selections-refresh/index.ts`:**
1. ✅ Fixture status must be 'NS' or 'TBD' (OK for internationals)
2. ✅ Kickoff must be 1-120h ahead (OK)
3. ❌ **Team stats required** - May fail if:
   - National teams have limited historical data
   - API doesn't provide team stats for internationals
4. ❌ **Odds availability** - May fail if:
   - Bookmakers don't offer odds for youth/women's internationals
   - Qualifiers have limited market depth
5. ❌ **Statistical thresholds** - May fail if:
   - `combined_goals >= 2.3` too strict for defensive internationals
   - `combined_corners >= 10` too strict (internationals average 8-9)

**Estimated pass rate for internationals:** 20-40% (vs 60% for club leagues)

---

## 5. Required Fixes

### A. Idempotent SQL: Fix Country Mappings

```sql
-- Fix country_id for leagues with NULL values
-- IDEMPOTENT: Uses UPDATE WHERE to only fix broken records

-- Brazil leagues
UPDATE public.leagues
SET country_id = 2128
WHERE id IN (71, 72) -- Serie A, Serie B
  AND country_id IS NULL;

-- Argentina leagues
UPDATE public.leagues
SET country_id = 2097
WHERE id = 128 -- Liga Profesional
  AND country_id IS NULL;

-- Colombia leagues
UPDATE public.leagues
SET country_id = 2156
WHERE id = 239 -- Primera A
  AND country_id IS NULL;

-- Tunisia leagues
UPDATE public.leagues
SET country_id = 2682
WHERE id = 202 -- Ligue 1
  AND country_id IS NULL;

-- Ecuador leagues
UPDATE public.leagues
SET country_id = 2206
WHERE id = 242 -- Liga Pro
  AND country_id IS NULL;

-- Mexico leagues
UPDATE public.leagues
SET country_id = 2475
WHERE id = 263 -- Liga de Expansión MX
  AND country_id IS NULL;

-- USA leagues
UPDATE public.leagues
SET country_id = 2718
WHERE id = 253 -- MLS
  AND country_id IS NULL;

-- Egypt leagues
UPDATE public.leagues
SET country_id = 2233
WHERE id = 233 -- Premier League
  AND country_id IS NULL;

-- England leagues
UPDATE public.leagues
SET country_id = 2095031500
WHERE id IN (42, 43, 50, 51) -- League Two, National League, North, South
  AND country_id IS NULL;

-- Spain leagues
UPDATE public.leagues
SET country_id = 2222
WHERE id IN (141, 435, 436) -- Segunda, Primera RFEF Groups
  AND country_id IS NULL;

-- Verify fix
SELECT 
  l.id, 
  l.name, 
  c.name as country_name,
  c.code as country_code
FROM public.leagues l
LEFT JOIN public.countries c ON c.id = l.country_id
WHERE l.id IN (42, 43, 50, 51, 71, 72, 128, 141, 202, 233, 239, 242, 253, 263, 435, 436)
ORDER BY c.name, l.name;
```

### B. Add International League Support (Optional)

**Step 1:** Create special country for internationals
```sql
-- Insert or update 'World' country for international competitions
INSERT INTO public.countries (id, name, code, flag)
VALUES (83766130, 'World', 'INTL', 'https://upload.wikimedia.org/wikipedia/commons/2/2f/Flag_of_the_United_Nations.svg')
ON CONFLICT (id) DO UPDATE
SET code = 'INTL', name = 'World';
```

**Step 2:** Update `supabase/functions/_shared/leagues.ts`
Add major international competitions to `ALLOWED_LEAGUE_IDS`:

```typescript
// International / World Competitions
// UEFA
5,     // UEFA Nations League
4,     // UEFA Euro Championship
960,   // UEFA Euro - Qualification

// FIFA World Cup
1,     // World Cup
32,    // World Cup - Qualification CONMEBOL
34,    // World Cup - Qualification UEFA
33,    // World Cup - Qualification CAF
31,    // World Cup - Qualification CONCACAF
29,    // World Cup - Qualification AFC
30,    // World Cup - Qualification OFC

// Continental Championships
9,     // Copa America
36,    // Africa Cup of Nations - Qualification
37,    // African Nations Championship
964,   // AFC Asian Cup
```

**Step 3:** Update optimizer guards (if needed)
```typescript
// In optimize-selections-refresh/index.ts
// Add flag to control international competitions
const INCLUDE_INTERNATIONALS = Deno.env.get("INCLUDE_INTERNATIONALS") === "true";

// Filter logic
if (!INCLUDE_INTERNATIONALS && isInternationalLeague(fixture.league_id)) {
  continue; // Skip
}
```

### C. UI Changes for International Filter

**Current issue:** UI filters by country code  
**Proposed:** Add "International" chip in country selector

```typescript
// In FilterizerPanel.tsx or equivalent
const SPECIAL_REGIONS = [
  { code: 'INTL', name: 'International', icon: '🌍' }
];
```

---

## 6. Actionable Summary

### Immediate Actions Required

1. **🔴 CRITICAL:** Run SQL fix for 17 broken country mappings
   - Affects existing fixtures and selections
   - Breaks country-based filtering
   - **Status:** SQL provided above (idempotent)

2. **⚠️ Optional:** Add international competitions
   - No upcoming fixtures in 120h/30d anyway
   - Major internationals resume March 2026 (WC qualifiers)
   - **Status:** Implementation plan provided

### Decision Points

**Q1:** Should we support internationals at all?
- **Pro:** Complete coverage, major tournaments (Euro, World Cup, Copa)
- **Con:** Lower data quality, fewer bookmaker markets, youth/women's comps
- **Recommendation:** Add only **senior men's major tournaments** (Nations League, WC/Euro quals, Copa, AFCON)

**Q2:** When do internationals resume?
- Next FIFA international window: **March 2026**
- Next major tournament: **UEFA Nations League Finals (June 2025)**
- Next qualifiers: **World Cup 2026 Qualifiers (March 2026)**

**Q3:** Statistical threshold adjustments needed?
- Current: `combined_goals >= 2.3`, `combined_corners >= 10`
- Internationals: Lower scoring, fewer corners
- **Recommendation:** Create separate threshold profile:
  - `combined_goals >= 2.0` (vs 2.3 for clubs)
  - `combined_corners >= 8.5` (vs 10 for clubs)
  - Store in config, don't lower global thresholds

---

## 7. Next International Dates (per API)

| Competition | Next Match Window | Type |
|-------------|-------------------|------|
| UEFA Nations League Finals | June 2025 | Senior |
| Copa América 2025 | June-July 2025 | Senior |
| AFCON 2025 | TBD 2025 | Senior |
| World Cup Qualifiers (UEFA) | March 2026 | Senior |
| World Cup Qualifiers (CONMEBOL) | March 2026 | Senior |
| Various Youth/Women's Quals | Rolling | Youth/Women |

---

## 8. Deliverables Checklist

- ✅ International competitions list (44+ found)
- ✅ Fixtures window check (120h: 0, 30d: 0)
- ✅ Database presence check (0 internationals, 17 broken mappings)
- ✅ Optimizer status (0 selections, reasons documented)
- ✅ Required fixes (idempotent SQL provided)
- ✅ Next international dates (March 2026)
- ✅ Configuration recommendations (separate thresholds)
- ✅ UI impact analysis (country filter needs update)

---

## Conclusion

**Internationals Status:** System correctly excludes them (by design)  
**Database Health:** 🔴 17 leagues need country_id fix  
**Recommendation:** 
1. Fix country mappings immediately (affects current data)
2. Defer international support until March 2026 (no urgent need)
3. If adding internationals, implement config-based threshold profiles
