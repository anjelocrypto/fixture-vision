# Combined Stats Formula - Official Documentation

## Executive Summary

**Combined value = home_team_avg + away_team_avg**

Where each team's average is computed from their **last 5 completed (FT status) matches**, using **simple arithmetic mean** with **no adjustments**.

---

## 1. Data Source

### Match Selection Criteria
- **Last N matches**: 5 completed fixtures per team
- **Status filter**: `FT` (Full Time) only
- **API endpoint**: `/fixtures?team={teamId}&last=5&status=FT`
- **NO filters applied for**:
  - League type (includes domestic leagues, cups, friendlies)
  - Home/away split
  - Postponements
  - Opponent strength
  - Match importance

### Timeframe
- **Historical only**: Last 5 completed matches (backward-looking)
- **No forward-looking window**
- **No recency decay**: All 5 matches weighted equally

---

## 2. Per-Team Computation

For each team, we fetch their last 5 FT matches and compute:

```typescript
goals: avg of goals scored per match
corners: avg of "Corner Kicks" stat
cards: avg of (Yellow Cards + Red Cards)
fouls: avg of "Fouls" stat
offsides: avg of "Offsides" stat
sample_size: number of matches included (≤5)
```

### Formula
```
team_avg_goals = (match1_goals + match2_goals + ... + match5_goals) / 5
team_avg_corners = (match1_corners + match2_corners + ... + match5_corners) / 5
... (same for cards, fouls, offsides)
```

### Implementation
- **Code location**: `supabase/functions/_shared/stats.ts` (lines 106-134)
- **API call**: `analyze-fixture/index.ts` (lines 36-50)
- **Cache**: Results stored in `stats_cache` table (2-hour TTL)

---

## 3. Combined Value Calculation

**Location**: `optimize-selections-refresh/index.ts` (lines 174-180)

```typescript
combined.goals = homeStats.goals + awayStats.goals
combined.corners = homeStats.corners + awayStats.corners
combined.cards = homeStats.cards + awayStats.cards
combined.fouls = homeStats.fouls + awayStats.fouls
combined.offsides = homeStats.offsides + awayStats.offsides
```

**Simple sum - NO transformations applied:**
- ❌ No home/away weighting (e.g., 60/40 split)
- ❌ No recency weighting (e.g., exponential decay)
- ❌ No opponent strength adjustments
- ❌ No league normalization (e.g., Premier League vs League Two)
- ❌ No pace/style adjustments
- ❌ No rounding or clamping

---

## 4. Example Walkthrough

### Scenario: Manchester City vs Arsenal

**Manchester City last 5 FT matches:**
- Match 1: 3 goals, 8 corners, 2 cards, 12 fouls, 1 offside
- Match 2: 2 goals, 6 corners, 1 card, 10 fouls, 2 offsides
- Match 3: 4 goals, 10 corners, 3 cards, 15 fouls, 1 offside
- Match 4: 1 goal, 5 corners, 2 cards, 11 fouls, 0 offsides
- Match 5: 3 goals, 7 corners, 2 cards, 13 fouls, 1 offside

**Man City averages:**
- Goals: (3+2+4+1+3)/5 = **2.6**
- Corners: (8+6+10+5+7)/5 = **7.2**
- Cards: (2+1+3+2+2)/5 = **2.0**
- Fouls: (12+10+15+11+13)/5 = **12.2**
- Offsides: (1+2+1+0+1)/5 = **1.0**

**Arsenal last 5 FT matches:**
- Match 1: 2 goals, 7 corners, 2 cards, 11 fouls, 1 offside
- Match 2: 1 goal, 5 corners, 1 card, 9 fouls, 2 offsides
- Match 3: 3 goals, 8 corners, 3 cards, 14 fouls, 1 offside
- Match 4: 2 goals, 6 corners, 2 cards, 10 fouls, 1 offside
- Match 5: 2 goals, 6 corners, 1 card, 12 fouls, 0 offsides

**Arsenal averages:**
- Goals: (2+1+3+2+2)/5 = **2.0**
- Corners: (7+5+8+6+6)/5 = **6.4**
- Cards: (2+1+3+2+1)/5 = **1.8**
- Fouls: (11+9+14+10+12)/5 = **11.2**
- Offsides: (1+2+1+1+0)/5 = **1.0**

**Combined values (shown in UI):**
- **Goals**: 2.6 + 2.0 = **4.6** → Rule: Over 3.5 (range [4.0, 5.0))
- **Corners**: 7.2 + 6.4 = **13.6** → Rule: Over 12.5 (range [13.0, 15.0))
- **Cards**: 2.0 + 1.8 = **3.8** → Rule: Over 3.5 (range [3.1, 4.0))
- **Fouls**: 12.2 + 11.2 = **23.4** → Rule: Over 20.5 (range [22.6, 24.5))
- **Offsides**: 1.0 + 1.0 = **2.0** → Rule: Over 1.5 (range [1.5, 3.0))

---

## 5. Rationale & Limitations

### Why This Formula?

**Simplicity**: Easy to compute, explain, and debug
**Baseline**: Establishes a performance baseline without complex modeling
**Transparency**: No black-box adjustments

### Known Limitations

1. **No home/away split**: Treats all matches equally regardless of venue
2. **No opponent strength**: A match vs bottom-tier team counts same as vs top-tier
3. **No form trajectory**: Recent performance not weighted higher than older matches
4. **No league context**: Premier League and Championship stats not normalized
5. **Sample size variance**: Teams with 3 completed matches have less reliable averages
6. **Missing data handling**: Returns 0 if stat missing (no fallback to league averages)

### Future Enhancements (NOT currently implemented)

- Home/away weighting (e.g., 55/45 split)
- Recency decay (e.g., exponential with α=0.9)
- Opponent strength adjustment (e.g., xG-based)
- League normalization (z-scores per competition)
- Minimum sample size thresholds
- Confidence intervals

---

## 6. Verification Checklist

- [x] Last 5 FT matches per team (no other filters)
- [x] Simple arithmetic mean (no weighting)
- [x] Combined = home_avg + away_avg (no transformations)
- [x] No rounding/clamping before rule matching
- [x] Stats cached with 2-hour TTL
- [x] Both Filterizer and Ticket Creator use same calculation
- [x] Formula documented and locked

---

## 7. Code References

| Component | File | Lines |
|-----------|------|-------|
| Fetch last 5 fixtures | `_shared/stats.ts` | 36-50 |
| Compute per-team averages | `_shared/stats.ts` | 106-134 |
| Calculate combined values | `analyze-fixture/index.ts` | 245-252 |
| Apply to selections | `optimize-selections-refresh/index.ts` | 174-180 |

---

**Last updated**: 2025-10-24
**Formula version**: v1.0-baseline
**Status**: ✅ Production-locked
