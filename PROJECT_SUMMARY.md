# TicketAI.bet - Complete Project Summary

## 🎯 Project Overview

**TicketAI.bet** is a premium sports betting optimization platform that uses AI and statistical analysis to generate optimized betting selections. Built with React, TypeScript, Vite, Supabase (Lovable Cloud), and Stripe for payments.

**Live URL**: https://ticketai.bet  
**Tech Stack**: React 18, TypeScript, Tailwind CSS, Shadcn/UI, Supabase, Stripe, i18next

---

## 🏗️ Architecture Overview

```
Frontend (React SPA)
    ↓
Supabase Client (Authentication + Database)
    ↓
Edge Functions (Serverless Backend)
    ↓
External APIs (API-Football, Stripe)
```

### Key Technologies

- **Frontend**: React 18 + TypeScript + Vite
- **UI**: Tailwind CSS + Shadcn/UI components
- **Backend**: Supabase (PostgreSQL + Edge Functions)
- **Authentication**: Supabase Auth (email/password)
- **Payments**: Stripe Checkout + Webhooks
- **Internationalization**: i18next (English + Georgian)
- **State Management**: Zustand + React Query
- **API Data Source**: API-Football (fixtures, odds, stats)

---

## 💳 Payment System & Plans

### Stripe Integration

**Pricing Plans**:
1. **Test Pass** - $0.51 (24-hour access) - `price_1SS8ONKAifASkGDzSwzZLLW2`
2. **Day Pass** - $4.99 (24-hour access) - `price_1SS7L9KAifASkGDzgZL5PPOj`
3. **Monthly** - $14.99/month - `price_1SRlmOKAifASkGDzgavNBNlQ`
4. **3-Month** - $34.99/3 months - `price_1SRlnFKAifASkGDzxzFQTXDr`
5. **Yearly** - $79.99/year - `price_1SRlocKAifASkGDzemzpW2xL`

### Payment Flow

```typescript
// 1. User clicks "Subscribe" button
// 2. Frontend calls create-checkout-session edge function
const { data } = await supabase.functions.invoke('create-checkout-session', {
  body: { plan: 'day_pass' } // or 'test_pass', 'premium_monthly', etc.
});

// 3. Redirect to Stripe Checkout
window.open(data.url, '_blank');

// 4. User completes payment on Stripe
// 5. Stripe sends webhook to stripe-webhook edge function
// 6. Webhook creates/updates user_entitlements record
// 7. User redirected to /account?checkout=success
// 8. Frontend polls check-subscription to update access state
```

### Checkout Session Code (`create-checkout-session/index.ts`)

```typescript
// One-time payments (day_pass, test_pass)
if (plan === 'day_pass' || plan === 'test_pass') {
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    customer_email: customerId ? undefined : user.email,
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'payment', // ONE-TIME PAYMENT
    client_reference_id: user.id, // CRITICAL for webhook
    metadata: { user_id: user.id, plan }, // CRITICAL for webhook
    success_url: `${APP_URL}/account?checkout=success`,
    cancel_url: `${APP_URL}/pricing?checkout=cancel`,
  });
}

// Recurring subscriptions (monthly, three_month, annual)
else {
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    customer_email: customerId ? undefined : user.email,
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription', // RECURRING
    success_url: `${APP_URL}/account?checkout=success`,
    cancel_url: `${APP_URL}/pricing?checkout=cancel`,
  });
}
```

### Webhook Handler (`stripe-webhook/index.ts`)

```typescript
// Handle checkout.session.completed
if (event.type === 'checkout.session.completed') {
  const session = event.data.object;
  const userId = session.client_reference_id || session.metadata?.user_id;

  if (session.mode === 'payment') {
    // One-time payment (day_pass, test_pass)
    let planName = session.metadata?.plan; // Prefer metadata
    
    if (!planName) {
      // Fallback: check line item price ID
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      const priceId = lineItems.data[0]?.price?.id;
      if (priceId === STRIPE_PRICE_TEST_PASS) planName = 'test_pass';
      else if (priceId === STRIPE_PRICE_DAY_PASS) planName = 'day_pass';
    }

    // Grant 24-hour access
    await supabase.from('user_entitlements').upsert({
      user_id: userId,
      plan: planName,
      status: 'active',
      current_period_end: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      stripe_customer_id: session.customer,
      source: 'stripe',
    });
  }
  
  else if (session.mode === 'subscription') {
    // Recurring subscription - fetch subscription details
    const subscriptionId = session.subscription;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    
    await supabase.from('user_entitlements').upsert({
      user_id: userId,
      plan: planName,
      status: subscription.status,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: session.customer,
      source: 'stripe',
    });
  }
}

// Handle subscription updates
if (event.type === 'customer.subscription.updated') {
  // Update user_entitlements with new status/period
}

// Handle subscription cancellations
if (event.type === 'customer.subscription.deleted') {
  // Set status='canceled', plan='free'
}
```

---

## 🔐 Authentication & Authorization

### Supabase Auth

```typescript
// Sign Up
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'password123',
  options: {
    emailRedirectTo: `${window.location.origin}/auth`,
  },
});

// Sign In
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password123',
});

// Sign Out
await supabase.auth.signOut();
```

### User Roles & Access Control

**Database Functions**:

```sql
-- Check if user is admin
CREATE FUNCTION is_user_whitelisted() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if user has active subscription
CREATE FUNCTION user_has_access() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_entitlements
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND current_period_end > now()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Check if user is subscriber (any paid plan)
CREATE FUNCTION is_user_subscriber(check_user_id uuid DEFAULT NULL) 
RETURNS boolean AS $$
DECLARE
  target_user uuid := COALESCE(check_user_id, auth.uid());
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM user_entitlements
    WHERE user_id = target_user
      AND status = 'active'
      AND current_period_end >= now()
      AND plan <> 'free'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
```

### Trial Credits System

**Free users get 5 trial credits** for `bet_optimizer` and `gemini_analysis` features.

```sql
-- Atomic function to consume trial credits
CREATE FUNCTION try_use_feature(feature_key text)
RETURNS TABLE(allowed boolean, reason text, remaining_uses integer) AS $$
DECLARE
  uid uuid := auth.uid();
  cur_remaining integer;
BEGIN
  -- Admin bypass
  IF is_user_whitelisted() THEN
    RETURN QUERY SELECT true, 'admin', NULL::integer;
    RETURN;
  END IF;

  -- Paid user bypass
  IF user_has_access() THEN
    RETURN QUERY SELECT true, 'entitled', NULL::integer;
    RETURN;
  END IF;

  -- Only allow trials for specific features
  IF feature_key NOT IN ('bet_optimizer','gemini_analysis') THEN
    RETURN QUERY SELECT false, 'paywalled_feature', NULL::integer;
    RETURN;
  END IF;

  -- Try to consume a credit
  PERFORM ensure_trial_row();
  SELECT remaining_uses INTO cur_remaining
  FROM user_trial_credits
  WHERE user_id = uid
  FOR UPDATE;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Frontend Access Hook

```typescript
// src/hooks/useAccess.tsx
export const useAccess = () => {
  const { session } = useSessionContext();
  
  const { data: accessData } = useQuery({
    queryKey: ['user-access', session?.user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('user_has_access');
      return { hasAccess: data || false };
    },
    enabled: !!session,
  });

  const { data: creditsData } = useQuery({
    queryKey: ['trial-credits', session?.user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_trial_credits');
      return { credits: data || 0 };
    },
    enabled: !!session,
  });

  return {
    hasAccess: accessData?.hasAccess || false,
    creditsRemaining: creditsData?.credits || 0,
    isWhitelisted: false, // Determined server-side
  };
};
```

---

## 🎫 Premium Features (Paywalled)

All premium features use `<PaywallGate>` component:

```typescript
// src/components/PaywallGate.tsx
<PaywallGate featureKey="bet_optimizer" allowTrial={true}>
  <FilterizerPanel />
</PaywallGate>

<PaywallGate featureKey="gemini_analysis" allowTrial={true}>
  <GeminiAnalysis />
</PaywallGate>
```

### Feature List

1. **Filterizer** - Advanced selection filtering (`featureKey: 'bet_optimizer'`)
2. **Winner** - Best outcome picks (`featureKey: 'bet_optimizer'`)
3. **Team Totals** - Team-specific totals (`featureKey: 'bet_optimizer'`)
4. **Ticket Creator** - Custom ticket builder (`featureKey: 'bet_optimizer'`)
5. **Gemini Analysis** - AI fixture analysis (`featureKey: 'gemini_analysis'`)

### PaywallGate Logic

```typescript
const handleAccess = async () => {
  if (hasAccess || isWhitelisted) {
    setIsActivated(true);
    return; // Bypass trial consumption
  }

  if (!allowTrial) {
    setShowPaywall(true);
    return;
  }

  // Try to consume trial credit
  const { data, error } = await supabase.rpc('try_use_feature', {
    feature_key: featureKey,
  });

  if (data?.allowed) {
    setIsActivated(true);
    refetchCredits(); // Update UI
  } else {
    setShowPaywall(true); // No credits or not allowed
  }
};
```

---

## 📊 Database Schema

### Core Tables

```sql
-- User profiles
CREATE TABLE profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferred_lang text DEFAULT 'en',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- User entitlements (subscription status)
CREATE TABLE user_entitlements (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'free',
  current_period_end timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  source text DEFAULT 'manual',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Trial credits
CREATE TABLE user_trial_credits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  remaining_uses int NOT NULL DEFAULT 5,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- User roles (admin, etc.)
CREATE TABLE user_roles (
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

-- Fixtures (from API-Football)
CREATE TABLE fixtures (
  id int PRIMARY KEY,
  league_id int NOT NULL,
  season int NOT NULL,
  timestamp bigint NOT NULL,
  status text NOT NULL,
  teams_home jsonb NOT NULL,
  teams_away jsonb NOT NULL,
  goals jsonb,
  score jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Odds cache
CREATE TABLE odds_cache (
  fixture_id int PRIMARY KEY REFERENCES fixtures(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  is_live boolean DEFAULT false,
  fetched_at timestamptz DEFAULT now()
);

-- Stats cache (team statistics)
CREATE TABLE stats_cache (
  team_id int PRIMARY KEY,
  goals numeric NOT NULL,
  corners numeric NOT NULL,
  cards numeric NOT NULL,
  fouls numeric NOT NULL,
  offsides numeric NOT NULL,
  sample_size int NOT NULL,
  fetched_at timestamptz DEFAULT now()
);

-- Optimized selections (AI-generated picks)
CREATE TABLE optimized_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id int NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  league_id int NOT NULL,
  country_code text,
  utc_kickoff timestamptz NOT NULL,
  market text NOT NULL,
  side text NOT NULL,
  line numeric NOT NULL,
  bookmaker text NOT NULL,
  odds numeric,
  is_live boolean DEFAULT false,
  edge_pct numeric,
  model_prob numeric,
  sample_size int,
  combined_snapshot jsonb,
  rules_version text,
  source text DEFAULT 'api-football',
  computed_at timestamptz DEFAULT now(),
  UNIQUE (fixture_id, market, side, line, bookmaker, is_live)
);

-- User tickets (saved bet slips)
CREATE TABLE user_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  selections jsonb NOT NULL,
  stake numeric NOT NULL,
  expected_return numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Generated tickets (AI-generated tickets)
CREATE TABLE generated_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  legs jsonb NOT NULL,
  total_odds numeric NOT NULL,
  risk_mode text,
  created_at timestamptz DEFAULT now()
);
```

### Row Level Security (RLS)

```sql
-- Enable RLS
ALTER TABLE user_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_tickets ENABLE ROW LEVEL SECURITY;

-- User tickets policies
CREATE POLICY "Users can view own tickets"
  ON user_tickets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tickets"
  ON user_tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tickets"
  ON user_tickets FOR DELETE
  USING (auth.uid() = user_id);

-- Generated tickets policies
CREATE POLICY "Users can view own generated tickets"
  ON generated_tickets FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can create generated tickets"
  ON generated_tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
```

---

## 🚀 Edge Functions (Serverless Backend)

### Data Fetching Functions

1. **`fetch-fixtures`** - Fetches fixtures from API-Football
2. **`fetch-odds`** - Fetches odds for fixtures
3. **`fetch-predictions`** - Fetches AI predictions
4. **`stats-refresh`** - Updates team statistics
5. **`list-leagues-grouped`** - Returns leagues grouped by country

### Optimization Functions

6. **`optimize-selections-refresh`** - Generates optimized selections
7. **`populate-winner-outcomes`** - Populates winner outcomes
8. **`populate-team-totals-candidates`** - Populates team totals

### User-Facing Functions

9. **`filterizer-query`** - Advanced filtering API
10. **`generate-ticket`** - AI ticket generation
11. **`analyze-fixture`** - Gemini AI fixture analysis

### Payment Functions

12. **`create-checkout-session`** - Creates Stripe checkout
13. **`billing-portal`** - Opens Stripe customer portal
14. **`stripe-webhook`** - Handles Stripe webhooks

### Cron Jobs

15. **`cron-fetch-fixtures`** - Runs every 6 hours
16. **`cron-warmup-odds`** - Runs every 4 hours

### Example: Filterizer Query

```typescript
// supabase/functions/filterizer-query/index.ts
serve(async (req) => {
  // Authenticate user
  const authHeader = req.headers.get('Authorization');
  const { data: { user } } = await supabase.auth.getUser(token);

  // Parse request body
  const { leagueIds, date, markets, thresholds } = await req.json();

  // Query optimized_selections
  let query = supabase
    .from('optimized_selections')
    .select('*')
    .in('league_id', leagueIds)
    .eq('is_live', false);

  if (date) {
    query = query.gte('utc_kickoff', `${date}T00:00:00Z`)
                 .lt('utc_kickoff', `${date}T23:59:59Z`);
  }

  if (markets?.length) {
    query = query.in('market', markets);
  }

  const { data, error } = await query;

  return new Response(JSON.stringify({ selections: data }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

---

## 🎨 Frontend Structure

### Key Pages

```
src/pages/
├── Index.tsx          # Homepage (fixtures list)
├── Auth.tsx           # Login/Signup
├── Account.tsx        # User account + billing
├── Pricing.tsx        # Pricing plans
├── NotFound.tsx       # 404 page
├── PrivacyPolicy.tsx  # Privacy policy
└── TermsOfService.tsx # Terms of service
```

### Key Components

```
src/components/
├── AppHeader.tsx           # Main navigation
├── Footer.tsx              # Footer
├── LeftRail.tsx            # Fixtures sidebar
├── CenterRail.tsx          # Main content area
├── RightRail.tsx           # Ticket drawer
├── FilterizerPanel.tsx     # Filterizer feature
├── WinnerPanel.tsx         # Winner feature
├── TeamTotalsPanel.tsx     # Team totals feature
├── TicketCreatorDialog.tsx # Ticket creator
├── GeminiAnalysis.tsx      # AI analysis
├── PaywallGate.tsx         # Access control wrapper
├── TrialBadge.tsx          # Trial credits badge
└── MyTicketDrawer.tsx      # Saved tickets
```

### Routing

```typescript
// src/App.tsx
<BrowserRouter>
  <Routes>
    <Route path="/" element={<Index />} />
    <Route path="/auth" element={<Auth />} />
    <Route path="/pricing" element={<Pricing />} />
    <Route path="/account" element={
      <ProtectedRoute>
        <Account />
      </ProtectedRoute>
    } />
    <Route path="/privacy" element={<PrivacyPolicy />} />
    <Route path="/terms" element={<TermsOfService />} />
    <Route path="*" element={<NotFound />} />
  </Routes>
</BrowserRouter>
```

---

## 🌍 Internationalization (i18n)

Supports **English (en)** and **Georgian (ka)**.

```typescript
// src/i18n.ts
i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'ka'],
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },
    ns: ['common', 'filters', 'fixtures', 'optimizer', 'ticket', 'winner', 'filterizer', 'admin', 'account'],
    defaultNS: 'common',
  });
```

### Translation Files

```
public/locales/
├── en/
│   ├── common.json
│   ├── filters.json
│   ├── fixtures.json
│   ├── optimizer.json
│   ├── ticket.json
│   ├── winner.json
│   ├── filterizer.json
│   ├── admin.json
│   └── account.json
└── ka/
    └── (same structure)
```

### Usage

```typescript
import { useTranslation } from 'react-i18next';

const MyComponent = () => {
  const { t } = useTranslation('common');
  return <h1>{t('welcome')}</h1>;
};
```

---

## 🔑 Environment Variables

```env
# .env (auto-generated by Lovable Cloud)
VITE_SUPABASE_URL=https://dutkpzrisvqgxadxbkxo.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGc...
VITE_SUPABASE_PROJECT_ID=dutkpzrisvqgxadxbkxo
```

### Secrets (Supabase Edge Functions)

```
STRIPE_SECRET_KEY          # Stripe API key
STRIPE_WEBHOOK_SECRET      # Stripe webhook signing secret
API_FOOTBALL_KEY           # API-Football API key
CRON_INTERNAL_KEY          # Internal key for cron jobs
LOVABLE_API_KEY            # Lovable AI API key
APP_URL                    # https://ticketai.bet
SUPABASE_URL               # Supabase project URL
SUPABASE_SERVICE_ROLE_KEY  # Supabase service role key
SUPABASE_ANON_KEY          # Supabase anon key
```

---

## 🎯 Key Features Explained

### 1. Filterizer (Advanced Selection Filtering)

- Filters optimized selections by league, date, market, odds range
- Shows model probability, edge percentage, sample size
- Gated behind `bet_optimizer` paywall
- Uses `filterizer-query` edge function

### 2. Winner (Best Outcome Picks)

- Displays best 1X2 (match winner) picks
- Shows odds from multiple bookmakers
- Highlights best value selections
- Gated behind `bet_optimizer` paywall

### 3. Team Totals (Team-Specific Totals)

- Over/under predictions for individual teams
- Home/away split statistics
- Sample size and confidence indicators
- Gated behind `bet_optimizer` paywall

### 4. Ticket Creator (Custom Bet Builder)

- Users assemble custom multi-leg tickets
- Calculates combined odds and expected return
- Saves tickets to `user_tickets` table
- Gated behind `bet_optimizer` paywall

### 5. Gemini Analysis (AI Fixture Analysis)

- Uses Google Gemini 2.5 Flash via Lovable AI
- Analyzes team form, head-to-head, injuries
- Provides betting recommendations
- Gated behind `gemini_analysis` paywall

---

## 🔄 Data Flow Example

### User Loads Homepage

1. Frontend fetches fixtures: `supabase.from('fixtures').select('*')`
2. Fixtures rendered in `LeftRail.tsx`
3. User clicks on a fixture
4. `CenterRail.tsx` displays fixture details
5. User opens Filterizer tab
6. `PaywallGate` checks access via `useAccess()` hook
7. If user has access, displays `FilterizerPanel`
8. If no access, prompts for trial or payment

### User Purchases Day Pass

1. User clicks "Get Day Pass" on `/pricing`
2. Frontend calls `supabase.functions.invoke('create-checkout-session', { body: { plan: 'day_pass' } })`
3. Edge function creates Stripe checkout session with:
   - `mode: 'payment'`
   - `client_reference_id: user.id`
   - `metadata: { user_id, plan: 'day_pass' }`
4. User redirected to Stripe Checkout
5. User completes payment
6. Stripe sends `checkout.session.completed` webhook
7. `stripe-webhook` edge function:
   - Verifies webhook signature
   - Extracts `user_id` and `plan` from metadata
   - Upserts `user_entitlements` with 24-hour access
8. User redirected to `/account?checkout=success`
9. Frontend shows success message
10. `useAccess()` hook refetches, detects active subscription
11. Premium features now unlocked

---

## 📝 Important Code Patterns

### 1. Protected Edge Function

```typescript
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Authenticate user
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('No authorization header');
  
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) throw new Error('Unauthorized');

  // Your logic here
  // ...

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
```

### 2. RLS-Protected Query

```typescript
// Automatically filters by auth.uid()
const { data, error } = await supabase
  .from('user_tickets')
  .select('*')
  .order('created_at', { ascending: false });

// RLS policy ensures user only sees their own tickets
```

### 3. Trial Credit Consumption

```typescript
const consumeTrial = async () => {
  const { data, error } = await supabase.rpc('try_use_feature', {
    feature_key: 'bet_optimizer',
  });

  if (data?.allowed) {
    // Feature access granted
    setHasAccess(true);
    if (data.reason === 'trial') {
      toast.success(`Trial used. ${data.remaining_uses} uses remaining.`);
    }
  } else {
    // Show paywall
    setShowPaywall(true);
    if (data?.reason === 'no_credits') {
      toast.error('No trial credits remaining. Please subscribe.');
    }
  }
};
```

---

## 🐛 Debugging & Troubleshooting

### Common Issues

**1. User Paid But No Access**
- Check `user_entitlements` table for user's record
- Verify `status = 'active'` and `current_period_end > now()`
- Check Stripe webhook logs in Supabase Edge Function logs
- Verify webhook endpoint URL in Stripe dashboard
- Confirm `STRIPE_WEBHOOK_SECRET` matches Stripe

**2. Trial Credits Not Working**
- Check `user_trial_credits` table
- Ensure `try_use_feature` function has correct permissions
- Verify feature key is in whitelist (`'bet_optimizer'` or `'gemini_analysis'`)

**3. Webhook Not Firing**
- Go to Stripe Dashboard → Webhooks
- Check endpoint URL: `https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/stripe-webhook`
- Verify events are enabled: `checkout.session.completed`, `customer.subscription.*`
- Check webhook delivery attempts and logs

**4. 404 After Payment**
- Verify success URL is `${APP_URL}/account?checkout=success`
- Not `/auth/account` (old incorrect URL)

### Logging

```typescript
// Edge functions
console.log('[function-name] Step description', { data });
console.error('[function-name] Error description', { error });

// Frontend
console.log('[ComponentName] Action', data);

// View logs in Lovable Cloud → Edge Functions → Logs
```

---

## 🚀 Deployment

### Automatic Deployment

- **Frontend**: Auto-deploys on code push (via Lovable)
- **Edge Functions**: Auto-deploy when files change in `supabase/functions/`
- **Database Migrations**: Require approval, then auto-apply

### Manual Deployment

```bash
# Not typically needed, handled by Lovable Cloud
```

### Domain

**Production**: https://ticketai.bet  
**Staging**: https://[project-id].lovable.app

---

## 📚 Additional Documentation

- `STRIPE_SETUP.md` - Stripe integration guide
- `BACKEND_SNAPSHOT.md` - Backend security and configuration
- `SECURITY_SETUP.md` - Security best practices
- `ACCEPTANCE_CHECKLIST.md` - QA testing checklist
- `LEAGUE_EXPANSION_100.md` - League expansion plan
- `TEAM_TOTALS_QA.md` - Team totals testing
- `QA_TEST_PLAN_PREMIUM_FEATURES.md` - Premium features testing

---

## 🎓 Learning Resources

- [Lovable Documentation](https://docs.lovable.dev/)
- [Supabase Documentation](https://supabase.com/docs)
- [Stripe Documentation](https://stripe.com/docs)
- [API-Football Documentation](https://www.api-football.com/documentation-v3)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Shadcn/UI](https://ui.shadcn.com/)

---

## 📞 Support

For questions or issues, contact the development team or refer to the project documentation.

---

**Last Updated**: 2025-01-11  
**Version**: 1.0.0  
**Status**: Production
