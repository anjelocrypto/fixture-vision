# Cup Competitions Audit Report
*Generated: December 3, 2025*
*Updated: December 3, 2025 - CUPS NOW FULLY SUPPORTED*

---

## Executive Summary

**✅ UPDATE**: Major domestic cups are now **FULLY SUPPORTED** in our system. They have been added to `ALLOWED_LEAGUE_IDS` and will be treated identically to regular leagues in all pipelines.

| Cup Competition | League ID | Status | Country Code |
|-----------------|-----------|--------|--------------|
| FA Cup | 45 | ✅ SUPPORTED | GB-ENG |
| EFL Cup (Carabao Cup) | 48 | ✅ SUPPORTED | GB-ENG |
| Copa del Rey | 143 | ✅ SUPPORTED | ES |
| Coppa Italia | 137 | ✅ SUPPORTED | IT |
| DFB-Pokal | 81 | ✅ SUPPORTED | DE |
| Coupe de France | 66 | ✅ SUPPORTED | FR |

---

## 1️⃣ Coverage & Data Import Analysis

### 1.1 ALLOWED_LEAGUE_IDS Configuration

**Location**: `supabase/functions/_shared/leagues.ts`

Our fixture import pipeline explicitly filters by `ALLOWED_LEAGUE_IDS`. **NO domestic cups are included**:

```typescript
// What IS included:
- International: UEFA Nations League, World Cup, Euros, Copa América, AFCON
- UEFA Club: Champions League (2), Europa League (3), Conference League (848)
- Domestic Leagues: Premier League, La Liga, Serie A, Bundesliga, Ligue 1, etc.

// What is NOT included (domestic cups):
- 45:  FA Cup
- 48:  EFL Cup (League Cup / Carabao Cup)
- 81:  DFB-Pokal
- 137: Coppa Italia
- 66:  Coupe de France
- 143: Copa del Rey (has legacy data but NOT in allowed list)
```

### 1.2 Copa del Rey - Legacy Data Analysis

Copa del Rey (143) has **100 fixtures** in our database despite NOT being in `ALLOWED_LEAGUE_IDS`. This is legacy data from earlier imports.

**Example Copa del Rey fixtures (from database)**:
| Fixture ID | Date | Home Team | Away Team | Status |
|------------|------|-----------|-----------|--------|
| 1480728 | 2025-10-30 | Estepona | Malaga | FT |
| 1480723 | 2025-10-30 | Atlètic Lleida | Espanyol | FT |
| 1480751 | 2025-10-30 | Palma del Rio | Real Betis | FT |

**Issue**: No NEW Copa del Rey fixtures will be imported because it's not in `ALLOWED_LEAGUE_IDS`.

### 1.3 Fixture Import Pipeline Flow

```
API-Football → fetch-fixtures → ALLOWED_LEAGUE_IDS filter → fixtures table
                                        ↓
                                  CUPS FILTERED OUT
```

---

## 2️⃣ Last-5 Stats & stats_cache Behavior

### 2.1 How Cup Matches ARE Handled (When Present)

The stats pipeline in `_shared/stats.ts` **DOES include cup matches** when calculating last-5 averages:

1. **fetchTeamLast20FixtureIds()** - Fetches from API-Football with no competition filter
2. **computeLastFiveAverages()** - Processes all FT fixtures including cups
3. **Fake-zero detection** - Specifically handles cup matches with missing stats

### 2.2 Fake-Zero Detection Logic (Lines 291-338 of stats.ts)

```typescript
// Cup detection by name
const cupKeywords = ['cup', 'trophy', 'copa', 'coupe', 'pokal', 'taca', 'shield', 'super'];
const isCupByName = cupKeywords.some(kw => leagueName.toLowerCase().includes(kw));

// If ALL non-goal stats are 0/null AND it's a suspected cup:
// → Keep goals, NULL out corners/cards/fouls/offsides
```

**This means**: If a team's last 5 matches include cups with missing stats, goals are counted but other metrics are skipped for that fixture (per-metric partial averaging).

### 2.3 Real Madrid Example (Team ID 541)

**stats_cache entry**:
- goals: 1.4, corners: 5.6, cards: 1.8, fouls: 9.2, offsides: 1.8
- sample_size: 5
- last_five_fixture_ids: [1390953, 1451103, 1390942, 1390936, 1451077]

**Recent fixture_results analysis** (including Copa del Rey matches):
| Fixture ID | League | Goals | Corners |
|------------|--------|-------|---------|
| 1390936 | La Liga | 0 | 8+5 |
| 1451077 | UCL | 1 | 4+2 |
| 1390921 | La Liga | 3 | 6+3 |
| 1350689 | **Copa del Rey** | 0 | 6+7 |
| 1350690 | **Copa del Rey** | 0 | 8+8 |

**Finding**: Copa del Rey matches ARE in fixture_results and WOULD be included in last-5 if they're among the team's most recent 5 FT fixtures.

### 2.4 Barcelona Example (Team ID 529) - ⚠️ Bug Found

**stats_cache entry**:
- All zeros, sample_size: 0

**This is a BUG** - Barcelona has plenty of FT fixtures but stats_cache shows 0. This is likely related to the type coercion bug we just fixed. Barcelona's cache needs refresh.

---

## 3️⃣ Fixture Analyzer & Ticket Creator Behavior

### 3.1 Do Tools Include Cup Matches?

| Tool | Cup Support Status |
|------|-------------------|
| Fixture Analyzer | ⚠️ Cups NOT in upcoming fixtures list |
| Ticket Creator | ⚠️ Only league fixtures (cups excluded) |
| Filterizer | ⚠️ Only optimized_selections (no cups) |
| Hot Fixtures | ❌ No cups - filtered by ALLOWED_LEAGUE_IDS |

### 3.2 Why Cups Don't Appear

The entire data flow is:

```
ALLOWED_LEAGUE_IDS → fixtures → optimized_selections → UI
                        ↓
        Cups excluded at import step
```

Since domestic cups aren't in `ALLOWED_LEAGUE_IDS`, they:
1. Don't get imported to `fixtures` table (going forward)
2. Don't appear in optimizer pipeline
3. Don't show in Filterizer/Ticket Creator

### 3.3 If User Manually Analyzes a Cup Match

**Hypothetically**, if a cup fixture existed in our database:
- ✅ Last-5 stats WOULD load (from API-Football directly)
- ✅ Injuries WOULD load (no competition filter in injury logic)
- ⚠️ Potential for more NULL stats (lower API-Football coverage for cups)

---

## 4️⃣ Injuries & Player Importance

### 4.1 Injury Pipeline Analysis

**Location**: `supabase/functions/sync-injuries/index.ts`

The injury sync uses team-based fetching, NOT competition-based:
- ✅ Injuries are fetched per team, not per league
- ✅ Cup matches would have same injury data as league matches
- ✅ Player importance is calculated per player, not per competition

### 4.2 Injury-Based Goal Reduction

The injury impact logic in `computeCombinedMetrics()` is competition-agnostic:
- Uses player_importance table (synced separately)
- Applies same reduction formula regardless of fixture type
- ✅ Would work correctly for cup matches if they were supported

---

## 5️⃣ Risks & Edge Cases

### 5.1 Cup Stats Coverage Issues

**Copa del Rey in league_stats_coverage**:
| Metric | Coverage |
|--------|----------|
| Goals | 100% |
| Corners | 43% |
| Cards | 44% |
| Fouls | 44% |
| Offsides | N/A |

**Issue**: `is_cup` is FALSE (should be TRUE for proper detection)

### 5.2 Fake-Zero Patterns in Cups

Early cup rounds (small teams vs big teams) often have:
- ❌ Missing corners data
- ❌ Missing cards/fouls data
- ✅ Goals usually present

**Current handling**: Fake-zero detection correctly identifies these and:
1. Keeps goals in calculation
2. NULLs out other metrics for that fixture
3. Uses per-metric partial averaging

### 5.3 Risk Assessment Matrix

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Cup stats corrupting last-5 averages | LOW | LOW | Fake-zero detection handles this |
| Missing cup fixtures in Analyzer | HIGH | 100% | Cups not imported |
| Injury data missing for cups | LOW | LOW | Team-based fetching works |
| Copa del Rey legacy data going stale | MEDIUM | HIGH | Not being refreshed |

---

## 6️⃣ Final Cup Support Report

### A. Cup Coverage Summary

**Cups We Definitely Support**:
- ❌ **NONE** - No domestic cups are in `ALLOWED_LEAGUE_IDS`

**Cups With Legacy Data** (not actively updated):
- ⚠️ Copa del Rey (143) - 100 historical fixtures

**International Competitions Supported**:
- ✅ UEFA Champions League (2)
- ✅ UEFA Europa League (3)
- ✅ UEFA Europa Conference League (848)
- ✅ International tournaments (World Cup, Euros, Nations League, etc.)

### B. How Cup Matches Are Used in Stats

**Current behavior**:
1. Stats pipeline fetches team's last 20 FT matches from API-Football (ALL competitions)
2. Cups ARE included if they're in the team's recent matches
3. Fake-zero detection protects against bad cup data
4. Per-metric partial averaging ensures cups with missing corners/cards don't corrupt averages

**This is CORRECT behavior** - we want team form to include cup matches.

### C. Fixture Analyzer / Ticket Creator Behavior

**Current state**:
- ❌ Domestic cup fixtures do NOT appear in:
  - Upcoming fixtures lists
  - Filterizer selections
  - Ticket Creator options
  - Hot fixtures

**Limitation**: Users cannot analyze or create tickets for domestic cup matches.

### D. Risks, Limitations & Recommendations

#### What We Should Keep As-Is ✅
1. **Fake-zero detection logic** - Correctly handles cups with missing stats
2. **Per-metric partial averaging** - Prevents data corruption
3. **Team-based injury fetching** - Works for all competitions
4. **UEFA club competition support** - Full support for UCL, UEL, UECL

#### What We Should Improve/Change 🔧

**RECOMMENDATION 1: Add Major Domestic Cups to ALLOWED_LEAGUE_IDS**

```typescript
// Add to ALLOWED_LEAGUE_IDS in _shared/leagues.ts:

// England Cups
45,   // FA Cup
48,   // EFL Cup (League Cup / Carabao Cup)

// Spain Cups  
143,  // Copa del Rey

// Italy Cups
137,  // Coppa Italia

// Germany Cups
81,   // DFB-Pokal

// France Cups
66,   // Coupe de France

// Add mappings to LEAGUE_TO_COUNTRY_CODE:
45: 'GB-ENG',   // FA Cup
48: 'GB-ENG',   // League Cup
143: 'ES',      // Copa del Rey
137: 'IT',      // Coppa Italia
81: 'DE',       // DFB-Pokal
66: 'FR',       // Coupe de France
```

**RECOMMENDATION 2: Fix league_stats_coverage for Copa del Rey**
- Set `is_cup = true` for league_id 143

**RECOMMENDATION 3: Run cup coverage analysis**
- Execute `analyze-cup-coverage` function to populate league_stats_coverage for cup competitions

#### Config Options to Consider 💡

**Option A: User toggle "Include cups in last-5 stats"**
- Default: YES (current behavior - cups included)
- Alternative: NO (league matches only)
- **Recommendation**: Keep default YES, no user toggle needed

**Option B: Admin toggle "Fetch domestic cups"**
- Would control whether cups are in ALLOWED_LEAGUE_IDS
- **Recommendation**: Just add cups permanently - no toggle needed

---

## Operator Instructions

### How to Enable Domestic Cup Support

1. **Add cup league IDs to `ALLOWED_LEAGUE_IDS`** in `supabase/functions/_shared/leagues.ts`
2. **Add country mappings** to `LEAGUE_TO_COUNTRY_CODE`
3. **Run fetch-fixtures** to import cup fixtures
4. **Run analyze-cup-coverage** to analyze cup stats quality
5. **Update league_stats_coverage** to mark cups correctly

### SQL to Verify Cup Data Health

```sql
-- Check cup fixtures count
SELECT l.id, l.name, COUNT(f.id) as fixtures
FROM leagues l
LEFT JOIN fixtures f ON f.league_id = l.id
WHERE l.id IN (45, 48, 143, 137, 81, 66)
GROUP BY l.id, l.name;

-- Check cup coverage stats
SELECT league_id, league_name, is_cup,
       corners_coverage_pct, cards_coverage_pct
FROM league_stats_coverage
WHERE league_id IN (45, 48, 143, 137, 81, 66);

-- Check if any teams have cup matches in last-5
SELECT sc.team_id, sc.last_five_fixture_ids,
       array_agg(DISTINCT l.name) as competitions
FROM stats_cache sc
CROSS JOIN LATERAL unnest(sc.last_five_fixture_ids) as fx_id
JOIN fixtures f ON f.id = fx_id
JOIN leagues l ON l.id = f.league_id
GROUP BY sc.team_id, sc.last_five_fixture_ids
HAVING COUNT(DISTINCT l.id) > 1
LIMIT 10;
```

---

## Conclusion

**Current State**: Domestic cups are NOT supported for fixture analysis/tickets, but cup matches ARE correctly included in team stats calculations when present in the team's recent history.

**Risk Level**: LOW for stats accuracy (fake-zero protection works), HIGH for feature completeness (users cannot analyze cup matches).

**Recommended Action**: Add major domestic cups to `ALLOWED_LEAGUE_IDS` to enable full cup support across all tools.
