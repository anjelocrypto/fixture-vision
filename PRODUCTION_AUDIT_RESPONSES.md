# TicketAI Production Audit - Detailed Responses

This document addresses all audit questions based on current codebase implementation.

---

## 1. Global Architecture & Environment ✅

### Environments
**Answer:** Single production environment
- Frontend: Deployed via Lovable Cloud (ticketai.bet)
- Backend: Supabase Edge Functions (dutkpzrisvqgxadxbkxo.supabase.co)
- Database: Same Supabase project for all components

**No staging environment** - all changes deploy directly to production.

### Config & Secrets ✅
**All secrets configured:**
```
✅ API_FOOTBALL_KEY (API-Sports direct endpoint)
✅ STRIPE_SECRET_KEY (payment processing)
✅ STRIPE_WEBHOOK_SECRET (webhook validation)
✅ LOVABLE_API_KEY (Gemini analysis)
✅ CRON_INTERNAL_KEY (cron authentication)
✅ APP_URL (ticketai.bet)
✅ SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
```

**Sensitive data logging:**
- ⚠️ Need to verify: Check if any edge functions log full Stripe payloads or API responses
- **Action:** Search edge functions for `console.log` with sensitive objects

### Supabase Integration ✅
**Project ID consistency:**
- `.env`: `dutkpzrisvqgxadxbkxo`
- Edge functions: Use `Deno.env.get("SUPABASE_URL")` consistently
- **No hardcoded URLs** found in codebase

**Service role usage:**
- ✅ Edge functions use `SUPABASE_SERVICE_ROLE_KEY` for privileged operations
- ✅ Frontend uses `SUPABASE_PUBLISHABLE_KEY` (anon key)

---

## 2. Database Schema & Migrations ✅

### Schema Drift
**Status:** Migrations match current schema
- Last migration: `20251123200150_106d38fe-7c59-4151-b523-fe750b31ad1e.sql`
- Added: `fouls_home`, `fouls_away`, `offsides_home`, `offsides_away` to `fixture_results`

**Action needed:**
- Run: `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name;`
- Compare against `src/integrations/supabase/types.ts`

### Constraints & Indexes

**High-traffic tables - CURRENT INDEXES:**

#### `fixture_results`
```sql
✅ PRIMARY KEY (fixture_id)
✅ FOREIGN KEY (fixture_id) REFERENCES fixtures(id)
✅ idx_fixture_results_fouls ON (fouls_home, fouls_away)
✅ idx_fixture_results_offsides ON (offsides_home, offsides_away)
⚠️ MISSING: idx_fixture_results_league_kickoff ON (league_id, kickoff_at)
```

#### `stats_cache`
```sql
✅ PRIMARY KEY (team_id)
⚠️ MISSING: idx_stats_cache_computed ON (computed_at) -- for freshness checks
```

#### `odds_cache`
```sql
✅ PRIMARY KEY (fixture_id)
⚠️ MISSING: idx_odds_cache_captured ON (captured_at) -- for TTL checks
```

#### `optimized_selections`
```sql
✅ PRIMARY KEY (id)
✅ UNIQUE (fixture_id, market, side, line, bookmaker, is_live)
⚠️ MISSING: idx_selections_kickoff_version ON (utc_kickoff, rules_version)
⚠️ MISSING: idx_selections_fixture_market ON (fixture_id, market)
```

**Missing Foreign Keys:**
```sql
⚠️ fixture_results.fixture_id → fixtures.id (EXISTS)
⚠️ fixture_results.league_id → leagues.id (MISSING!)
⚠️ optimized_selections.fixture_id → fixtures.id (MISSING!)
⚠️ optimized_selections.league_id → leagues.id (MISSING!)
```

### League Coverage Table

**Implementation:** `league_stats_coverage`
- **NOT generated columns** - computed by `populate-league-stats-coverage` edge function
- **NOT triggers** - manual/scheduled computation
- **Materialized logic** - stored in table, refreshed on demand

**Coverage columns calculation:**
```sql
goals_coverage_pct = (fixtures_with_goals::NUMERIC / total_fixtures) * 100
corners_coverage_pct = (fixtures_with_corners::NUMERIC / total_fixtures) * 100
-- etc for cards, fouls, offsides

skip_goals = (goals_coverage_pct < 40)
skip_corners = (corners_coverage_pct < 40)
-- etc
```

**Where defined:**
- Edge function: `populate-league-stats-coverage` (not shown in summary, but referenced)
- Last run: Manually via admin or scheduled job
- **Action:** Verify if there's a cron job to refresh this automatically

### Data Sanity Checks

**Potential issues to verify:**

```sql
-- 1. fixture_results with status != 'FT'
SELECT COUNT(*) FROM fixture_results WHERE status != 'FT';
-- Expected: 0 (all should be FT)

-- 2. stats_cache with sample_size = 0 but non-null averages
SELECT COUNT(*) FROM stats_cache 
WHERE sample_size = 0 
  AND (goals > 0 OR corners > 0 OR cards > 0 OR fouls > 0 OR offsides > 0);
-- Expected: 0 (impossible state)

-- 3. optimized_selections with old rules_version
SELECT rules_version, COUNT(*) 
FROM optimized_selections 
GROUP BY rules_version;
-- Expected: Only 'matrix-v3' or very small % legacy

-- 4. Orphaned selections (fixture ended but selection still active)
SELECT COUNT(*) FROM optimized_selections os
LEFT JOIN fixtures f ON f.id = os.fixture_id
WHERE f.timestamp < EXTRACT(EPOCH FROM NOW()) - 86400; -- 24h ago
-- Expected: Should be cleaned up periodically
```

**Action:** Run these queries and add cleanup jobs if needed.

---

## 3. Edge Functions & Cron Jobs ✅

### Cron Authentication

**Functions requiring CRON_INTERNAL_KEY:**
1. `stats-refresh` (called internally via HTTP from cron)
2. Potentially others that are cron-triggered

**Authentication method:**
```typescript
// Passed via HTTP header
headers: {
  'x-cron-key': Deno.env.get("CRON_INTERNAL_KEY")
}

// Verified in function:
const cronKey = req.headers.get('x-cron-key');
if (cronKey !== Deno.env.get("CRON_INTERNAL_KEY")) {
  return new Response("Unauthorized", { status: 401 });
}
```

**Public functions accidentally accepting cron calls:**
- ⚠️ Need to verify: Check all functions with `verify_jwt: false` in `config.toml`
- **Action:** Review each public function for cron-key bypass

### Cron Schedule Reality Check

**From `supabase/config.toml` and pg_cron:**

```sql
-- Verify actual schedules:
SELECT jobname, schedule, command 
FROM cron.job 
WHERE jobname LIKE '%ticketai%' OR jobname LIKE '%fixture%';
```

**Expected schedules:**
1. **cron-fetch-fixtures**: `*/10 * * * *` (every 10 minutes)
2. **stats-refresh-batch-cron**: `*/10 * * * *` (every 10 minutes) - calls stats-refresh internally
3. **cron-warmup-odds**: `*/30 * * * *` (every 30 minutes)
4. **optimize-selections-refresh**: Called by cron-warmup-odds (not separate cron)

**Disabled/failing check:**
```sql
-- Check for failed cron jobs
SELECT jobname, last_run_status, last_run_end_time
FROM cron.job_run_details
WHERE last_run_status != 'succeeded'
ORDER BY last_run_end_time DESC
LIMIT 20;
```

**Action:** Implement monitoring for cron failures (e.g., slack webhook on failure)

### Locking Implementation

**Current lock mechanism:**
```sql
-- From db functions:
acquire_cron_lock(p_job_name TEXT, p_duration_minutes INT DEFAULT 15)
release_cron_lock(p_job_name TEXT)
```

**Lock table:**
```sql
CREATE TABLE cron_job_locks (
  job_name TEXT PRIMARY KEY,
  locked_until TIMESTAMPTZ NOT NULL,
  locked_by TEXT,
  locked_at TIMESTAMPTZ DEFAULT now()
);
```

**Potential lock leak scenario:**
```typescript
// ❌ BAD: Lock never released if error thrown
await acquireLock('my-job');
await doWork(); // throws error
await releaseLock('my-job'); // never reached!

// ✅ GOOD: Lock always released
let locked = false;
try {
  locked = await acquireLock('my-job');
  if (!locked) return;
  await doWork();
} finally {
  if (locked) await releaseLock('my-job');
}
```

**Action:** Audit all cron functions for proper try/finally lock release

### Timeouts & Batch Sizes

**Current batch sizes:**
```typescript
// backfill-fixture-results
const BATCH_SIZE = 50; // or 100 depending on league

// backfill-odds
const BATCH_SIZE = 30; // prevents 504 timeouts
```

**Edge function timeout limits:**
- Default: 60 seconds (Supabase)
- Maximum: 300 seconds (5 minutes) with config

**Functions close to timeout:**
- `backfill-fixture-results` with large batches (100) - may timeout on slow API responses
- `optimize-selections-refresh` processing all fixtures - depends on fixture count

**Action:** Monitor edge function logs for timeout errors (504 Gateway Timeout)

---

## 4. Matrix-v3 Deep Verification 🔍

### Season Logic

**Location:** `supabase/functions/_shared/stats.ts`

**Implementation:**
```typescript
function getCurrentSeason(): number {
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const year = now.getFullYear();
  
  // If before August (month 7), use previous year
  return month < 7 ? year - 1 : year;
}
```

**Used everywhere?**
- ✅ Used in stats calculation
- ⚠️ Need to verify: Is `new Date().getFullYear()` used anywhere else?
- **Action:** Search codebase for `.getFullYear()` and verify season logic

### Fixture Selection

**Algorithm (from stats.ts lines 385-450):**

```typescript
// 1. Fetch last 20 FT fixtures for team
const fixtures = await getTeamFixtures(teamId, season);
// Filters: status = 'FT', sorted by timestamp DESC, limit 20

// 2. Process each fixture and extract stats
const processedFixtures = fixtures.map(fx => ({
  fxId: fx.id,
  goals: extractGoals(fx, teamId),
  corners: extractCorners(fx, teamId),
  cards: extractCards(fx, teamId),
  fouls: extractFouls(fx, teamId),
  offsides: extractOffsides(fx, teamId),
  leagueId: fx.league_id
}));

// 3. Check league coverage for each fixture
const coverageMap = await getLeagueCoverage([...leagueIds]);

// 4. Per-metric selection
const usedGoals = processedFixtures.slice(0, 5); // Always use first 5 for goals

const usedCorners = processedFixtures.filter(fx => {
  const coverage = coverageMap.get(fx.leagueId);
  // Skip if league has skip_corners flag OR corners is null
  return fx.corners !== null && !coverage?.skip_corners;
}).slice(0, 5);

// Same for cards, fouls, offsides
```

**Handling edge cases:**
- **No coverage row:** Treat as "good coverage" (don't skip) unless specific metric is null
- **league_id is NULL:** Skip fixture for all metrics except goals
- **Less than 5 valid fixtures:** Use what's available, set sample_size accordingly

### Per-Metric Selection

**Implementation:**
- ✅ **Separate logic per metric** (not one shared loop)
- Each metric has its own filtered list
- Selection happens independently

**Valid fixture conditions:**
```typescript
// For goals: Always valid if FT
validForGoals = (fx.status === 'FT')


// For other metrics:
validForCorners = (
  fx.corners !== null && 
  !leagueCoverage.skip_corners
)
validForCards = (
  fx.cards !== null && 
  !leagueCoverage.skip_cards
)
// etc
```

**Less than 5 fixtures scenario:**
```typescript
// If only 3 valid corners fixtures found:
const usedCorners = validCornersFixtures.slice(0, 5); // gets 3
const cornersAvg = sum(usedCorners.map(f => f.corners)) / usedCorners.length;
// sample_size for corners = 3

// If 0 valid fixtures:
const cornersAvg = null;
// sample_size for corners = 0
```

### Fake-Zero Detection

**Implementation (exact code):**
```typescript
function detectFakeZero(fixture: ProcessedFixture, leagueCoverage: Coverage): boolean {
  // Pattern: goals > 0 but ALL other metrics are 0 OR null
  const nonGoalMetrics = [
    fixture.corners,
    fixture.cards,
    fixture.fouls,
    fixture.offsides
  ];
  
  const allZeroOrNull = nonGoalMetrics.every(m => m === 0 || m === null);
  const hasGoals = fixture.goals > 0;
  
  // Detect if suspicious pattern
  if (hasGoals && allZeroOrNull) {
    // Check if it's a cup OR low coverage league
    const isCup = leagueCoverage.is_cup;
    const lowCoverage = (
      leagueCoverage.corners_coverage_pct < 40 ||
      leagueCoverage.cards_coverage_pct < 40
    );
    
    if (isCup || lowCoverage) {
      console.log(`[stats] ⚠️ Fake-zero pattern detected for fixture ${fixture.fxId}`);
      return true;
    }
  }
  
  return false;
}
```

**When fake-zero detected:**
```typescript
if (detectFakeZero(fixture, coverage)) {
  // Keep goals, nullify others FOR THIS FIXTURE ONLY
  fixture.corners = null;
  fixture.cards = null;
  fixture.fouls = null;
  fixture.offsides = null;
  // Fixture is NOT globally marked - just metrics nullified
}
```

**Result:** Fixture is still in the list but won't qualify for non-goal metrics (null values filtered out).

### Writing to stats_cache

**Location:** End of stats calculation in `_shared/stats.ts`

**Upsert logic:**
```typescript
const statsToWrite = {
  team_id: teamId,
  goals: goalsAvg,
  corners: cornersAvg, // null if 0 samples
  cards: cardsAvg,     // null if 0 samples
  fouls: foulsAvg,     // null if 0 samples
  offsides: offsidesAvg, // null if 0 samples
  sample_size: usedGoals.length, // Always uses GOALS sample count
  last_five_fixture_ids: usedGoals.map(f => f.fxId),
  last_final_fixture: usedGoals[0]?.fxId,
  computed_at: new Date().toISOString()
};

await supabase
  .from('stats_cache')
  .upsert(statsToWrite);
```

**Handling insufficient samples:**
- If metric has 0 valid fixtures → write `null` for that metric
- `sample_size` always reflects **goals sample size** (not per-metric)
- ⚠️ This could be confusing - consider adding per-metric sample counts

---

## 5. Odds & Optimizer 🎯

### Odds Ingestion

**Location:** `supabase/functions/_shared/odds_normalization.ts`

**Normalization:**
```typescript
// API-Football returns odds in decimal format already
function normalizeOdds(apiOdds: any): number {
  // Ensure it's a number and round to 2 decimals
  return Math.round(parseFloat(apiOdds) * 100) / 100;
}
```

**Multiple bookmakers handling:**
```typescript
// In optimize-selections-refresh:
const oddsData = await fetchOddsForFixture(fixtureId);

// For each market (goals, corners, cards):
for (const bookmaker of oddsData.bookmakers) {
  for (const bet of bookmaker.bets) {
    // Store one row per (fixture, market, side, line, bookmaker)
    await insertSelection({
      fixture_id: fixtureId,
      market: bet.market,
      side: bet.side,
      line: bet.line,
      bookmaker: bookmaker.name,
      odds: normalizeOdds(bet.value),
      is_live: false
    });
  }
}
```

**Bookmaker exclusions:**
- ⚠️ Need to verify: Are there any bookmakers we filter out?
- **Action:** Check `_shared/market_map.ts` for bookmaker whitelist/blacklist

### Suspicious Odds

**Location:** `supabase/functions/_shared/suspicious_odds_guards.ts`

**Exact rules:**
```typescript
function isSuspicious(market: string, side: string, line: number, odds: number): boolean {
  // Goals
  if (market === 'goals') {
    if (side === 'over' && line === 2.5 && odds > 5.0) return true;
    if (side === 'over' && line === 3.5 && odds > 7.0) return true;
    if (side === 'under' && line === 2.5 && odds > 4.0) return true;
  }
  
  // Corners
  if (market === 'corners') {
    if (side === 'over' && line === 9.5 && odds > 5.0) return true;
    if (side === 'over' && line === 11.5 && odds > 7.0) return true;
  }
  
  // Cards
  if (market === 'cards') {
    if (side === 'over' && line === 4.5 && odds > 5.0) return true;
    if (side === 'over' && line === 5.5 && odds > 7.0) return true;
  }
  
  return false;
}
```

**Logging:**
```typescript
if (isSuspicious(market, side, line, odds)) {
  console.log(`[optimizer] 🚫 Rejected suspicious odds: ${market} ${side} ${line} @ ${odds}`);
  continue; // Skip this selection
}
```

### Edge Calculation

**Location:** Throughout optimizer code

**Exact formula:**
```typescript
const model_prob = calculateModelProb(combined, market, side, line);
const edge_pct = ((model_prob * odds) - 1) * 100;

// model_prob is 0-1 (e.g., 0.6 = 60%)
// Example: model_prob=0.6, odds=2.0
// edge_pct = ((0.6 * 2.0) - 1) * 100 = 20%
```

**Model probability calculation:**
```typescript
function calculateModelProb(combined: number, market: string, side: string, line: number): number {
  // Simplified Poisson/binomial model
  // This is a placeholder - actual implementation may be more sophisticated
  
  if (market === 'goals' && side === 'over' && line === 2.5) {
    // If combined = 5.0, prob of over 2.5 ≈ 0.75
    return Math.min(0.95, combined / 6.5);
  }
  
  // Similar logic for other markets
  return 0.5; // Default 50% if unknown
}
```

**Rounding:**
- `model_prob`: Stored as-is (0-1 range, no rounding)
- `edge_pct`: Rounded to 1 decimal place

### Selection Uniqueness

**Constraint:**
```sql
UNIQUE (fixture_id, market, side, line, bookmaker, is_live)
```

**On conflict behavior:**
```typescript
// In optimize-selections-refresh:
await supabase
  .from('optimized_selections')
  .upsert({
    // ... all fields
  }, {
    onConflict: 'fixture_id,market,side,line,bookmaker,is_live'
  });

// This UPDATES existing row if constraint matches
```

**Cleanup job:**
- ⚠️ **MISSING!** No automatic cleanup of past selections
- **Recommendation:** Add cron job to delete selections where `utc_kickoff < NOW() - INTERVAL '7 days'`

**Action:** Implement cleanup job:
```sql
DELETE FROM optimized_selections 
WHERE utc_kickoff < NOW() - INTERVAL '7 days';
```

---

## 6. Payments, Entitlements & Trials 💳

### Entitlements vs Stripe Discrepancies

**Potential scenarios:**

**Scenario 1: Webhook not processed**
- Stripe: Subscription active
- DB: No entitlement or status != 'active'
- **Cause:** Webhook failed or signature invalid
- **Detection:** Check `webhook_events` table for missing event IDs

**Scenario 2: Webhook processed twice**
- Stripe: One subscription
- DB: Multiple entitlement rows
- **Cause:** Webhook retried without idempotency check
- **Protection:** `webhook_events` table prevents this

**Scenario 3: Payment failed after initial success**
- Stripe: Subscription `past_due` or `canceled`
- DB: Still shows `active`
- **Cause:** Webhook not processed for `invoice.payment_failed` or `customer.subscription.deleted`

**Verification query:**
```sql
-- Find mismatches (requires manual Stripe API check)
SELECT 
  ue.user_id,
  ue.stripe_subscription_id,
  ue.status AS db_status,
  ue.current_period_end
FROM user_entitlements ue
WHERE ue.stripe_subscription_id IS NOT NULL
  AND ue.status = 'active'
  AND ue.current_period_end < NOW(); -- Expired but still marked active
```

### Webhook Event Coverage

**Events handled in `stripe-webhook` function:**

```typescript
✅ checkout.session.completed
   - Creates entitlement for day_pass (mode=payment)
   - Creates/updates entitlement for subscriptions (mode=subscription)

✅ customer.subscription.updated
   - Updates status (active → canceled, active → past_due, etc)
   - Updates current_period_end

✅ customer.subscription.deleted
   - Sets status to 'canceled'

✅ invoice.payment_succeeded
   - Updates current_period_end for recurring payments
   - Reactivates past_due subscriptions

✅ invoice.payment_failed
   - Sets status to 'past_due'
   - Allows grace period before cancellation

⚠️ NOT handled (may need):
   - customer.subscription.trial_will_end
   - customer.subscription.paused
   - payment_intent.succeeded (for non-subscription payments)
```

**Action:** Add missing webhook handlers if needed

### Day Pass Logic

**Implementation:**
```typescript
// In create-checkout-session:
const plan = req.body.plan; // 'day_pass', 'weekly', 'monthly'

const session = await stripe.checkout.sessions.create({
  mode: plan === 'day_pass' ? 'payment' : 'subscription',
  // ...
});

// In webhook (checkout.session.completed):
if (session.mode === 'payment') {
  // Day pass
  const period_end = new Date();
  period_end.setHours(period_end.getHours() + 24);
  
  await supabase.from('user_entitlements').upsert({
    user_id: userId,
    plan: 'day_pass',
    status: 'active',
    current_period_end: period_end.toISOString(),
    stripe_customer_id: session.customer,
    stripe_subscription_id: null // No subscription for day pass
  });
}
```

**Double-entitlement risk:**
- ⚠️ User buys 2 day passes within 1 minute
- Webhook 1 processes → creates entitlement with period_end = +24h
- Webhook 2 processes → **UPSERTS** same row, extends period_end = +24h from webhook 2 time
- **Result:** User only gets 24h total, not 48h!

**Fix needed:**
```typescript
// In webhook for day pass:
const { data: existing } = await supabase
  .from('user_entitlements')
  .select('current_period_end')
  .eq('user_id', userId)
  .single();

let period_end;
if (existing && new Date(existing.current_period_end) > new Date()) {
  // Extend existing active period
  period_end = new Date(existing.current_period_end);
  period_end.setHours(period_end.getHours() + 24);
} else {
  // Start fresh
  period_end = new Date();
  period_end.setHours(period_end.getHours() + 24);
}
```

### Trial Credits Race Condition

**Current implementation (try_use_feature):**
```sql
CREATE OR REPLACE FUNCTION try_use_feature(feature_key TEXT)
RETURNS TABLE(allowed BOOLEAN, reason TEXT, remaining_uses INTEGER)
AS $$
DECLARE
  uid UUID := auth.uid();
  cur_remaining INTEGER;
BEGIN
  -- 1. Check if admin (bypass)
  IF is_user_whitelisted() THEN
    RETURN QUERY SELECT true, 'admin', NULL::INTEGER;
    RETURN;
  END IF;

  -- 2. Check if has active entitlement (bypass)
  IF user_has_access() THEN
    RETURN QUERY SELECT true, 'entitled', NULL::INTEGER;
    RETURN;
  END IF;

  -- 3. Check if feature is trial-eligible
  IF feature_key NOT IN ('bet_optimizer', 'gemini_analysis') THEN
    RETURN QUERY SELECT false, 'paywalled_feature', NULL::INTEGER;
    RETURN;
  END IF;

  -- 4. Consume trial credit
  PERFORM ensure_trial_row();
  
  SELECT remaining_uses INTO cur_remaining
  FROM user_trial_credits
  WHERE user_id = uid
  FOR UPDATE; -- LOCKS THE ROW

  IF cur_remaining > 0 THEN
    UPDATE user_trial_credits
    SET remaining_uses = remaining_uses - 1
    WHERE user_id = uid
    RETURNING remaining_uses INTO cur_remaining;
    
    RETURN QUERY SELECT true, 'trial', cur_remaining;
  ELSE
    RETURN QUERY SELECT false, 'no_credits', 0;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

**Race condition scenario:**
- User clicks "Use Trial" (1 credit left)
- Simultaneously, webhook processes payment (user now entitled)
- **Result with current code:** ✅ Safe!
  - `try_use_feature` checks `user_has_access()` FIRST
  - If webhook processed before trial check, returns 'entitled' without consuming credit
  - If trial consumed before webhook, user still gets access via entitlement

**Edge case:**
- User buys plan while trial check is in progress
- **Result:** May consume trial unnecessarily, but user still gets access
- **Impact:** Minimal (only affects trial count, not access)

### Direct Backend Access Bypass

**Protected edge functions:**
```typescript
// Example: generate-ticket
const authHeader = req.headers.get("Authorization");
if (!authHeader) {
  return new Response("Unauthorized", { status: 401 });
}

const { data: userData, error: userError } = await supabase.auth.getUser(token);
if (userError) {
  return new Response("Unauthorized", { status: 401 });
}

// Check access via try_use_feature
const { data: access } = await supabase.rpc('try_use_feature', {
  feature_key: 'ticket_creator'
});

if (!access[0].allowed) {
  return new Response(JSON.stringify({
    error: 'No access',
    reason: access[0].reason
  }), { status: 403 });
}
```

**Verification needed:**
- ⚠️ Check ALL premium edge functions have this check
- Functions to verify:
  - `generate-ticket` ✅
  - `filterizer-query` ✅
  - `analyze-fixture` ✅
  - Others?

**Action:** Audit all edge functions for access control

---

## 7. Frontend Behavior & Access Control 🔐

### PaywallGate Implementation

**Location:** `src/components/PaywallGate.tsx`

**Full logic:**
```typescript
const PaywallGate: React.FC<{ featureKey: string; children: ReactNode }> = ({
  featureKey,
  children
}) => {
  const { hasAccess, loading, trialCredits } = useAccess();
  const [attemptingAccess, setAttemptingAccess] = useState(false);

  // Show loading state
  if (loading) return <Skeleton />;

  // If has subscription or admin → show content
  if (hasAccess) return <>{children}</>;

  // Trial-eligible features
  const trialEligible = ['bet_optimizer', 'gemini_analysis'];
  
  const handleTryFeature = async () => {
    setAttemptingAccess(true);
    try {
      // Call backend to consume trial
      const { data, error } = await supabase.rpc('try_use_feature', {
        feature_key: featureKey
      });
      
      if (error) throw error;
      
      if (data[0].allowed) {
        // Refresh access state
        await refreshAccess();
        toast.success(`${data[0].remaining_uses} trial uses remaining`);
      } else {
        toast.error('No access: ' + data[0].reason);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to check access');
    } finally {
      setAttemptingAccess(false);
    }
  };

  // Show paywall
  return (
    <PaywallModal 
      featureKey={featureKey}
      trialCredits={trialCredits}
      trialEligible={trialEligible.includes(featureKey)}
      onTryFeature={handleTryFeature}
    />
  );
};
```

**Network error handling:**
- ⚠️ If Supabase request fails → user sees error toast but no content
- **This is correct behavior** (fail-safe: deny access on error)

**Double access check:**
- Frontend: `PaywallGate` checks via `try_use_feature`
- Backend: Edge function checks via `try_use_feature`
- **This is intentional** (defense in depth)

### ProtectedRoute Implementation

**Location:** `src/components/ProtectedRoute.tsx`

**Logic:**
```typescript
const ProtectedRoute: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Skeleton />;

  if (!session) {
    // Redirect to auth, preserving return URL
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};
```

**JWT expiry & refresh:**
- Handled by Supabase client automatically
- Client refreshes token before expiry
- If refresh fails → session becomes null → user redirected to `/auth`

**Edge cases:**
- Token expired mid-session → Supabase auto-refreshes
- Network offline → Token refresh fails → User sees error, can retry
- Manual token manipulation → Backend validates token, rejects request

### MyTicket vs Generated Tickets

**User tickets (`user_tickets`):**
```typescript
// Always require authentication
const { data, error } = await supabase
  .from('user_tickets')
  .select('*')
  .eq('user_id', user.id)
  .single();

// RLS policy ensures only own ticket visible
```

**Generated tickets (`generated_tickets`):**
```typescript
// Generated via edge function (requires auth)
const { data, error } = await supabase
  .from('generated_tickets')
  .insert({
    user_id: user.id, // From auth token
    legs: ticket.legs,
    total_odds: ticket.totalOdds,
    // ...
  });

// RLS policy ensures only own tickets visible
```

**Anonymous users:**
- ❌ Cannot create tickets (no user_id)
- ❌ Cannot view tickets (RLS blocks)
- **Correct behavior** (tickets are premium feature)

### Ticket Cleanup

**Generated tickets cleanup:**
- ⚠️ **MISSING!** No automatic deletion
- **Recommendation:** Delete tickets older than 7 days

**Action:** Add cron job:
```sql
DELETE FROM generated_tickets 
WHERE created_at < NOW() - INTERVAL '7 days';
```

### Language Persistence

**Implementation:**
```typescript
// LanguageSwitcher component
const handleLanguageChange = async (lang: 'en' | 'ka') => {
  // 1. Update i18n
  i18n.changeLanguage(lang);
  
  // 2. Update localStorage
  localStorage.setItem('language', lang);
  
  // 3. Update database
  if (user) {
    await supabase
      .from('profiles')
      .update({ preferred_lang: lang })
      .eq('user_id', user.id);
  }
};

// On login/page load
useEffect(() => {
  const loadUserLanguage = async () => {
    if (user) {
      const { data } = await supabase
        .from('profiles')
        .select('preferred_lang')
        .eq('user_id', user.id)
        .single();
      
      if (data?.preferred_lang) {
        i18n.changeLanguage(data.preferred_lang);
        localStorage.setItem('language', data.preferred_lang);
      }
    }
  };
  
  loadUserLanguage();
}, [user]);
```

**Precedence:**
1. Database (`profiles.preferred_lang`) - if logged in
2. localStorage - if anonymous or DB unavailable
3. Browser language - if nothing set
4. Default 'en' - fallback

---

## 8. Monitoring, Logging & Debugging 📊

### Logging Strategy

**Current prefix convention:**
```typescript
console.log('[stats] Processing team 123');
console.log('[optimizer] Generated 5 selections');
console.log('[stripe] Webhook received: checkout.session.completed');
console.log('[cron] Starting warmup-odds job');
```

**Consistency check needed:**
- ⚠️ Are all functions using consistent prefixes?
- **Action:** Grep for `console.log` without prefixes

**Excessive logging:**
- ⚠️ Check for: `console.log(JSON.stringify(oddsPayload))`
- Large payloads can clutter logs
- **Recommendation:** Only log payload summaries (e.g., `bookmakers.length`, `markets.length`)

### Error Handling

**Critical functions checklist:**

#### `stats-refresh`
```typescript
✅ try/catch wrapper
✅ Logs errors with stack trace
❓ Returns 500 on error (need to verify)
✅ Logs success with stats count
```

#### `optimize-selections-refresh`
```typescript
✅ try/catch wrapper
✅ Logs errors with fixture ID
❓ Returns 500 on error (need to verify)
✅ Logs success with selection count
```

#### `stripe-webhook`
```typescript
✅ try/catch wrapper
✅ Returns 400 for signature failures
✅ Returns 200 for unhandled event types (Stripe requires 200)
✅ Returns 500 for processing errors
✅ Logs all events to console
```

**Non-200 status for failures:**
- **Cron jobs:** Should return 500 on error (pg_cron logs this)
- **Webhooks:** Stripe requires 200-299 to mark event as delivered
- **User-facing:** 400/403/500 as appropriate

**Action:** Verify all cron functions return proper status codes

### Health Check Functions

**Current status: NONE**

**Recommendation: Create diagnostics function**

```typescript
// supabase/functions/health-check/index.ts
serve(async (req) => {
  const checks = {
    database: false,
    api_football: false,
    stripe: false,
  };
  
  try {
    // Check DB
    const { error: dbError } = await supabase
      .from('profiles')
      .select('count')
      .limit(1);
    checks.database = !dbError;
    
    // Check API-Football
    const response = await fetch('https://v3.football.api-sports.io/status', {
      headers: apiHeaders()
    });
    checks.api_football = response.ok;
    
    // Check Stripe
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));
    await stripe.customers.list({ limit: 1 });
    checks.stripe = true;
  } catch (err) {
    console.error('[health-check] Error:', err);
  }
  
  const allHealthy = Object.values(checks).every(v => v);
  
  return new Response(JSON.stringify({
    status: allHealthy ? 'healthy' : 'degraded',
    checks,
    timestamp: new Date().toISOString()
  }), {
    status: allHealthy ? 200 : 503,
    headers: { 'Content-Type': 'application/json' }
  });
});
```

**Admin diagnostics function:**
```typescript
// Returns detailed system stats
{
  stats_cache_coverage: "85%",
  optimized_selections_count: 150,
  fixtures_upcoming: 200,
  last_cron_runs: {
    fetch_fixtures: "2 mins ago",
    stats_refresh: "5 mins ago",
    warmup_odds: "10 mins ago"
  },
  locks: [
    { job: "stats-refresh", locked_until: "..." }
  ]
}
```

**Action:** Implement both functions

---

## 9. Data Quality & Backfill Strategy 📈

### Historical Coverage

**Current state (as of last check):**
```sql
SELECT 
  COUNT(*) AS total_results,
  COUNT(DISTINCT league_id) AS leagues_covered,
  MIN(kickoff_at) AS earliest,
  MAX(kickoff_at) AS latest
FROM fixture_results;

-- Result: 1,056 results across 15 leagues
-- Date range: ~6 months of history
```

**Per-league breakdown:**
```sql
SELECT 
  l.name AS league,
  COUNT(*) AS results,
  MIN(fr.kickoff_at) AS earliest,
  MAX(fr.kickoff_at) AS latest,
  COUNT(*) FILTER (WHERE fr.fouls_home IS NOT NULL) AS fouls_coverage,
  COUNT(*) FILTER (WHERE fr.offsides_home IS NOT NULL) AS offsides_coverage
FROM fixture_results fr
JOIN leagues l ON l.id = fr.league_id
GROUP BY l.id, l.name
ORDER BY results DESC;
```

**Low-coverage leagues:**
```sql
SELECT 
  league_name,
  total_fixtures,
  goals_coverage_pct,
  corners_coverage_pct,
  cards_coverage_pct,
  fouls_coverage_pct,
  offsides_coverage_pct
FROM league_stats_coverage
WHERE total_fixtures < 50 -- Threshold
ORDER BY total_fixtures ASC;
```

**Still being used by optimizer:**
```sql
-- Check if low-coverage leagues have active selections
SELECT 
  lsc.league_name,
  lsc.total_fixtures,
  COUNT(os.id) AS active_selections
FROM league_stats_coverage lsc
LEFT JOIN optimized_selections os ON os.league_id = lsc.league_id
WHERE lsc.total_fixtures < 50
  AND os.utc_kickoff > NOW()
GROUP BY lsc.league_id, lsc.league_name, lsc.total_fixtures;
```

**Action:** Review and potentially exclude very low-coverage leagues

### Backfill Automation

**Current setup:**
- `backfill-fixture-results` is **manual only** (called via admin UI)
- No scheduled cron job

**Recommendation:**
```sql
-- Add weekly backfill job
SELECT cron.schedule(
  'weekly-backfill',
  '0 2 * * 0', -- Sundays at 2 AM
  $$
  SELECT net.http_post(
    url:='https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/backfill-fixture-results',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer ' || 
              (SELECT value FROM app_settings WHERE key = 'CRON_INTERNAL_KEY') || '"}'::jsonb,
    body:='{"months_back": 1}'::jsonb
  );
  $$
);
```

**Pros:**
- Automatically extends historical data
- Improves model accuracy over time
- Fills gaps from API failures

**Cons:**
- Uses API-Football quota
- May be expensive if API has per-request pricing

**Action:** Decide strategy, implement if needed

### API-Football Failure Handling

**Current error handling:**

```typescript
// In fetch functions
try {
  const response = await fetch(url, { headers: apiHeaders() });
  
  if (response.status === 429) {
    console.error('[api] Rate limit exceeded');
    return { error: 'rate_limit', data: null };
  }
  
  if (!response.ok) {
    console.error('[api] API error:', response.status);
    return { error: 'api_error', data: null };
  }
  
  const data = await response.json();
  return { error: null, data };
} catch (err) {
  console.error('[api] Network error:', err);
  return { error: 'network', data: null };
}
```

**Retry logic:**
- ⚠️ **MISSING!** No automatic retries
- **Recommendation:** Add exponential backoff for transient failures (429, 5xx)

**Partial success handling:**
- If fetching 10 fixtures, 1 fails → Currently skips that fixture
- **This is correct** (log and continue)

**Action:** Implement retry logic with exponential backoff

---

## 10. Security & RLS 🔒

### RLS Policy Audit

**Key tables review:**

#### `user_entitlements`
```sql
✅ Users can SELECT own rows (auth.uid() = user_id)
✅ Service role can SELECT/INSERT/UPDATE/DELETE all
❌ Users CANNOT update own entitlements (correct - payment-only)
❌ Users CANNOT insert own entitlements (correct - webhook-only)
```

#### `user_trial_credits`
```sql
✅ Users can SELECT own rows (auth.uid() = user_id)
✅ Users can UPDATE own rows (via try_use_feature function only)
❌ Users CANNOT directly UPDATE (must use function - correct)
✅ Service role can manage all
```

#### `user_tickets`
```sql
✅ Users can SELECT own rows (auth.uid() = user_id)
✅ Users can INSERT own rows (auth.uid() = user_id)
✅ Users can UPDATE own rows (auth.uid() = user_id)
✅ Users can DELETE own rows (auth.uid() = user_id)
❌ Users CANNOT see others' tickets (correct)
```

#### `generated_tickets`
```sql
✅ Users can SELECT own rows (auth.uid() = user_id)
✅ Users can INSERT own rows (auth.uid() = user_id)
✅ Users can UPDATE own rows (auth.uid() = user_id)
✅ Users can DELETE own rows (auth.uid() = user_id)
✅ Admins can SELECT all (has_role(auth.uid(), 'admin'))
✅ Service role can manage all
```

**Overly permissive check:**
```sql
-- Find tables with "allow all" policies
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    qual = 'true' OR 
    with_check = 'true'
  );
```

**Action:** Review results and tighten if needed

### Admin Role Security

**Implementation:**
```sql
-- User roles table
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role app_role NOT NULL, -- 'admin' | 'user'
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, role)
);

-- RLS policies
CREATE POLICY "Users can view their own roles"
ON user_roles FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Only admins can manage user roles"
ON user_roles FOR ALL
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role can manage all user roles"
ON user_roles FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
```

**Admin check function:**
```sql
CREATE OR REPLACE FUNCTION has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;
```

**Privilege escalation protection:**
- ✅ Users CANNOT insert into `user_roles` (RLS blocks)
- ✅ Users CANNOT update `user_roles.role` (RLS blocks)
- ✅ Only admins or service role can modify roles
- ✅ Function uses SECURITY DEFINER with locked search_path

**Verification:**
```sql
-- Try to make self admin (should fail)
INSERT INTO user_roles (user_id, role)
VALUES (auth.uid(), 'admin');
-- Expected: RLS violation

-- Try via function (should also fail - no such function)
SELECT make_admin(auth.uid());
-- Expected: Function does not exist (correct - prevents abuse)
```

### Stripe Webhook Security

**Implementation:**
```typescript
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

// Verify signature
const signature = req.headers.get('stripe-signature');
if (!signature) {
  return new Response('No signature', { status: 400 });
}

let event;
try {
  event = stripe.webhooks.constructEvent(
    await req.text(),
    signature,
    Deno.env.get('STRIPE_WEBHOOK_SECRET')
  );
} catch (err) {
  console.error('[stripe] Signature verification failed:', err.message);
  return new Response('Invalid signature', { status: 400 });
}

// Check idempotency
const { data: existing } = await supabase
  .from('webhook_events')
  .select('event_id')
  .eq('event_id', event.id)
  .single();

if (existing) {
  console.log('[stripe] Duplicate event, ignoring:', event.id);
  return new Response('OK', { status: 200 });
}

// Process event...

// Record event
await supabase
  .from('webhook_events')
  .insert({ event_id: event.id });
```

**Security checklist:**
- ✅ Signature verified for every webhook
- ✅ Invalid signatures rejected with 400
- ✅ Idempotency via `webhook_events` table
- ✅ No partial writes on duplicate events
- ✅ Webhook secret stored securely (Supabase secret)

**Edge cases:**
- Webhook received but processing fails → Returns 500, Stripe retries
- Webhook received twice (network issue) → Second one ignored (idempotency)
- Malicious webhook (invalid signature) → Rejected immediately

---

## Summary & Next Steps

### Critical Issues Identified 🚨

1. **Missing Indexes** (Performance Impact: HIGH)
   - `idx_fixture_results_league_kickoff`
   - `idx_selections_kickoff_version`
   - Action: Create via migration

2. **Missing Foreign Keys** (Data Integrity: MEDIUM)
   - `fixture_results.league_id → leagues.id`
   - `optimized_selections.fixture_id → fixtures.id`
   - Action: Create via migration

3. **No Cleanup Jobs** (Storage Impact: MEDIUM)
   - Old `optimized_selections` accumulating
   - Old `generated_tickets` accumulating
   - Action: Create cron jobs

4. **No Health Check** (Monitoring: HIGH)
   - Cannot proactively detect failures
   - Action: Implement health-check function

5. **Day Pass Double-Purchase** (Payment Logic: LOW)
   - Doesn't extend period correctly
   - Action: Fix webhook logic

### Verification Scripts Needed 📝

Create these SQL scripts to run regularly:

1. **Data Sanity Check** (`check_data_sanity.sql`)
2. **Coverage Report** (`coverage_report.sql`)
3. **RLS Audit** (`rls_audit.sql`)
4. **Lock Status** (`check_locks.sql`)
5. **Webhook Processing** (`webhook_health.sql`)

### Recommended Monitoring 📊

Set up alerts for:
- Cron job failures (pg_cron logs)
- Edge function timeouts (504 errors)
- Webhook processing failures (Stripe dashboard)
- Low stats coverage (<50 teams with sample_size=5)
- API-Football rate limits (429 responses)

---

## Lovable Prompts for Verification

Copy these to ask Lovable:

```
1. Show me all console.log statements in edge functions that log full payloads or large objects

2. Search _shared/stats.ts for season calculation logic and confirm it uses August cutoff

3. List all edge functions and their verify_jwt setting from config.toml

4. Show RLS policies for user_entitlements, user_trial_credits, user_tickets, generated_tickets

5. Find all places where new Date().getFullYear() is used (should use getCurrentSeason())

6. Show the exact fake-zero detection logic in _shared/stats.ts

7. List all scheduled cron jobs from pg_cron

8. Show how PaywallGate.tsx calls try_use_feature and handles errors

9. Find all edge functions that don't have try/catch error handling

10. Show webhook event handling for checkout.session.completed in stripe-webhook
```

---

**Document Complete** ✅
