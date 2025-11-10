# QA Re-Run Report

## Executive Summary

✅ **All 6 critical and medium issues have been resolved**

### Code Changes Made

| Issue ID | Status | Description |
|----------|--------|-------------|
| ISSUE-007 (CRITICAL) | ✅ FIXED | PaywallGate now consumes trial credits via `try_use_feature` RPC |
| ISSUE-002 (MEDIUM) | ✅ FIXED | Ticket Creator now wrapped with PaywallGate (trial allowed) |
| ISSUE-003 (MEDIUM) | ✅ FIXED | Standardized plan key to `day_pass` everywhere |
| ISSUE-008 (MEDIUM) | ✅ FIXED | Consistent feature-key mapping: `bet_optimizer` for all bet tools, `gemini_analysis` for AI |
| ISSUE-009 (MEDIUM) | ✅ FIXED | Removed redundant `charge.succeeded` handler (Day Pass handled by checkout.session.completed) |
| ISSUE-004 (LOW) | ✅ FIXED | billing-checkout now uses `APP_URL` env var for redirects |

---

## 1. Implementation Details

### ISSUE-007: Trial Credit Consumption in PaywallGate

**File:** `src/components/PaywallGate.tsx`

**Changes:**
- Added `featureKey` prop to specify which RPC feature key to use
- Added `useEffect` hook that calls `supabase.rpc('try_use_feature', { feature_key: featureKey })` on mount
- Added `consuming` and `consumed` state to prevent double-clicks
- Trial credits are now atomically decremented in the database
- UI shows "Activating..." state during consumption
- Calls `refreshAccess()` after consumption to update badge UI

**Key Logic:**
```typescript
// If paid/admin → no trial consumption needed
// If trial-eligible and has credits → consume one via RPC
// RPC returns { allowed, reason, remaining_uses }
```

### ISSUE-002: Ticket Creator Paywall

**File:** `src/pages/Index.tsx`

**Changes:**
- Ticket Creator FAB (line 1221) wrapped with `<PaywallGate featureKey="bet_optimizer" allowTrial={true}>`
- TicketCreatorDialog (line 1232) wrapped with `<PaywallGate featureKey="bet_optimizer" allowTrial={true}>`

**Result:** Free users must subscribe or use trial credits to access Ticket Creator

### ISSUE-003: Plan Name Standardization

**File:** `supabase/functions/stripe-webhook/index.ts`

**Changes:**
- Line 108: Changed `plan: "daypass"` → `plan: "day_pass"` (checkout.session.completed)
- Removed duplicate `charge.succeeded` handler entirely (see ISSUE-009)

**Result:** Consistent `day_pass` plan key in database and code

### ISSUE-008: Feature-Key Mapping

**Files:** `src/pages/Index.tsx`, `src/components/PaywallGate.tsx`

**Mapping:**
- **Filterizer** → `featureKey="bet_optimizer"`
- **Winner** → `featureKey="bet_optimizer"`
- **Team Totals** → `featureKey="bet_optimizer"`
- **Ticket Creator** → `featureKey="bet_optimizer"`
- **AI Analysis** → `featureKey="gemini_analysis"` (already in analyze-ticket edge function)

**Changes:**
- Updated all 4 bet tool PaywallGate instances to include `featureKey="bet_optimizer"` and `allowTrial={true}`

### ISSUE-009: Remove Redundant charge.succeeded Handler

**File:** `supabase/functions/stripe-webhook/index.ts`

**Changes:**
- Deleted lines 271-314 (entire `case "charge.succeeded"` block)

**Rationale:**
- Day Pass is a one-time payment handled by `checkout.session.completed` (lines 98-118)
- `charge.succeeded` fires for ALL charges (including subscription renewals)
- Duplicate Day Pass entitlements were being created on subscription charges
- Subscriptions are handled by `invoice.payment_succeeded` and `customer.subscription.*` events

### ISSUE-004: APP_URL Environment Variable

**File:** `supabase/functions/billing-checkout/index.ts`

**Changes:**
- Lines 83-86: Replaced hardcoded `https://ticketai.bet` with `Deno.env.get("APP_URL") || "https://ticketai.bet"`

**Result:** Redirects now work in all environments (dev/staging/prod)

---

## 2. Database Migration

**Function:** `public.try_use_feature(feature_key text)`

Successfully deployed with:
- ✅ Admin bypass via `is_user_whitelisted()`
- ✅ Paid bypass via `user_has_access()`
- ✅ Feature whitelist: only `bet_optimizer` and `gemini_analysis` consume trial
- ✅ Atomic decrement with `FOR UPDATE` lock
- ✅ Returns `(allowed boolean, reason text, remaining_uses integer)`

---

## 3. Test Matrix

### Feature: Filterizer, Winner, Team Totals, Ticket Creator

| User Type | Trial Credits | Expected Result | Test Status |
|-----------|---------------|-----------------|-------------|
| FREE (5 credits) | 5 → 4 → 3 → 2 → 1 | ✅ Each use decrements; access granted | **READY TO TEST** |
| FREE (0 credits) | 0 | ❌ Paywall shown; "Trial expired" message | **READY TO TEST** |
| PAID (Monthly) | N/A | ✅ Bypass; no trial consumption | **READY TO TEST** |
| ADMIN | N/A | ✅ Bypass; no trial consumption | **READY TO TEST** |
| Day Pass | N/A | ✅ Bypass; no trial consumption (24h) | **READY TO TEST** |

### Feature: AI Analysis (Gemini)

| User Type | Trial Credits | Expected Result | Test Status |
|-----------|---------------|-----------------|-------------|
| FREE (5 credits) | 5 → 4 → 3 → 2 → 1 | ✅ Each analysis decrements; access granted | **READY TO TEST** |
| FREE (0 credits) | 0 | ❌ 402 error; "PAYWALL" code | **READY TO TEST** |
| PAID (Monthly) | N/A | ✅ Bypass; no trial consumption | **READY TO TEST** |

---

## 4. Stripe Webhook Validation

### Day Pass Flow

**Events:**
1. `checkout.session.completed` (mode=payment, priceId=day_pass)
   - ✅ Creates `user_entitlements` with `plan='day_pass'`, `status='active'`, `current_period_end=now()+24h`

**Expected DB State:**
```sql
SELECT user_id, plan, status, current_period_end, stripe_subscription_id
FROM user_entitlements
WHERE plan = 'day_pass';

-- Result: plan='day_pass', status='active', current_period_end~24h from now, stripe_subscription_id=NULL
```

### Monthly Subscription Flow

**Events:**
1. `checkout.session.completed` (mode=subscription)
   - ✅ Creates `user_entitlements` with `plan='monthly'`, `status='active'`
2. `customer.subscription.created/updated`
   - ✅ Confirms status and period_end
3. `invoice.payment_succeeded`
   - ✅ Confirms `status='active'`

**Expected DB State:**
```sql
SELECT user_id, plan, status, current_period_end, stripe_subscription_id
FROM user_entitlements
WHERE plan = 'monthly';

-- Result: plan='monthly', status='active', current_period_end=~30 days, stripe_subscription_id=sub_xxx
```

### Idempotency Check

**Test:** Replay webhook events

```sql
SELECT COUNT(*) FROM webhook_events WHERE event_id = 'evt_test_123';
-- Should be 1 (not multiple)

SELECT COUNT(*) FROM user_entitlements WHERE user_id = 'test_user_id';
-- Should be 1 (not duplicate rows)
```

---

## 5. Manual Test Procedures

### Prerequisites

1. **Create Test Users:**

```sql
-- FREE_USER (no subscription, 5 trial credits)
INSERT INTO auth.users (id, email) VALUES ('free-user-id', 'free@test.com');
INSERT INTO user_trial_credits (user_id, remaining_uses) VALUES ('free-user-id', 5);

-- PAID_USER (monthly subscription)
INSERT INTO auth.users (id, email) VALUES ('paid-user-id', 'paid@test.com');
INSERT INTO user_entitlements (user_id, plan, status, current_period_end)
VALUES ('paid-user-id', 'monthly', 'active', now() + interval '30 days');
```

2. **Warm Up Data:**

```bash
# Fetch fixtures for next 5 days
curl -X POST {APP_URL}/functions/v1/fetch-fixtures \
  -H "Authorization: Bearer {SUPABASE_ANON_KEY}"

# Run 120h optimizer
curl -X POST {APP_URL}/functions/v1/optimize-selections-refresh \
  -H "Authorization: Bearer {CRON_INTERNAL_KEY}" \
  -d '{"window_hours": 120, "force": true}'
```

### Test Steps

#### Test 1: FREE_USER Trial Consumption (Filterizer)

1. Log in as FREE_USER
2. Check trial credits: `SELECT remaining_uses FROM user_trial_credits WHERE user_id = auth.uid();` → Expect: 5
3. Open Filterizer
4. Observe "Activating..." loading state
5. After load, check credits again → Expect: 4
6. Use Filterizer 4 more times → Credits: 3, 2, 1, 0
7. On 6th attempt, expect Paywall screen with "Trial expired" message
8. Check DB: `SELECT * FROM user_trial_credits WHERE user_id = auth.uid();` → Expect: `remaining_uses=0`

#### Test 2: FREE_USER Trial Consumption (AI Analysis)

1. Log in as FREE_USER (reset to 5 credits if needed)
2. Add a 5-leg ticket
3. Click "AI Analysis"
4. Check network: `POST /functions/v1/analyze-ticket` → Status: 200
5. Check credits: → Expect: 4
6. Repeat 4 more times → Credits: 3, 2, 1, 0
7. On 6th attempt, expect 402 error with `code: "PAYWALL"`

#### Test 3: PAID_USER Bypass

1. Log in as PAID_USER
2. Open Filterizer → No loading, immediate access
3. Check credits: → Should remain `NULL` or unchanged (no consumption)
4. Use Winner, Team Totals, Ticket Creator → All bypass
5. Use AI Analysis → Bypass (no 402 error)

#### Test 4: Day Pass Purchase

1. Log in as FREE_USER (no credits)
2. Go to /pricing
3. Click "Buy Day Pass" (Stripe test mode)
4. Complete checkout (card: 4242 4242 4242 4242)
5. Redirected to /account?checkout=success
6. Check DB:
   ```sql
   SELECT plan, status, current_period_end
   FROM user_entitlements
   WHERE user_id = auth.uid();
   -- Expect: plan='day_pass', status='active', current_period_end≈24h
   ```
7. Open Filterizer → Immediate access (no trial consumption)
8. Wait 24h (or UPDATE current_period_end to past)
9. Open Filterizer → Paywall shown again

#### Test 5: Webhook Idempotency

1. Capture a webhook event ID from Stripe logs
2. Replay the webhook manually:
   ```bash
   stripe trigger checkout.session.completed --override checkout_session:metadata.user_id=test-user
   ```
3. Check DB:
   ```sql
   SELECT COUNT(*) FROM webhook_events WHERE event_id = 'evt_xxx';
   -- Expect: 1 (not 2)
   
   SELECT COUNT(*) FROM user_entitlements WHERE user_id = 'test-user';
   -- Expect: 1 (not duplicate)
   ```

---

## 6. SQL Verification Queries

### Check Trial Credits

```sql
SELECT user_id, remaining_uses, created_at, updated_at
FROM user_trial_credits
WHERE user_id = auth.uid();
```

### Check Entitlements

```sql
SELECT user_id, plan, status, current_period_end, stripe_customer_id, stripe_subscription_id
FROM user_entitlements
WHERE user_id = auth.uid();
```

### Check Webhook Processing

```sql
SELECT event_id, created_at
FROM webhook_events
ORDER BY created_at DESC
LIMIT 10;
```

### Check Day Pass Expiry

```sql
SELECT user_id, plan, status,
       current_period_end,
       (current_period_end > now()) AS is_active
FROM user_entitlements
WHERE plan = 'day_pass';
```

---

## 7. Acceptance Criteria

| Criteria | Status | Evidence |
|----------|--------|----------|
| ✅ Trials: each use decrements `user_trial_credits.remaining_uses` | 🟡 PENDING TEST | Run Test 1 |
| ✅ When 0 credits → paywall shown | 🟡 PENDING TEST | Run Test 1 step 7 |
| ✅ Ticket Creator paywall enforced for FREE users | 🟡 PENDING TEST | Open Ticket Creator as FREE_USER with 0 credits |
| ✅ PAID/Day Pass users bypass paywall | 🟡 PENDING TEST | Run Test 3 & Test 4 |
| ✅ Day Pass creates `plan='day_pass'`, status='active', period_end≈+24h | 🟡 PENDING TEST | Run Test 4 step 6 |
| ✅ No duplicate entitlements when replaying Stripe events | 🟡 PENDING TEST | Run Test 5 |
| ✅ `APP_URL`-based redirects work in all environments | ✅ CODE VERIFIED | Check billing-checkout lines 83-86 |

---

## 8. Runbook: One-Click Test Setup

### Step 1: Create Test Users

```sql
-- Execute in Supabase SQL Editor or via psql

-- 1. FREE_USER
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, email_change, email_change_token_new, recovery_token)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'free@test.com',
  crypt('password123', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  false,
  '',
  '',
  '',
  ''
);

INSERT INTO user_trial_credits (user_id, remaining_uses)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 5);

-- 2. PAID_USER
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, email_change, email_change_token_new, recovery_token)
VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'paid@test.com',
  crypt('password123', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  false,
  '',
  '',
  '',
  ''
);

INSERT INTO user_entitlements (user_id, plan, status, current_period_end, stripe_customer_id, stripe_subscription_id, source)
VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'monthly',
  'active',
  now() + interval '30 days',
  'cus_test_paid',
  'sub_test_monthly',
  'stripe'
);
```

### Step 2: Warm Up Fixtures & Optimizer

```bash
# Set your environment
export APP_URL="https://your-app.lovable.app"
export SUPABASE_ANON_KEY="your_anon_key"
export CRON_KEY="your_cron_key"

# Fetch fixtures (next 5 days)
curl -X POST "${APP_URL}/functions/v1/fetch-fixtures" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json"

# Run 120h optimizer with force
curl -X POST "${APP_URL}/functions/v1/optimize-selections-refresh" \
  -H "Authorization: Bearer ${CRON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"window_hours": 120, "force": true}'
```

### Step 3: Verify Data

```sql
-- Check fixtures loaded
SELECT COUNT(*) FROM fixtures 
WHERE utc_kickoff BETWEEN now() AND now() + interval '120 hours'
  AND status IN ('NS', 'TBD');
-- Expect: >0

-- Check optimizer ran
SELECT COUNT(*) FROM optimized_selections
WHERE utc_kickoff >= now();
-- Expect: >0

-- Check test users exist
SELECT email, id FROM auth.users WHERE email IN ('free@test.com', 'paid@test.com');
-- Expect: 2 rows
```

---

## 9. Remaining Low-Risk Items

These do NOT block production but should be addressed in a future sprint:

1. **ISSUE-005 (LOW):** Add Stripe product mapping to frontend for tier badges
2. **ISSUE-006 (LOW):** Improve webhook error messages (e.g., missing user_id)
3. **ISSUE-010 (LOW):** Add integration tests for trial consumption edge cases
4. **ISSUE-011 (LOW):** Add analytics tracking for trial-to-paid conversion

---

## 10. Deployment Checklist

Before going live:

- [ ] Run all manual tests (Test 1-5)
- [ ] Verify all acceptance criteria pass
- [ ] Check Stripe test mode → live mode transition:
  - [ ] Update price IDs in `stripePrices.ts`
  - [ ] Update `STRIPE_SECRET_KEY` to live key
  - [ ] Update `STRIPE_WEBHOOK_SECRET` to live webhook secret
- [ ] Confirm `APP_URL` env var set correctly in production
- [ ] Enable Stripe Customer Portal for production
- [ ] Test Day Pass purchase in live mode
- [ ] Test Monthly subscription in live mode
- [ ] Monitor webhook logs for 24h after launch

---

## Changelog

### 2025-01-XX - Critical Fixes

**Added:**
- Trial credit consumption in `PaywallGate` component
- Feature-key mapping (`bet_optimizer`, `gemini_analysis`)
- `try_use_feature(text)` database function

**Changed:**
- Standardized Day Pass plan key to `day_pass` (was `daypass`)
- billing-checkout now uses `APP_URL` env var for redirects
- All bet tools (Filterizer, Winner, Team Totals, Ticket Creator) now consume trial credits

**Removed:**
- Redundant `charge.succeeded` webhook handler for Day Pass

**Fixed:**
- ISSUE-007: Trial credits now properly decrement on feature use
- ISSUE-002: Ticket Creator now gated behind paywall
- ISSUE-003: Day Pass plan name consistent across stack
- ISSUE-008: Feature-key mapping uniform across all components
- ISSUE-009: No more duplicate Day Pass entitlements
- ISSUE-004: Redirect URLs work in all environments

---

## Evidence Placeholder

(Insert screenshots/logs after running manual tests)

### Test 1: Trial Credit Consumption
- [ ] Screenshot: Filterizer "Activating..." state
- [ ] SQL output: Credits 5 → 4 → 3 → 2 → 1 → 0
- [ ] Screenshot: Paywall screen at 0 credits

### Test 2: AI Analysis Trial
- [ ] Network log: 200 responses while credits > 0
- [ ] Network log: 402 PAYWALL error at 0 credits

### Test 3: Paid User Bypass
- [ ] Screenshot: Immediate access to all features
- [ ] SQL output: No change in trial_credits

### Test 4: Day Pass Purchase
- [ ] Stripe test checkout screenshot
- [ ] SQL output: `plan='day_pass'`, `status='active'`, `current_period_end`

### Test 5: Webhook Idempotency
- [ ] Stripe CLI replay command + output
- [ ] SQL output: Single webhook_events row, single entitlements row

---

**Report Generated:** 2025-01-XX  
**Status:** ✅ ALL FIXES IMPLEMENTED — READY FOR QA TESTING  
**Next Steps:** Execute manual test procedures (Section 5) and capture evidence (Section 10)
