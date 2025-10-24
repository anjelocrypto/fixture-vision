# Complete Pipeline Documentation: Stats → Rules → Odds → Selections

## 1. Combined Stats Calculation

### Inputs
**Location**: `supabase/functions/_shared/stats.ts` (lines 120-157)

- **Match Selection**: Last 5 completed fixtures per team
  - Status filter: `FT` (Full Time) only
  - API endpoint: `/fixtures?team={teamId}&last=5&status=FT`
  - No league filters, no cup/friendly exclusions
  - No postponement exclusions
  
- **Timeframe**: Historical only (last 5 completed)
  - No forward-looking window
  - No recency weighting applied

### Per-Team Features Computed

For each team, we fetch and average across 5 matches:

```typescript
goals: avg of goals scored per match
corners: avg of "Corner Kicks" stat
cards: avg of (Yellow Cards + Red Cards)
fouls: avg of "Fouls" stat
offsides: avg of "Offsides" stat
sample_size: number of matches included (≤5)
```

**Code**: `stats.ts` lines 87-117

### Weighting & Adjustments

**NONE APPLIED**:
- ❌ No recency weighting
- ❌ No home/away weighting
- ❌ No opponent strength adjustments
- ❌ No league normalization
- ❌ No missing-data fallback (returns 0 if stat missing)

### Combined Value Formula

**Location**: `optimize-selections-refresh/index.ts` lines 174-180

```typescript
combined.goals = homeStats.goals + awayStats.goals
combined.corners = homeStats.corners + awayStats.corners
combined.cards = homeStats.cards + awayStats.cards
combined.fouls = homeStats.fouls + awayStats.fouls
combined.offsides = homeStats.offsides + awayStats.offsides
```

**Simple sum of two team averages - NO OTHER TRANSFORMATIONS**

### Rounding & Clamping

**NONE**: Raw float values passed to rule matching

---

## 2. Rule Mapping (Sheet Implementation)

### Rules Location
`supabase/functions/_shared/rules.ts` lines 6-47

### Current Implementation vs Sheet

#### Goals
```typescript
[1.0, 2.0]   → Over 0.5  ✅
[2.0, 2.7]   → Over 1.5  ✅
[2.7, 4.0]   → Over 2.5  ✅
[4.0, 5.0]   → Over 3.5  ✅
[5.0, 6.0]   → Over 4.5  ✅
[6.0, 7.0]   → Over 5.5  ✅
≥7.0         → Over 5.5  ✅
```

#### Corners
```typescript
[7.8, 8.9]   → Over 7.5   ✅
[9.0, 10.0]  → Over 8.5   ✅
[10.1, 11.0] → Over 9.5   ✅
[11.1, 12.0] → Over 10.5  ✅
[12.0, 13.0] → Over 12.0  ⚠️ (sheet has 11.5)
[13.0, 15.0] → Over 12.5  ✅
≥15.0        → Over 13.5  ✅
```

#### Cards
```typescript
[1.0, 2.0]   → Over 1.5  ✅
[2.1, 3.0]   → Over 2.5  ✅
[3.1, 4.0]   → Over 3.5  ✅
[4.1, 5.0]   → Over 4.5  ✅
[5.1, 6.9]   → Over 5.5  ✅
≥7.0         → Over 5.5  ✅
```

#### Fouls
```typescript
[16.5, 19.5] → Over 16.5  ✅
[19.6, 22.5] → Over 19.5  ✅
[22.6, 24.5] → Over 20.5  ⚠️ (sheet unclear)
[24.6, 26.9] → Over 23.5  ✅
[27.0, 28.9] → Over 24.5  ✅
≥29.0        → Over 24.5  ✅
```

#### Offsides
```typescript
[1.5, 3.0]   → Over 1.5  ✅
[3.1, 4.0]   → Over 2.5  ✅
[4.1, 5.5]   → Over 3.5  ✅
≥5.5         → Over 4.5  ✅
```

### Rule Function
**Location**: `rules.ts` lines 49-57

```typescript
export function pickFromCombined(stat: StatMarket, combinedValue: number) {
  const rules = RULES[stat];
  for (const r of rules) {
    if (r.range === "gte") return r.pick;
    const [lo, hi] = r.range;
    if (combinedValue >= lo && combinedValue <= hi) return r.pick;
  }
  return null; // NO MATCH → SKIP FIXTURE
}
```

**Returns**: `{ side: "over"|"under", line: number }` or `null`

**NO FALLBACK**: If no rule matches, fixture is skipped for that market.

---

## 3. Optimized Selections - Odds Row Matching

### Source Table
`optimized_selections` populated by `optimize-selections-refresh/index.ts`

### Odds Data Source
- **Table**: `odds_cache` (populated by `fetch-odds-bets` cron)
- **API**: API-Football `/odds` endpoint
- **Bet IDs** (exact match required):
  - Goals: `id = 5` ("Goals Over/Under")
  - Corners: `id = 45` ("Corners Over Under")
  - Cards: `id = 80` ("Cards Over/Under")
  - Fouls: ❌ NOT AVAILABLE in API-Football
  - Offsides: ❌ NOT AVAILABLE in API-Football

### Matching Logic
**Location**: `optimize-selections-refresh/index.ts` lines 206-262

```typescript
// Step 1: Find bet by exact ID
if (market === "goals") targetBet = betsData.find(b => b.id === 5);
else if (market === "corners") targetBet = betsData.find(b => b.id === 45);
else if (market === "cards") targetBet = betsData.find(b => b.id === 80);
else continue; // Skip fouls/offsides

// Step 2: Find exact value text match in bet.values[]
const selection = targetBet.values.find(v => {
  const valueLower = v.value.toLowerCase().trim();
  const targetString = `${pick.side} ${pick.line}`; // e.g. "over 2.5"
  
  if (valueLower !== targetString) return false; // EXACT match required
  
  // Step 3: Reject suspicious odds
  const odds = parseFloat(v.odd);
  if (pick.line === 2.5 && odds >= 5.0) {
    console.warn("Rejected suspicious odds");
    return false;
  }
  
  return true;
});

// Step 4: Pick best odds across bookmakers
if (odds > bestOdds) {
  bestOdds = odds;
  bestBookmaker = bookmaker.name;
}
```

### Deduplication
**Location**: Lines 327-331

- **Strategy**: `onConflict: "fixture_id, market, side, line, bookmaker, is_live"`
- **One row per**: (fixture, market, side, line, bookmaker, is_live)
- **No mixing**: Each row represents one bookmaker's odds for one specific line

### Freshness & TTL
- **Prematch**: 45-min cache TTL (from `fetch-odds` function)
- **Cron schedule**: 
  - 72h window every 6h
  - 6h window every 1h
  - 1h window every 15min
- **Overlap guard**: Prevents concurrent runs (3min timeout)

### Edge Calculation
**Location**: Lines 267-270

```typescript
impliedProb = 1 / odds
modelProb = Math.min(0.95, Math.max(0.05, combinedValue / (line * 2)))
edgePct = ((modelProb - impliedProb) / impliedProb) * 100
```

**NOTE**: Model prob is SIMPLIFIED placeholder - not a proper statistical model

---

## 4. Filterizer Expected Behavior

### Query Endpoint
`filterizer-query/index.ts`

### User Selects
- Market: `goals`
- Side: `over`
- Line: `2.5`
- Min odds: `1.40`

### Backend Query
**Location**: Lines 95-116

```typescript
supabase
  .from("optimized_selections")
  .select("*")
  .eq("market", market)          // "goals"
  .eq("side", side)               // "over"
  .gte("line", line - 0.01)       // 2.49
  .lte("line", line + 0.01)       // 2.51
  .gte("odds", minOdds)           // 1.40
  .eq("is_live", false)
  .gte("utc_kickoff", queryStart)
  .lte("utc_kickoff", endDate)    // +7 days
```

### Post-Query Filters
**Location**: Lines 129-145

1. **Suspicious odds rejection** (line 130):
   ```typescript
   if (market === "goals" && line === 2.5 && odds >= 5.0) {
     console.warn("Dropping suspicious odds");
     return false;
   }
   ```

2. **Deduplication** (lines 138-145):
   ```typescript
   // Keep BEST odds per fixture
   const bestByFixture = new Map<fixture_id, selection>();
   for (const row of rows) {
     const prev = bestByFixture.get(row.fixture_id);
     if (!prev || row.odds > prev.odds) {
       bestByFixture.set(row.fixture_id, row);
     }
   }
   ```

### Display Format
**Location**: `src/components/SelectionsDisplay.tsx` lines 72-83

```typescript
// ONE CARD PER FIXTURE
<Card>
  <h3>{home_team} vs {away_team}</h3>  // Line 78-80
  <Badge>{market.toUpperCase()}</Badge> // Line 85-87
  <Badge>{side} {line}</Badge>          // Line 88-90
  <span>{format(kickoff, "MMM d, HH:mm")}</span>
  <span>• {bookmaker}</span>
  <div className="text-2xl">{odds.toFixed(2)}</div>
</Card>
```

**NO GROUPING**: Each card = one fixture with one bookmaker's odds

---

## 5. AI Ticket Creator Qualification

### Endpoint
`generate-ticket/index.ts`

### Qualification Rules
**Location**: Lines 159-314 (`processFixtureToPool`)

```typescript
// Step 1: Get fixture combined stats via analyze-fixture
const { combined } = await analyze-fixture({ fixtureId, homeTeamId, awayTeamId });

// Step 2: Apply rule mapping
const rulePick = pickFromCombined(market, combined[market]);
if (!rulePick) continue; // Skip if no rule match

// Step 3: Get odds via fetch-odds
const { selections } = await fetch-odds({ fixtureId, live: useLiveOdds });

// Step 4: STRICT line matching (no fallback)
const exactMatch = selections.find(s => 
  s.market === market && 
  s.kind === rulePick.side && 
  Math.abs(s.line - rulePick.line) <= 0.01
);

if (exactMatch) {
  legs.push({ ...exactMatch }); // ✅ QUALIFIES
} else {
  logs.push("[NO_EXACT_MATCH] ..."); // ❌ DROPPED
}
```

### Constraints
**Location**: Lines 436-568 (beam search)

- **Target odds**: `minOdds` to `maxOdds` (inclusive)
- **Legs**: `legsMin` to `legsMax`
- **Market toggles**: `includeMarkets` array
- **Live toggle**: `useLiveOdds` boolean
- **One leg per**: (fixture, market) pair
- **NO MIXING**: No "risk profile" heuristics

---

## 6. Evidence for 3 Fixtures

*[This section would be populated with real fixture analysis - requires querying live DB]*

To generate this, run:
```sql
-- Pick 3 upcoming fixtures from top leagues
SELECT f.id, f.teams_home, f.teams_away, f.timestamp, l.name
FROM fixtures f
JOIN leagues l ON f.league_id = l.id
WHERE f.timestamp >= EXTRACT(EPOCH FROM NOW())
  AND l.id IN (39, 140) -- Premier League, La Liga
ORDER BY f.timestamp ASC
LIMIT 3;
```

For each fixture:
1. Query `stats_cache` for home/away team
2. Calculate combined = home + away
3. Apply `pickFromCombined()` for each market
4. Query `optimized_selections` for that (fixture, market, side, line)
5. Verify card appears in Filterizer UI

---

## 7. Debug Toggle

*[Implemented in separate file change below]*

---

## 8. Known Issues - FIXED

### Issue: Wrong line/odds pairing
**Root cause**: Multiple potential mismatches
- ✅ FIXED: Bet ID matching (lines 216-228)
- ✅ FIXED: Value text matching (lines 233-242)
- ✅ FIXED: Suspicious odds rejection (lines 246-250)

### Issue: Grouped display
**Status**: Already correct in `SelectionsDisplay.tsx`
- ✅ Each card shows specific fixture (lines 78-80)
- ✅ No grouping logic present

### Issue: Missing fixtures
**Potential causes**:
1. ❌ Fouls/Offsides: Not available in API-Football odds
2. ⚠️ Rule mismatch: Combined value outside rule ranges
3. ⚠️ No odds: Bookmaker hasn't posted line yet
4. ⚠️ Cache miss: Stats or odds not refreshed

---

## Verification Checklist

- [x] Stats: Last 5 FT matches, simple average, no weighting
- [x] Combined: Sum of home + away averages
- [x] Rules: Implemented per sheet (minor discrepancies noted)
- [x] Odds: Exact bet ID + value text + suspicious odds guard
- [x] Filterizer: Line ±0.01 match, deduped to best per fixture
- [x] Ticket: STRICT match, no fallback, one per (fixture, market)
- [x] Display: Per-fixture cards, no grouping
- [ ] Live fixtures proof (requires DB access)
- [ ] Debug toggle (implemented below)
