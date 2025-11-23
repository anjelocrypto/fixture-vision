# TicketAI.bet - Complete Project Summary

## 🎯 Project Overview

**TicketAI.bet** is a sports betting optimization platform that uses AI-powered statistical analysis to generate betting recommendations. The platform features a 24/7 automated data pipeline that continuously refreshes odds and statistics to provide users with optimized betting selections.

**Live URL:** ticketai.bet  
**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS, Supabase (Lovable Cloud), Stripe, API-Football

---

## 📁 Complete File Structure

```
ticketai/
├── public/
│   ├── locales/
│   │   ├── en/                      # English translations
│   │   │   ├── account.json
│   │   │   ├── admin.json
│   │   │   ├── common.json
│   │   │   ├── filterizer.json
│   │   │   ├── filters.json
│   │   │   ├── fixtures.json
│   │   │   ├── optimizer.json
│   │   │   ├── team_totals.json
│   │   │   ├── ticket.json
│   │   │   ├── tooltips.json
│   │   │   └── winner.json
│   │   └── ka/                      # Georgian translations
│   │       └── [same structure]
│   └── robots.txt
│
├── src/
│   ├── components/
│   │   ├── ui/                      # Shadcn UI components
│   │   │   ├── accordion.tsx
│   │   │   ├── alert-dialog.tsx
│   │   │   ├── alert.tsx
│   │   │   ├── avatar.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── button.tsx
│   │   │   ├── calendar.tsx
│   │   │   ├── card.tsx
│   │   │   ├── checkbox.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── drawer.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── input.tsx
│   │   │   ├── label.tsx
│   │   │   ├── popover.tsx
│   │   │   ├── progress.tsx
│   │   │   ├── scroll-area.tsx
│   │   │   ├── select.tsx
│   │   │   ├── separator.tsx
│   │   │   ├── sheet.tsx
│   │   │   ├── skeleton.tsx
│   │   │   ├── slider.tsx
│   │   │   ├── switch.tsx
│   │   │   ├── table.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── toast.tsx
│   │   │   ├── toaster.tsx
│   │   │   ├── tooltip.tsx
│   │   │   └── use-toast.ts
│   │   ├── shared/
│   │   │   └── InfoTooltip.tsx
│   │   ├── AddToTicketButton.tsx
│   │   ├── AdminRefreshButton.tsx    # Admin-only data refresh controls
│   │   ├── AppHeader.tsx              # Top navigation with auth
│   │   ├── CenterRail.tsx             # Main fixture display area
│   │   ├── FilterizerPanel.tsx        # Premium: Advanced filtering
│   │   ├── Footer.tsx
│   │   ├── GeminiAnalysis.tsx         # Premium: AI fixture analysis
│   │   ├── LanguageSwitcher.tsx       # EN/KA language toggle
│   │   ├── LastFetchBadge.tsx         # Shows last data refresh time
│   │   ├── LeftRail.tsx               # League/date filters
│   │   ├── MyTicketDrawer.tsx         # User's manual ticket builder
│   │   ├── PaywallGate.tsx            # Access control for premium features
│   │   ├── ProtectedRoute.tsx         # Auth guard for routes
│   │   ├── RightRail.tsx              # Odds display panel
│   │   ├── SelectionsDisplay.tsx      # Shows AI-optimized selections
│   │   ├── TeamTotalsPanel.tsx        # Premium: Team scoring predictions
│   │   ├── TicketCreatorDialog.tsx    # Premium: AI ticket generator
│   │   ├── TicketDrawer.tsx           # Generated ticket display
│   │   ├── TrialBadge.tsx             # Shows remaining trial credits
│   │   └── WinnerPanel.tsx            # Premium: Match outcome predictions
│   │
│   ├── hooks/
│   │   ├── useAccess.tsx              # Premium access & trial credits check
│   │   ├── use-mobile.tsx
│   │   └── use-toast.ts
│   │
│   ├── integrations/
│   │   └── supabase/
│   │       ├── client.ts              # Auto-generated Supabase client
│   │       └── types.ts               # Auto-generated DB types (READ-ONLY)
│   │
│   ├── lib/
│   │   ├── constants.ts               # App-wide constants
│   │   ├── i18nFormatters.ts          # Translation utilities
│   │   └── utils.ts                   # Utility functions
│   │
│   ├── pages/
│   │   ├── Account.tsx                # User account & subscription management
│   │   ├── Auth.tsx                   # Login/signup page
│   │   ├── ForgotPassword.tsx
│   │   ├── Index.tsx                  # Main app page (protected)
│   │   ├── NotFound.tsx
│   │   ├── PaymentSuccess.tsx         # Post-Stripe redirect
│   │   ├── Pricing.tsx                # Subscription plans
│   │   ├── PrivacyPolicy.tsx
│   │   ├── ResetPassword.tsx
│   │   └── TermsOfService.tsx
│   │
│   ├── stores/
│   │   └── useTicket.ts               # Zustand store for ticket state
│   │
│   ├── App.tsx                        # Root component with routing
│   ├── main.tsx                       # Entry point
│   ├── index.css                      # Global styles & design tokens
│   ├── i18n.ts                        # i18next configuration
│   └── vite-env.d.ts
│
├── supabase/
│   ├── functions/                     # Edge Functions (serverless backend)
│   │   ├── _shared/                   # Shared utilities
│   │   │   ├── api.ts                 # API-Football client
│   │   │   ├── config.ts              # Function config
│   │   │   ├── cors.ts                # CORS headers
│   │   │   ├── league_coverage.ts     # League stats coverage logic
│   │   │   ├── leagues.ts             # League definitions
│   │   │   ├── market_detection.ts    # Market type detection
│   │   │   ├── market_map.ts          # Market name mappings
│   │   │   ├── odds_normalization.ts  # Odds format conversion
│   │   │   ├── rules.ts               # Betting rules engine
│   │   │   ├── stats.ts               # Matrix-v3 stats calculator
│   │   │   ├── stripePrices.ts        # Stripe price IDs
│   │   │   ├── stripe_plans.ts        # Plan definitions
│   │   │   ├── suspicious_odds_guards.ts # Fake odds detection
│   │   │   └── ticket_rules.ts        # Ticket generation rules
│   │   │
│   │   ├── analyze-cup-coverage/      # Cup league analysis
│   │   ├── analyze-fixture/           # Gemini AI fixture analysis
│   │   ├── analyze-ticket/            # Ticket validation
│   │   ├── backfill-fixture-results/  # Historical results import
│   │   ├── backfill-odds/             # Historical odds import
│   │   ├── billing-portal/            # Stripe customer portal
│   │   ├── calculate-value/           # Edge % calculations
│   │   ├── create-checkout-session/   # Stripe checkout
│   │   ├── cron-fetch-fixtures/       # Automated fixture refresh
│   │   ├── cron-warmup-odds/          # Automated odds refresh
│   │   ├── cup-coverage-report/       # Cup league coverage
│   │   ├── debug-league-coverage/     # Debug coverage issues
│   │   ├── debug-team-stats/          # Debug team calculations
│   │   ├── fetch-fixtures/            # Manual fixture fetch
│   │   ├── fetch-leagues/             # League data import
│   │   ├── fetch-odds-bets/           # Odds market fetching
│   │   ├── fetch-odds/                # Odds fetching
│   │   ├── fetch-predictions/         # Match predictions
│   │   ├── filterizer-query/          # Premium: Advanced filtering
│   │   ├── generate-ticket/           # Premium: AI ticket creation
│   │   ├── get-latest-odds/           # Latest odds retrieval
│   │   ├── list-leagues-grouped/      # Grouped league list
│   │   ├── optimize-selections-refresh/ # Optimizer pipeline
│   │   ├── populate-team-totals-candidates/ # Team totals generator
│   │   ├── populate-winner-outcomes/  # Winner predictions
│   │   ├── results-refresh/           # Results backfill
│   │   ├── shuffle-ticket/            # Ticket randomizer
│   │   ├── stats-refresh/             # Team stats calculator
│   │   ├── stripe-webhook/            # Stripe webhook handler
│   │   ├── verify-team-totals/        # Team totals validation
│   │   └── warmup-odds/               # Manual odds refresh
│   │
│   ├── migrations/                    # Database migrations (auto-generated)
│   └── config.toml                    # Supabase config (READ-ONLY)
│
├── .env                               # Environment variables (READ-ONLY)
├── .gitignore
├── eslint.config.js
├── index.html
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 🏗️ Architecture Overview

### Frontend (React + Vite)
- **Framework:** React 18 with TypeScript
- **Styling:** Tailwind CSS + Shadcn/UI components
- **State Management:** Zustand (ticket store) + React Query (server state)
- **Routing:** React Router v6
- **i18n:** i18next (English + Georgian)
- **Build Tool:** Vite

### Backend (Supabase / Lovable Cloud)
- **Database:** PostgreSQL with Row Level Security (RLS)
- **Auth:** Supabase Auth (email/password)
- **Storage:** No file storage (future feature)
- **Edge Functions:** Deno runtime for serverless functions
- **Cron Jobs:** pg_cron for automated tasks

### External Services
- **API-Football:** Sports data provider (fixtures, odds, stats)
- **Stripe:** Payment processing
- **Lovable AI:** Gemini-powered fixture analysis

---

## 🗄️ Database Schema

### Core Tables

#### `profiles`
User profile and preferences
```sql
- user_id (UUID, PK) → auth.users
- preferred_lang (TEXT) → 'en' | 'ka'
- created_at, updated_at (TIMESTAMPTZ)
```

#### `user_entitlements`
Subscription status and access control
```sql
- user_id (UUID, PK)
- plan (TEXT) → 'free' | 'day_pass' | 'weekly' | 'monthly'
- status (TEXT) → 'active' | 'canceled' | 'expired'
- current_period_end (TIMESTAMPTZ)
- stripe_customer_id (TEXT, nullable)
- stripe_subscription_id (TEXT, nullable)
- source (TEXT) → 'stripe' | 'manual'
```

#### `user_trial_credits`
Free trial system (5 uses per user)
```sql
- user_id (UUID, PK)
- remaining_uses (INT) → default 5
- updated_at (TIMESTAMPTZ)
```

#### `user_roles`
Admin/user role management
```sql
- id (UUID, PK)
- user_id (UUID)
- role (ENUM) → 'admin' | 'user'
- created_at (TIMESTAMPTZ)
```

#### `fixtures`
Match fixtures from API-Football
```sql
- id (BIGINT, PK) → API-Football fixture ID
- league_id (INT) → FK to leagues
- date (DATE)
- timestamp (BIGINT) → Unix timestamp
- status (TEXT) → 'NS' | 'LIVE' | 'FT' | etc.
- teams_home (JSONB) → {id, name, logo}
- teams_away (JSONB) → {id, name, logo}
- created_at, updated_at (TIMESTAMPTZ)
```

#### `leagues`
League metadata
```sql
- id (INT, PK) → API-Football league ID
- country_id (INT) → FK to countries
- name (TEXT)
- logo (TEXT)
- season (INT)
- created_at (TIMESTAMPTZ)
```

#### `countries`
Country data for leagues
```sql
- id (INT, PK)
- name (TEXT)
- code (TEXT)
- flag (TEXT)
- created_at (TIMESTAMPTZ)
```

#### `stats_cache`
Team statistics (Matrix-v3 algorithm)
```sql
- team_id (INT, PK) → API-Football team ID
- goals, corners, cards, fouls, offsides (NUMERIC)
- sample_size (INT) → number of fixtures used
- last_five_fixture_ids (BIGINT[]) → fixtures used for goals
- last_final_fixture (BIGINT) → most recent FT fixture
- source (TEXT) → 'api-football'
- computed_at (TIMESTAMPTZ)
```

#### `odds_cache`
Betting odds from bookmakers
```sql
- fixture_id (BIGINT, PK)
- payload (JSONB) → full API-Football odds response
- bookmakers (TEXT[]) → list of bookmakers
- markets (TEXT[]) → list of markets
- captured_at (TIMESTAMPTZ)
```

#### `optimized_selections`
AI-generated betting selections (Matrix-v3)
```sql
- id (UUID, PK)
- fixture_id (BIGINT)
- league_id (INT)
- market (TEXT) → 'goals' | 'corners' | 'cards'
- side (TEXT) → 'over' | 'under'
- line (NUMERIC) → e.g., 2.5
- odds (NUMERIC)
- bookmaker (TEXT)
- is_live (BOOLEAN)
- edge_pct (NUMERIC) → calculated edge percentage
- model_prob (NUMERIC) → model's probability
- sample_size (INT)
- combined_snapshot (JSONB) → team stats used
- rules_version (TEXT) → 'matrix-v3'
- utc_kickoff (TIMESTAMPTZ)
- computed_at (TIMESTAMPTZ)
```

#### `fixture_results`
Historical match results for backtesting
```sql
- fixture_id (BIGINT, PK)
- league_id (INT)
- kickoff_at (TIMESTAMPTZ)
- finished_at (TIMESTAMPTZ)
- goals_home, goals_away (SMALLINT)
- corners_home, corners_away (SMALLINT, nullable)
- cards_home, cards_away (SMALLINT, nullable)
- fouls_home, fouls_away (SMALLINT, nullable)
- offsides_home, offsides_away (SMALLINT, nullable)
- status (TEXT) → 'FT'
- source (TEXT) → 'api-football'
- fetched_at (TIMESTAMPTZ)
```

#### `league_stats_coverage`
Coverage tracking for each league
```sql
- league_id (INT, PK)
- league_name (TEXT)
- country (TEXT)
- is_cup (BOOLEAN)
- total_fixtures (INT)
- fixtures_with_goals, corners, cards, fouls, offsides (INT)
- goals_coverage_pct, corners_coverage_pct, etc. (NUMERIC)
- skip_goals, skip_corners, skip_cards, skip_fouls, skip_offsides (BOOLEAN)
- last_checked_at, created_at (TIMESTAMPTZ)
```

#### `outcome_selections`
Match winner predictions (1X2 markets)
```sql
- id (BIGINT, PK)
- fixture_id (BIGINT)
- league_id (INT)
- market_type (TEXT) → 'match_winner'
- outcome (TEXT) → 'home' | 'draw' | 'away'
- odds (NUMERIC)
- model_prob (NUMERIC)
- edge_pct (NUMERIC)
- bookmaker (TEXT)
- utc_kickoff (TIMESTAMPTZ)
- computed_at (TIMESTAMPTZ)
```

#### `team_totals_candidates`
Team-specific scoring predictions (Over 1.5 Team Goals)
```sql
- id (BIGINT, PK)
- fixture_id (BIGINT)
- league_id (INT)
- team_id (INT)
- team_context (TEXT) → 'home' | 'away'
- line (NUMERIC) → 1.5
- season_scoring_rate (NUMERIC)
- opponent_season_conceding_rate (NUMERIC)
- opponent_recent_conceded_2plus (INT)
- recent_sample_size (INT)
- rules_passed (BOOLEAN)
- rules_version (TEXT)
- utc_kickoff (TIMESTAMPTZ)
- computed_at (TIMESTAMPTZ)
```

#### `user_tickets`
User's manually created ticket
```sql
- user_id (UUID, PK)
- ticket (JSONB) → array of selections
- updated_at (TIMESTAMPTZ)
```

#### `generated_tickets`
AI-generated tickets for users
```sql
- id (UUID, PK)
- user_id (UUID)
- legs (JSONB) → array of selections
- total_odds (NUMERIC)
- min_target, max_target (NUMERIC)
- used_live (BOOLEAN)
- created_at (TIMESTAMPTZ)
```

### Utility Tables

#### `webhook_events`
Stripe webhook idempotency tracking
```sql
- event_id (TEXT, PK) → Stripe event ID
- created_at (TIMESTAMPTZ)
```

#### `cron_job_locks`
Prevents concurrent cron job runs
```sql
- job_name (TEXT, PK)
- locked_until (TIMESTAMPTZ)
- locked_by (TEXT)
- locked_at (TIMESTAMPTZ)
```

#### `app_settings`
Internal config storage
```sql
- key (TEXT, PK)
- value (TEXT)
- updated_at (TIMESTAMPTZ)
```

---

## 🔐 Row Level Security (RLS) Policies

### Access Patterns

**Public Access (no auth required):**
- `countries` (SELECT)
- `leagues` (SELECT)
- `fixtures` (SELECT)

**Authenticated Access:**
- `optimized_selections` (SELECT)
- `outcome_selections` (SELECT via admins only)
- `team_totals_candidates` (SELECT)

**User-Specific Data:**
- `profiles` (user can read/update own)
- `user_entitlements` (user can read own, service role manages)
- `user_trial_credits` (user can read/update own)
- `user_tickets` (user can CRUD own)
- `generated_tickets` (user can CRUD own)

**Admin-Only:**
- `user_roles` (admins + service role)
- `stats_cache` (admins read, service role manages)
- `odds_cache` (admins read, service role manages)
- `league_stats_coverage` (admins read, service role manages)

**Service Role Only:**
- `webhook_events`
- `cron_job_locks`
- `app_settings`

---

## 🔧 Database Functions

### Access Control Functions

#### `is_user_whitelisted()`
```sql
RETURNS boolean
-- Checks if user has admin role
```

#### `is_user_subscriber(check_user_id UUID)`
```sql
RETURNS boolean
-- Checks if user has active paid subscription
-- Service role can check any user, regular users only themselves
```

#### `user_has_access()`
```sql
RETURNS boolean
-- Checks if user has active entitlement (not expired)
```

#### `has_role(_user_id UUID, _role app_role)`
```sql
RETURNS boolean
-- Generic role checker for admin/user
```

### Trial Credit Functions

#### `get_trial_credits()`
```sql
RETURNS integer
-- Returns remaining trial credits for current user
-- Ensures row exists, returns 5 if missing
```

#### `ensure_trial_row()`
```sql
RETURNS void
-- Creates trial credits row with 5 uses if not exists
```

#### `try_use_feature(feature_key TEXT)`
```sql
RETURNS TABLE(allowed boolean, reason text, remaining_uses integer)
-- Attempts to consume 1 trial credit for a feature
-- Bypasses for admins and paid users
-- Only works for 'bet_optimizer' and 'gemini_analysis'
-- Returns: (true, 'admin', NULL) if admin
--          (true, 'entitled', NULL) if paid user
--          (true, 'trial', N) if consumed trial credit
--          (false, 'no_credits', 0) if no credits left
--          (false, 'paywalled_feature', NULL) if feature not allowed
```

### Cron Management Functions

#### `acquire_cron_lock(p_job_name TEXT, p_duration_minutes INT)`
```sql
RETURNS boolean
-- Attempts to acquire lock for cron job
-- Returns true if lock acquired or refreshed
-- Returns false if another process holds lock
```

#### `release_cron_lock(p_job_name TEXT)`
```sql
RETURNS void
-- Releases cron lock (admin or service role only)
```

#### `get_cron_internal_key()`
```sql
RETURNS text
-- Returns CRON_INTERNAL_KEY from app_settings
-- Used for authenticating internal cron calls
```

### Auth Triggers

#### `handle_new_user()`
```sql
RETURNS trigger
-- Creates profile row when user signs up
-- Sets default language to 'en'
```

---

## 🔄 Automated Data Pipeline

### Cron Jobs (pg_cron)

#### **1. cron-fetch-fixtures** (Every 10 minutes)
```
Schedule: */10 * * * *
Function: cron-fetch-fixtures
Purpose: Refreshes fixtures for next 14 days
Coverage: 100 leagues
```

#### **2. stats-refresh** (Every 10 minutes)
```
Schedule: */10 * * * *
Function: stats-refresh (called via internal API)
Purpose: Recomputes team statistics (Matrix-v3)
Scope: Teams playing in next 120 hours
Algorithm: Matrix-v3 with fake-zero detection
```

#### **3. cron-warmup-odds + optimize-selections-refresh** (Every 30 minutes)
```
Schedule: */30 * * * *
Function: cron-warmup-odds
Purpose: Refreshes odds and generates optimized selections
Flow: 
  1. cron-warmup-odds locks job
  2. Calls backfill-odds (batches of 30 fixtures)
  3. Calls optimize-selections-refresh
  4. optimize-selections-refresh generates Matrix-v3 selections
```

### Data Flow Diagram

```
API-Football
     ↓
[cron-fetch-fixtures] → fixtures table
     ↓
[stats-refresh] → stats_cache (Matrix-v3)
     ↓
[backfill-odds] → odds_cache
     ↓
[optimize-selections-refresh] → optimized_selections
     ↓
Frontend displays selections
```

---

## 🧮 Matrix-v3 Stats Algorithm

### Overview
The Matrix-v3 algorithm calculates team statistics by intelligently selecting the best 5 fixtures per metric, excluding problematic data.

### Key Features

**1. Per-Metric Fixture Selection**
- Each metric (goals, corners, cards, fouls, offsides) uses its own set of 5 fixtures
- Fixtures with missing/null data are skipped for that specific metric
- System finds next-best fixture to maintain 5-sample requirement

**2. Fake-Zero Detection**
- Detects fixtures where API returns 0s for all non-goal metrics
- Pattern: goals > 0 but corners/cards/fouls/offsides = 0
- Keeps goals data, nullifies other metrics for that fixture

**3. League Coverage Awareness**
- Checks `league_stats_coverage.skip_*` flags
- Skips metrics with <40% historical coverage in that league
- Prevents using unreliable data from low-coverage leagues

**4. Cup Match Handling**
- Cup matches often have missing/unreliable statistics
- System detects via league name patterns or coverage data
- Automatically excludes from non-goal calculations

### Calculation Example

**Team: Reims (team_id=93)**

**Available Fixtures (newest first):**
1. 1485814 (OCPAM Cup) - goals: 2, corners/cards/fouls/offsides: NULL
2. 1389237 (Ligue 1) - goals: 1, corners: 4, cards: 4, fouls: 15, offsides: 2
3. 1389232 (Ligue 1) - goals: 3, corners: 3, cards: 4, fouls: 20, offsides: 1
4. 1389219 (Ligue 1) - goals: 3, corners: 3, cards: 1, fouls: 8, offsides: 1
5. 1389214 (Ligue 1) - goals: 2, corners: 7, cards: 1, fouls: 12, offsides: NULL
6. 1389207 (Ligue 1) - goals: 1, corners: 10, cards: 4, fouls: 13, offsides: 3
7. 1389193 (Ligue 1) - goals: 2, corners: 7, cards: 3, fouls: 11, offsides: 2

**Matrix-v3 Selection:**
- **Goals:** 1485814, 1389237, 1389232, 1389219, 1389214 (includes cup match)
- **Corners:** 1389237, 1389232, 1389219, 1389214, 1389207 (skipped cup, used 1389207)
- **Cards:** 1389237, 1389232, 1389219, 1389214, 1389207 (skipped cup, used 1389207)
- **Fouls:** 1389237, 1389232, 1389219, 1389214, 1389207 (skipped cup, used 1389207)
- **Offsides:** 1389237, 1389232, 1389219, 1389207, 1389193 (skipped 1389214 + cup)

**Calculated Averages:**
- Goals: (2 + 1 + 3 + 3 + 2) / 5 = **2.2**
- Corners: (4 + 3 + 3 + 7 + 10) / 5 = **5.4**
- Cards: (4 + 4 + 1 + 1 + 4) / 5 = **2.8**
- Fouls: (15 + 20 + 8 + 12 + 13) / 5 = **13.6**
- Offsides: (2 + 1 + 1 + 3 + 2) / 5 = **1.8**

---

## 🎰 Betting Rules Engine

### Combined Stats → Market Picks

The system calculates `combined = home_stat + away_stat` and maps to market picks:

#### Goals Rules
```
combined >= 4.8 → Over 3.5 Goals
combined >= 4.0 → Over 2.5 Goals
combined >= 3.0 → Over 1.5 Goals
combined < 2.0  → Under 2.5 Goals
```

#### Corners Rules
```
combined >= 13.0 → Over 11.5 Corners
combined >= 11.0 → Over 9.5 Corners
combined >= 9.0  → Over 8.5 Corners
combined < 7.0   → Under 9.5 Corners
```

#### Cards Rules
```
combined >= 6.5 → Over 5.5 Cards
combined >= 5.5 → Over 4.5 Cards
combined >= 4.5 → Over 3.5 Cards
combined < 3.5  → Under 4.5 Cards
```

### Odds Matching
1. Fetch odds from `odds_cache`
2. Find exact match for (market, side, line)
3. If not found, try nearest line
4. Reject suspicious odds (e.g., over 5.0 for over 2.5 goals)
5. Keep best odds per bookmaker

### Edge Calculation
```typescript
edge_pct = ((model_prob * odds) - 1) * 100
```
- Positive edge = value bet
- Negative edge = bookmaker advantage

---

## 💰 Payment System (Stripe)

### Pricing Plans

| Plan | Price | Stripe Price ID | Description |
|------|-------|----------------|-------------|
| **Day Pass** | $9.99 | `price_1QZQRkDEwAc4YLe9ZLk0H4rk` | 24-hour access |
| **Weekly** | $29.99 | `price_1QZQSZDEwAc4YLe9wkI3pASJ` | 7-day subscription |
| **Monthly** | $99.99 | `price_1QZQTEDEwAc4YLe9kKDQrjYI` | 30-day subscription |

### Payment Flow

1. **User clicks "Subscribe"**
   - Frontend calls `create-checkout-session` edge function
   - Passes `priceId` and `successUrl`

2. **Create Checkout Session**
   ```typescript
   // Edge function creates Stripe session
   const session = await stripe.checkout.sessions.create({
     customer: existingCustomerId || undefined,
     customer_email: !existingCustomerId ? email : undefined,
     line_items: [{ price: priceId, quantity: 1 }],
     mode: plan === 'day_pass' ? 'payment' : 'subscription',
     success_url: `${appUrl}/payment-success`,
     cancel_url: `${appUrl}/pricing`,
     metadata: { userId, plan }
   });
   ```

3. **User completes payment on Stripe**

4. **Stripe sends webhook to `/stripe-webhook`**
   - Verifies signature
   - Checks idempotency (prevents duplicate processing)
   - Handles event based on type:

#### Webhook Events Handled

**`checkout.session.completed`**
```typescript
// Creates or updates user_entitlements
INSERT INTO user_entitlements (
  user_id,
  plan,
  status,
  current_period_end,
  stripe_customer_id,
  stripe_subscription_id
) VALUES (...) ON CONFLICT UPDATE ...
```

**`customer.subscription.updated`**
```typescript
// Updates entitlement when subscription changes
UPDATE user_entitlements SET
  status = subscription.status,
  current_period_end = new Date(subscription.current_period_end * 1000)
WHERE stripe_subscription_id = subscription.id
```

**`customer.subscription.deleted`**
```typescript
// Marks subscription as canceled
UPDATE user_entitlements SET status = 'canceled'
WHERE stripe_subscription_id = subscription.id
```

**`invoice.payment_succeeded`**
```typescript
// Extends period_end for recurring payments
UPDATE user_entitlements SET
  current_period_end = new Date(invoice.period_end * 1000)
WHERE stripe_subscription_id = invoice.subscription
```

**`invoice.payment_failed`**
```typescript
// Marks as past_due (grace period)
UPDATE user_entitlements SET status = 'past_due'
WHERE stripe_subscription_id = invoice.subscription
```

5. **Frontend polls `/account` page**
   - `useAccess()` hook refreshes every 5 minutes
   - Detects new entitlement within seconds
   - Shows success message

### Trial System

**Free Trial Credits: 5 uses per user**

**Eligible Features:**
- `bet_optimizer` (view optimized selections)
- `gemini_analysis` (AI fixture analysis)

**Not Eligible (Hard Paywalled):**
- `filterizer` (advanced filtering)
- `winner` (match outcome predictions)
- `team_totals` (team scoring predictions)
- `ticket_creator` (AI ticket generator)

**Trial Logic (try_use_feature function):**
```sql
1. If user is admin → allow (no credit consumed)
2. If user has active paid subscription → allow (no credit consumed)
3. If feature not in allowed list → deny
4. If remaining_uses > 0 → consume 1 credit, allow
5. Else → deny
```

---

## 🎨 Frontend Components

### Page Structure

**`Index.tsx` (Main App):**
```tsx
<AppHeader /> {/* Auth, language, credits */}
<div className="flex">
  <LeftRail /> {/* League/date filters */}
  <CenterRail /> {/* Fixture cards */}
  <RightRail /> {/* Odds display */}
</div>
<MyTicketDrawer /> {/* Manual ticket */}
<TicketDrawer /> {/* Generated ticket */}
<Footer />
```

### Premium Features

#### **Filterizer**
- Advanced filtering UI
- Backend: `filterizer-query` edge function
- Paywall: `featureKey="filterizer"` (hard paywalled)
- Allows filtering by:
  - Market type (goals/corners/cards)
  - Side (over/under)
  - Line (e.g., 2.5, 3.5)
  - Minimum odds
  - Edge percentage

#### **Winner**
- Match outcome predictions (1X2)
- Backend: `populate-winner-outcomes` (cron)
- Paywall: `featureKey="winner"` (hard paywalled)
- Shows best odds for Home/Draw/Away

#### **Team Totals**
- Team-specific scoring predictions
- Backend: `populate-team-totals-candidates` (cron)
- Paywall: `featureKey="team_totals"` (hard paywalled)
- Format: "Team X Over 1.5 Goals"

#### **Ticket Creator**
- AI-generated multi-leg betting tickets
- Backend: `generate-ticket` edge function
- Paywall: `featureKey="ticket_creator"` (hard paywalled)
- User configures:
  - Target odds range
  - Number of legs
  - Markets to include
  - Risk level

#### **Gemini Analysis**
- AI-powered fixture analysis
- Backend: `analyze-fixture` edge function (uses Lovable AI)
- Paywall: `featureKey="gemini_analysis"` (trial eligible)
- Provides:
  - Match preview
  - Key stats
  - Betting angles
  - Risk assessment

### Access Control Component

**`PaywallGate.tsx`**
```tsx
<PaywallGate featureKey="filterizer">
  <FilterizerPanel />
</PaywallGate>
```

**Logic:**
1. Check if user has active subscription
2. If not, check if whitelisted (admin)
3. If not, attempt to use trial credit (if eligible)
4. Show content or paywall modal

---

## 🌍 Internationalization

**Supported Languages:**
- English (en)
- Georgian (ka)

**Implementation:**
- Library: `i18next` + `react-i18next`
- Detection: Browser language → localStorage → default 'en'
- User preference stored in `profiles.preferred_lang`

**Translation Files:**
- `public/locales/{lang}/common.json` - General UI
- `public/locales/{lang}/filters.json` - Filter labels
- `public/locales/{lang}/fixtures.json` - Match terms
- `public/locales/{lang}/optimizer.json` - Betting terms
- `public/locales/{lang}/ticket.json` - Ticket UI
- `public/locales/{lang}/tooltips.json` - Help text
- `public/locales/{lang}/account.json` - Account page
- `public/locales/{lang}/admin.json` - Admin tools

---

## 🔑 Environment Variables

### Frontend (.env - auto-managed)
```bash
VITE_SUPABASE_URL=https://dutkpzrisvqgxadxbkxo.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGc...
VITE_SUPABASE_PROJECT_ID=dutkpzrisvqgxadxbkxo
```

### Backend (Supabase Secrets)
```bash
# Required
API_FOOTBALL_KEY=<api-football.com API key>
STRIPE_SECRET_KEY=<Stripe secret key>
STRIPE_WEBHOOK_SECRET=<Stripe webhook signing secret>
LOVABLE_API_KEY=<Lovable AI key>

# Internal
CRON_INTERNAL_KEY=<random UUID for cron auth>
APP_URL=https://ticketai.bet

# Auto-provided by Supabase
SUPABASE_URL=https://dutkpzrisvqgxadxbkxo.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
SUPABASE_DB_URL=postgresql://...
```

---

## 🚀 Deployment

### Frontend
- Hosted on **Lovable Cloud** (automatic deployment)
- Custom domain: **ticketai.bet**
- Deploy: Click "Publish" button in Lovable UI

### Backend (Edge Functions)
- Hosted on **Supabase** (via Lovable Cloud)
- Deploy: Automatic on every save
- No manual deployment needed

### Database Migrations
- Created via Lovable migration tool
- Automatic approval flow
- Applied immediately to production

---

## 🐛 Debugging & Monitoring

### Admin Tools

**Admin Refresh Button** (`AdminRefreshButton.tsx`)
- Appears for admin users
- Manually triggers:
  - `warmup-odds` - Refresh odds + optimizer
  - `stats-refresh` - Recompute team stats
  - `fetch-fixtures` - Refresh fixture list

**Debug Edge Functions**
- `debug-team-stats` - Verify team calculations
- `debug-league-coverage` - Check coverage data

### Logging

**Edge Function Logs:**
```typescript
console.log('[function-name] Message');
// Viewable in Lovable Cloud logs tab
```

**Important Log Patterns:**
- `[stats] ⚠️ Fake-zero pattern detected`
- `[stats] 🚫 Skipping fixture X for Y (league Z) – null value`
- `[optimizer] ✅ Generated N selections for fixture X`
- `[webhook] ✅ Processed checkout.session.completed`

---

## 📊 Key Metrics

### Database Stats (as of now)
- **Fixtures:** ~5,000 upcoming matches
- **Leagues:** 100 leagues across 50+ countries
- **Teams:** ~2,000 teams in stats_cache
- **Results:** 1,056 historical results across 15 leagues
- **Selections:** 31 Matrix-v3 optimized selections

### Coverage
- **Goals:** 100% (all leagues)
- **Fouls:** 14/15 leagues with >40 fixtures
- **Offsides:** 13/15 leagues with >40 fixtures
- **Corners:** 12/15 leagues with >40 fixtures
- **Cards:** 11/15 leagues with >40 fixtures

### Pipeline Health
- **Stats Refresh:** Every 10 minutes
- **Odds Refresh:** Every 30 minutes
- **Fixture Refresh:** Every 10 minutes
- **Optimizer:** Every 30 minutes (after odds refresh)

---

## 🔒 Security

### Authentication
- Supabase Auth with email/password
- JWT tokens in localStorage
- Auto-refresh on expiry

### Row Level Security (RLS)
- All tables have RLS enabled
- Users can only access their own data
- Admins have elevated permissions
- Service role bypasses RLS (edge functions)

### API Security
- Edge functions verify JWT tokens
- Protected routes use `verify_jwt: true`
- Rate limiting via Supabase (built-in)
- CORS headers configured per function

### Payment Security
- Stripe webhook signature verification
- Idempotency via `webhook_events` table
- Customer identity preserved across checkouts

---

## 📝 Development Patterns

### Adding a New Edge Function

1. **Create function directory:**
```bash
supabase/functions/my-function/index.ts
```

2. **Configure in config.toml:**
```toml
[functions.my-function]
verify_jwt = true  # or false for public
```

3. **Import shared utilities:**
```typescript
import { apiHeaders, API_BASE } from '../_shared/api.ts';
import { corsHeaders } from '../_shared/cors.ts';
```

4. **Deploy automatically** (save file in Lovable)

### Adding a New Premium Feature

1. **Create component with PaywallGate:**
```tsx
<PaywallGate featureKey="my_feature">
  <MyFeatureComponent />
</PaywallGate>
```

2. **Update try_use_feature function** (if trial eligible)
3. **Create backend edge function** (if needed)
4. **Add translations** in locale files

### Adding a New Database Table

1. **Use Lovable migration tool:**
```sql
CREATE TABLE my_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;

-- Add policies
CREATE POLICY "Users can read own data"
ON my_table FOR SELECT
USING (auth.uid() = user_id);
```

2. **Types auto-generate** in `src/integrations/supabase/types.ts`

---

## 🎯 Current Status

### ✅ Production Ready
- Matrix-v3 stats algorithm with fake-zero detection
- League coverage tracking for all markets
- Automated data pipeline (24/7)
- Payment system fully functional
- Trial credits system working
- Admin controls operational
- Multi-language support (EN/KA)

### 🚧 In Progress
- Building stats_cache for remaining teams (42% complete)
- Generating more Matrix-v3 selections (31 so far)
- Waiting for cron jobs to complete full rebuild

### 📋 Future Enhancements
- Live odds refresh (currently only pre-match)
- User betting history tracking
- Performance analytics dashboard
- Mobile app (React Native)
- More languages
- Social features (share tickets)

---

## 🤝 Contributing

**This is a Lovable Cloud project.**

To work on this project:
1. Clone from GitHub (linked in Lovable)
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env` (get keys from Lovable)
4. Run dev server: `npm run dev`
5. Push changes to trigger deployment

**Important Files (DO NOT EDIT MANUALLY):**
- `src/integrations/supabase/types.ts` (auto-generated)
- `src/integrations/supabase/client.ts` (auto-generated)
- `supabase/config.toml` (managed by Lovable)
- `.env` (managed by Lovable)

---

## 📚 Additional Documentation

- `README.md` - Quick start guide
- `PROJECT_SUMMARY.md` - Architecture overview
- `TICKETAI_COMPREHENSIVE_AUDIT.md` - Full system audit
- `BACKEND_SNAPSHOT.md` - Backend security snapshot
- `PIPELINE_DOCUMENTATION.md` - Data pipeline details
- `SECURITY_NOTES.md` - Security considerations
- `STRIPE_SETUP.md` - Payment integration guide

---

## 🆘 Support

**For issues:**
1. Check Lovable Cloud logs (edge function errors)
2. Check browser console (frontend errors)
3. Verify RLS policies (common access issues)
4. Test with admin account (bypasses most restrictions)

**Common Issues:**
- "No access" → Check `user_entitlements` and `user_trial_credits`
- Missing selections → Check `stats_cache` and `league_stats_coverage`
- Odd calculations wrong → Review Matrix-v3 logs in `debug-team-stats`
- Payment not reflected → Check webhook logs and `webhook_events` table

---

## 🎉 Project Highlights

- **24/7 automated data pipeline** refreshing stats and odds
- **Matrix-v3 algorithm** with intelligent fixture selection
- **Fake-zero detection** prevents bad data from corrupting stats
- **League coverage tracking** ensures only reliable data is used
- **Stripe integration** with webhook idempotency
- **Trial system** gives users 5 free premium feature uses
- **Multi-language** support (English + Georgian)
- **Admin tools** for manual overrides and debugging
- **Row Level Security** protects all user data
- **Edge functions** handle all backend logic

---

**Built with ❤️ using Lovable Cloud**
