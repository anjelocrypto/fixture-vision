# Combined Stats Formula - v2_combined_scaled

## Executive Summary

**Combined value = ((home_avg + away_avg) / 2) × multiplier**

Where each team's average is computed from their **last 5 completed (FT status) matches**, using **simple arithmetic mean** with **no adjustments**, then scaled by a **per-metric multiplier**.

---

## 1. Formula Version: v2_combined_scaled

### New Formula (v2)

```
combined(metric) = ((home_avg + away_avg) / 2) × multiplier(metric)
```

### Multipliers per Metric

| Metric   | Multiplier | Rationale |
|----------|------------|-----------|
| Goals    | 1.5        | Scales average to account for match dynamics |
| Corners  | 1.7        | Accounts for game flow variance |
| Cards    | 1.9        | Reflects intensity factors |
| Fouls    | 1.8        | Adjusts for referee tendencies |
| Offsides | 1.8        | Accounts for tactical patterns |

### Example Calculation

**Goals:**
- Home team goals avg: 2.4
- Away team goals avg: 3.1
- Combined: `((2.4 + 3.1) / 2) × 1.5 = 4.125` → **4.13** (rounded to 2 decimals)

**Corners:**
- Home team corners avg: 5.2
- Away team corners avg: 6.0
- Combined: `((5.2 + 6.0) / 2) × 1.7 = 9.52` → **9.52**

---

## 2. Data Source

### Match Selection Criteria
- **Last N matches**: 5 completed fixtures per team
- **Minimum required**: 3 matches (returns null if < 3)
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

## 3. Per-Team Computation

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
team_avg_corners = (match1_corners + ... + match5_corners) / 5
... (same for cards, fouls, offsides)
```

### Implementation
- **Code location**: `supabase/functions/_shared/stats.ts` → `computeCombinedMetrics()`
- **API call**: Uses `computeLastFiveAverages()` for each team
- **Cache**: Results stored in `stats_cache` table

---

## 4. Sanity Bounds (Clamps)

After computing combined values, we apply bounds to prevent unrealistic outputs:

| Metric   | Min | Max |
|----------|-----|-----|
| Goals    | 0   | 12  |
| Corners  | 0   | 25  |
| Cards    | 0   | 15  |
| Fouls    | 0   | 40  |
| Offsides | 0   | 10  |

---

## 5. Insufficient Data Handling

- If either team has fewer than **3** completed matches, that metric returns **null**
- Selections are **not generated** for null metrics
- Debug log: `[optimize] skip market=X fixture=Y reason=insufficient_combined`

---

## 6. Storage & Persistence

- Stored in `optimized_selections.combined_snapshot` as JSON with 2-decimal precision
- `rules_version` field set to `"v2_combined_scaled"` for tracking
- Example:
  ```json
  {
    "goals": 4.13,
    "corners": 9.52,
    "cards": 5.89,
    "fouls": 23.40,
    "offsides": 2.70
  }
  ```

---

## 7. Complete Example Walkthrough

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

**Combined values (v2 formula):**
- **Goals**: `((2.6 + 2.0) / 2) × 1.5 = 3.45` → Rule: Over 2.5 (range [2.7, 4.0))
- **Corners**: `((7.2 + 6.4) / 2) × 1.7 = 11.56` → Rule: Over 10.5 (range [11.1, 12.0))
- **Cards**: `((2.0 + 1.8) / 2) × 1.9 = 3.61` → Rule: Over 3.5 (range [3.1, 4.0))
- **Fouls**: `((12.2 + 11.2) / 2) × 1.8 = 21.06` → Rule: Over 19.5 (range [19.6, 22.5))
- **Offsides**: `((1.0 + 1.0) / 2) × 1.8 = 1.80` → Rule: Over 1.5 (range [1.5, 3.0))

---

## 8. No Additional Adjustments

- **No league normalization**: All leagues use same formula
- **No pace factor**: We don't adjust for faster/slower leagues
- **No variance consideration**: Only averages matter
- **No opponent strength**: All opponents weighted equally
- **No home/away split**: Both venues treated identically

---

## 9. Data Freshness

- Stats are cached in `stats_cache` table
- Refreshed when fixtures are fetched (typically daily via crons)
- After formula deployment, run **Warmup (48h)** to populate v2 values

---

## 10. Observability

**Logging format:**
```
[stats] combined v2: goals=4.13 corners=9.52 offsides=1.80 fouls=21.06 cards=3.61 (samples: H=5/A=5)
```

**Insufficient data:**
```
[optimize] skip market=cards fixture=12345 reason=insufficient_combined
```

---

## 11. Code References

| Component | File | Function |
|-----------|------|----------|
| Combined formula | `_shared/stats.ts` | `computeCombinedMetrics()` |
| Per-team averages | `_shared/stats.ts` | `computeLastFiveAverages()` |
| Apply to selections | `optimize-selections-refresh/index.ts` | Main loop |
| Version tracking | All writes to `optimized_selections` | `rules_version = "v2_combined_scaled"` |

---

**Last updated**: 2025-10-24
**Formula version**: v2_combined_scaled
**Status**: ✅ Production-deployed