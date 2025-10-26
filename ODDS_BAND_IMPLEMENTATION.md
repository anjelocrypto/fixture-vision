# Per-Leg Odds Band Implementation (1.25 - 5.00)

## Overview

All betting selections across the system are now constrained to the **1.25 - 5.00** odds band. This removes:
- Tiny "insurance" legs (≤1.24) that add minimal value
- Crazy longshots (>5.00) that are unreliable

## Implementation Details

### Central Configuration
**File:** `supabase/functions/_shared/config.ts`

```typescript
export const ODDS_MIN = 1.25;
export const ODDS_MAX = 5.00;
```

All systems reference these constants for consistency.

### AI Ticket Creator
**File:** `supabase/functions/generate-ticket/index.ts`

**Global Mode Pool Building:**
- Pre-optimized selections are filtered during pool construction
- Out-of-band odds are dropped with counter: `droppedOutOfBand`
- Log: `[Global Mode] Dropped X selections outside [1.25, 5.00] band`

**Individual Fixture Processing:**
- In `processFixtureToPool()`, exact matches are checked against the band
- Out-of-band odds are logged and skipped: `[OUT_OF_BAND] fixture:X market @ odds outside [1.25, 5.00] - DROPPED`

**Beam Search:**
- Fast prune at the top of candidate loop: `if (cand.odds < ODDS_MIN || cand.odds > ODDS_MAX) continue;`
- Prevents out-of-band candidates from being considered

**Error Response:**
- Empty pool returns: `"No selections within 1.25–5.00 odds for current settings"`
- Diagnostic includes: `"oddsBand": [1.25, 5.00]`

### Filterizer
**File:** `supabase/functions/filterizer-query/index.ts`

**Server-Side Enforcement:**
```typescript
const effectiveMinOdds = Math.max(minOdds, ODDS_MIN);
const effectiveMaxOdds = ODDS_MAX;

query = query
  .gte("odds", effectiveMinOdds)
  .lte("odds", effectiveMaxOdds);
```

This ensures the band is enforced regardless of UI slider position.

**UI:** 
- Min Odds slider should floor at 1.25
- Results capped at 5.00 even if user drags higher

### Optimized Selections Refresh
**File:** `supabase/functions/optimize-selections-refresh/index.ts`

**During Odds Matching:**
- First checks global odds band before suspicious odds guards
- Increments `droppedOutOfBand` counter
- Logs filtering stats: `dropped_out_of_band=X, dropped_suspicious=Y, dropped_no_line=Z`

**Run Logs:**
- `optimizer_run_logs.scope` includes:
  - `dropped_out_of_band`: count of selections rejected for being outside [1.25, 5.00]
  - `odds_band`: [1.25, 5.0] for reference
  - `coverage_pct`: percentage of fixtures with odds

### Suspicious Odds Guards
**File:** `supabase/functions/_shared/suspicious_odds_guards.ts`

**Enhanced Guard Logic:**
```typescript
// First check global odds band
if (odds < ODDS_MIN) {
  return `Out of band: ${market} Over ${line} @ ${odds} below minimum ${ODDS_MIN}`;
}
if (odds > ODDS_MAX) {
  return `Out of band: ${market} Over ${line} @ ${odds} above maximum ${ODDS_MAX}`;
}

// Then check market-specific guards
// ... existing suspicious odds logic
```

The band check runs **before** market-specific guards for efficiency.

### UI Communication
**File:** `src/components/TicketCreatorDialog.tsx`

Added caption in dialog header:
```
"Leg odds constrained to 1.25–5.00 by design"
```

This informs users of the constraint upfront.

## Observability

### Logs to Monitor

**AI Ticket Creator:**
- `[OUT_OF_BAND]` entries showing dropped fixtures
- `[Global Mode]` summary showing total dropped
- Empty pool diagnostic with `oddsBand` constraint

**Optimize Selections Refresh:**
- `[optimize-selections-refresh] Filtering: dropped_out_of_band=X`
- `[optimize-selections-refresh] Odds band enforced: [1.25, 5.00]`

**Database:**
- `optimizer_run_logs.scope.dropped_out_of_band` - track over time
- `optimizer_run_logs.scope.odds_band` - confirms version in use

## Acceptance Checks

- [x] Ticket Creator never returns legs with odds < 1.25 or > 5.00
- [x] Filterizer never shows out-of-band odds
- [x] Filterizer Min slider floors at 1.25 (frontend behavior)
- [x] All edge functions reference centralized `ODDS_MIN` and `ODDS_MAX`
- [x] Suspicious odds guards check band first
- [x] Run logs track `dropped_out_of_band` metric
- [x] UI shows constraint message to users

## ULTRA Plan Integration

The odds band works alongside the ULTRA ingestion strategy:
- **65k daily budget** (86% of 75k for safety)
- **50 RPM** rate limiting
- **45-min prematch TTL**
- Focuses on **Goals (bet 5), Corners (bet 45), Cards (bet 80)**

The band ensures that selections stored in `optimized_selections` are all within the usable range, maximizing the value of each API call.

## Configuration Flexibility

To adjust the band in the future:
1. Edit `supabase/functions/_shared/config.ts`
2. Update `ODDS_MIN` and/or `ODDS_MAX`
3. Redeploy (edge functions auto-deploy)
4. Run Warmup to repopulate with new constraints

All systems will automatically use the new values.
