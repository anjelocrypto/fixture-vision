# TicketAI - Comprehensive Project Summary

## 📋 Project Overview

**TicketAI** (branded as "TICKET 1.0 BETA") is an AI-powered sports betting optimization platform that uses automated data pipelines and statistical analysis to provide betting recommendations. The platform analyzes football (soccer) matches using historical statistics, odds data, and AI to generate optimized betting selections.

**Live URL**: https://ticketai.bet  
**Tech Stack**: React 18, TypeScript, Vite, Tailwind CSS, Supabase (PostgreSQL + Auth + Edge Functions), Stripe, API-Football

---

## 🏗️ Architecture Overview

### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS + Shadcn/UI components
- **State Management**: Zustand (for ticket state), React Query (for server state)
- **Routing**: React Router v6
- **i18n**: i18next (English + Georgian)

### Backend (Supabase)
- **Database**: PostgreSQL with Row Level Security (RLS)
- **Authentication**: Supabase Auth (email/password)
- **Edge Functions**: Deno runtime for serverless functions
- **Realtime**: Supabase Realtime for live updates

### External Services
- **API-Football**: Sports data provider (fixtures, stats, odds, injuries)
- **Stripe**: Payment processing
- **Lovable AI**: AI analysis features

---

## 📁 Complete File Structure

```
├── public/
│   ├── locales/
│   │   ├── en/                    # English translations
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
│   │   └── ka/                    # Georgian translations
│   │       └── [same files as en/]
│   ├── images/
│   │   └── uefa-logo.png
│   └── robots.txt
│
├── src/
│   ├── components/
│   │   ├── ui/                    # Shadcn UI components (40+ files)
│   │   │   ├── accordion.tsx
│   │   │   ├── alert-dialog.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── checkbox.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── drawer.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── form.tsx
│   │   │   ├── input.tsx
│   │   │   ├── popover.tsx
│   │   │   ├── scroll-area.tsx
│   │   │   ├── select.tsx
│   │   │   ├── sheet.tsx
│   │   │   ├── skeleton.tsx
│   │   │   ├── slider.tsx
│   │   │   ├── switch.tsx
│   │   │   ├── table.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── toast.tsx
│   │   │   ├── tooltip.tsx
│   │   │   └── [others...]
│   │   ├── shared/
│   │   │   └── InfoTooltip.tsx
│   │   ├── AddToTicketButton.tsx   # Add selection to betting ticket
│   │   ├── AdminRefreshButton.tsx  # Admin manual pipeline controls
│   │   ├── AppHeader.tsx           # Main navigation header
│   │   ├── CenterRail.tsx          # Main content area (fixtures list)
│   │   ├── FilterizerPanel.tsx     # Advanced filtering tool
│   │   ├── FixtureStatsDisplay.tsx # Show fixture statistics
│   │   ├── Footer.tsx              # Page footer
│   │   ├── GeminiAnalysis.tsx      # AI analysis component
│   │   ├── InjuriesDisplay.tsx     # Player injuries display
│   │   ├── LanguageSwitcher.tsx    # EN/KA language toggle
│   │   ├── LastFetchBadge.tsx      # Data freshness indicator
│   │   ├── LeftRail.tsx            # Left sidebar (filters)
│   │   ├── MyTicketDrawer.tsx      # User's betting ticket
│   │   ├── PaywallGate.tsx         # Premium feature gating
│   │   ├── ProtectedRoute.tsx      # Auth route guard
│   │   ├── RightRail.tsx           # Right sidebar (tools)
│   │   ├── SelectionsDisplay.tsx   # Display betting selections
│   │   ├── StatsHealthDashboard.tsx# Admin stats monitoring
│   │   ├── TeamTotalsPanel.tsx     # Team scoring analysis
│   │   ├── TicketCreatorDialog.tsx # AI ticket generation UI
│   │   ├── TicketDrawer.tsx        # Generated tickets display
│   │   ├── TrialBadge.tsx          # Trial credits indicator
│   │   └── WinnerPanel.tsx         # Match winner predictions
│   │
│   ├── hooks/
│   │   ├── use-mobile.tsx          # Mobile detection hook
│   │   ├── use-toast.ts            # Toast notifications hook
│   │   └── useAccess.tsx           # User access/subscription hook
│   │
│   ├── integrations/
│   │   └── supabase/
│   │       ├── client.ts           # Supabase client (auto-generated)
│   │       └── types.ts            # Database types (auto-generated)
│   │
│   ├── lib/
│   │   ├── constants.ts            # App constants
│   │   ├── i18nFormatters.ts       # i18n formatting utilities
│   │   └── utils.ts                # General utilities (cn, etc.)
│   │
│   ├── pages/
│   │   ├── Account.tsx             # User account/subscription page
│   │   ├── AdminHealth.tsx         # Admin pipeline dashboard
│   │   ├── Auth.tsx                # Login/signup page
│   │   ├── ForgotPassword.tsx      # Password recovery
│   │   ├── Index.tsx               # Main homepage
│   │   ├── NotFound.tsx            # 404 page
│   │   ├── PaymentSuccess.tsx      # Post-payment confirmation
│   │   ├── Pricing.tsx             # Subscription plans
│   │   ├── PrivacyPolicy.tsx       # Legal - privacy
│   │   ├── ResetPassword.tsx       # Password reset
│   │   └── TermsOfService.tsx      # Legal - terms
│   │
│   ├── stores/
│   │   └── useTicket.ts            # Zustand ticket store
│   │
│   ├── App.tsx                     # Main app component + routing
│   ├── App.css                     # App-level styles
│   ├── index.css                   # Tailwind + design system
│   ├── i18n.ts                     # i18next configuration
│   ├── main.tsx                    # App entry point
│   └── vite-env.d.ts               # Vite type definitions
│
├── supabase/
│   ├── functions/
│   │   ├── _shared/                # Shared utilities for edge functions
│   │   │   ├── api.ts              # Generic API helpers
│   │   │   ├── api_football.ts     # API-Football client with rate limiting
│   │   │   ├── config.ts           # Configuration constants
│   │   │   ├── cors.ts             # CORS headers helper
│   │   │   ├── h2h.ts              # Head-to-head stats logic
│   │   │   ├── injuries.ts         # Injury processing logic
│   │   │   ├── league_coverage.ts  # Per-metric league coverage
│   │   │   ├── leagues.ts          # League constants & mappings
│   │   │   ├── market_detection.ts # Betting market detection
│   │   │   ├── market_map.ts       # Market type mappings
│   │   │   ├── odds_normalization.ts # Odds data normalization
│   │   │   ├── player_importance.ts  # Player importance scoring
│   │   │   ├── rules.ts            # Betting rules engine
│   │   │   ├── stats.ts            # Stats computation logic
│   │   │   ├── stats_db.ts         # Stats database operations
│   │   │   ├── stats_integrity.ts  # Stats validation
│   │   │   ├── stripePrices.ts     # Stripe price IDs
│   │   │   ├── stripe_plans.ts     # Stripe plan configurations
│   │   │   ├── suspicious_odds_guards.ts # Odds validation
│   │   │   └── ticket_rules.ts     # Ticket generation rules
│   │   │
│   │   ├── admin-health/           # Admin health check endpoint
│   │   ├── admin-remediate-stats-gaps/ # Automated stats remediation
│   │   ├── analyze-cup-coverage/   # Cup competition analysis
│   │   ├── analyze-fixture/        # Single fixture analysis (Analyzer)
│   │   ├── analyze-ticket/         # AI ticket analysis
│   │   ├── backfill-fixture-results/ # Results backfill
│   │   ├── backfill-odds/          # Odds backfill (batch processing)
│   │   ├── billing-portal/         # Stripe billing portal
│   │   ├── calculate-value/        # Value calculation
│   │   ├── create-checkout-session/ # Stripe checkout
│   │   ├── cron-fetch-fixtures/    # Automated fixture fetching
│   │   ├── cron-warmup-odds/       # Automated odds + optimizer
│   │   ├── cup-coverage-report/    # Cup stats coverage report
│   │   ├── debug-league-coverage/  # League coverage debugging
│   │   ├── debug-team-stats/       # Team stats debugging
│   │   ├── fetch-fixtures/         # Manual fixture fetching
│   │   ├── fetch-leagues/          # League data fetching
│   │   ├── fetch-odds/             # Manual odds fetching
│   │   ├── fetch-odds-bets/        # Betting odds fetching
│   │   ├── fetch-predictions/      # Prediction fetching
│   │   ├── filterizer-query/       # Filterizer search endpoint
│   │   ├── fixtures-history-backfill/ # Historical fixtures import
│   │   ├── generate-ticket/        # AI ticket generation
│   │   ├── get-latest-odds/        # Latest odds retrieval
│   │   ├── list-leagues-grouped/   # Leagues by country
│   │   ├── optimize-selections-refresh/ # Optimizer pipeline
│   │   ├── populate-team-totals-candidates/ # Team totals analysis
│   │   ├── populate-winner-outcomes/ # Winner predictions
│   │   ├── results-refresh/        # Match results update
│   │   ├── shuffle-ticket/         # Ticket reshuffling
│   │   ├── stats-consistency-audit/ # Stats verification
│   │   ├── stats-health-check/     # Stats monitoring (6h cron)
│   │   ├── stats-refresh/          # Stats refresh (10min cron)
│   │   ├── stats-turbo-backfill/   # Aggressive stats catchup
│   │   ├── stripe-webhook/         # Stripe payment webhooks
│   │   ├── sync-injuries/          # Injury data sync
│   │   ├── sync-player-importance/ # Player importance sync
│   │   ├── test-h2h/               # H2H testing endpoint
│   │   ├── test-injury-coverage/   # Injury coverage test
│   │   ├── test-uefa-competitions/ # UEFA test endpoint
│   │   ├── verify-team-totals/     # Team totals verification
│   │   └── warmup-odds/            # Manual warmup trigger
│   │
│   └── config.toml                 # Supabase configuration
│
├── Documentation files:
│   ├── README.md
│   ├── AUTOMATED_PIPELINE.md
│   ├── FULL_PROJECT_SUMMARY.md
│   ├── PROJECT_SUMMARY.md
│   ├── PIPELINE_DOCUMENTATION.md
│   ├── PIPELINE_HEALTH_CHECK.md
│   ├── SECURITY_SETUP.md
│   ├── STRIPE_SETUP.md
│   └── [many audit/QA reports...]
│
├── Configuration files:
│   ├── .env                        # Environment variables (auto-managed)
│   ├── eslint.config.js
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── vite.config.ts
```

---

## 🗄️ Database Schema

### Core Tables

#### `fixtures`
Stores football match data.
```sql
- id: bigint (PRIMARY KEY) - API-Football fixture ID
- league_id: integer (FK to leagues)
- date: date
- timestamp: bigint (Unix timestamp)
- teams_home: jsonb {id, name, logo}
- teams_away: jsonb {id, name, logo}
- status: text ('NS', 'FT', '1H', '2H', etc.)
- created_at, updated_at: timestamptz
```

#### `fixture_results`
Match results with statistics.
```sql
- fixture_id: bigint (PRIMARY KEY, FK to fixtures)
- league_id: integer
- kickoff_at: timestamptz
- finished_at: timestamptz
- goals_home, goals_away: smallint
- corners_home, corners_away: smallint
- cards_home, cards_away: smallint
- fouls_home, fouls_away: smallint
- offsides_home, offsides_away: smallint
- status: text
- source: text
- fetched_at: timestamptz
```

#### `stats_cache`
Cached team statistics (last 5 matches averages).
```sql
- team_id: integer (PRIMARY KEY)
- goals, corners, cards, fouls, offsides: numeric
- sample_size: integer
- last_five_fixture_ids: bigint[]
- last_final_fixture: bigint
- computed_at: timestamptz
- source: text
```

#### `optimized_selections`
AI-optimized betting selections.
```sql
- id: uuid (PRIMARY KEY)
- fixture_id: bigint
- league_id: integer
- utc_kickoff: timestamptz
- market: text ('goals', 'corners', 'cards')
- side: text ('over', 'under')
- line: numeric (e.g., 2.5, 9.5)
- odds: numeric
- bookmaker: text
- model_prob: numeric (AI probability)
- edge_pct: numeric (value edge)
- sample_size: integer
- combined_snapshot: jsonb (stats snapshot)
- rules_version: text ('matrix-v3')
- is_live: boolean
- country_code: text
- computed_at: timestamptz
```

#### `leagues`
League/competition metadata.
```sql
- id: integer (PRIMARY KEY) - API-Football league ID
- name: text
- country_id: integer (FK to countries)
- season: integer
- logo: text
- created_at: timestamptz
```

#### `countries`
Country reference data.
```sql
- id: integer (PRIMARY KEY)
- name: text
- code: text (ISO code)
- flag: text (URL)
```

#### `odds_cache`
Raw odds data from bookmakers.
```sql
- fixture_id: bigint (PRIMARY KEY)
- payload: jsonb (full odds data)
- bookmakers: text[]
- markets: text[]
- captured_at: timestamptz
```

#### `h2h_cache`
Head-to-head statistics between teams.
```sql
- team1_id, team2_id: integer (composite PRIMARY KEY)
- goals, corners, cards, fouls, offsides: numeric
- sample_size: integer
- last_fixture_ids: bigint[]
- computed_at: timestamptz
```

### User & Payment Tables

#### `profiles`
User profile data.
```sql
- user_id: uuid (PRIMARY KEY, FK to auth.users)
- preferred_lang: text ('en', 'ka')
- created_at, updated_at: timestamptz
```

#### `user_entitlements`
Subscription status.
```sql
- user_id: uuid (PRIMARY KEY)
- plan: text ('free', 'day_pass', 'monthly', 'three_month', 'annual')
- status: text ('active', 'free', 'canceled')
- current_period_end: timestamptz
- stripe_customer_id: text
- stripe_subscription_id: text
- source: text ('stripe', 'admin_grant')
- updated_at: timestamptz
```

#### `user_trial_credits`
Trial feature usage tracking.
```sql
- user_id: uuid (PRIMARY KEY)
- remaining_uses: integer (default 5)
- updated_at: timestamptz
```

#### `user_roles`
Admin role assignments.
```sql
- id: uuid (PRIMARY KEY)
- user_id: uuid
- role: app_role enum ('admin', 'user')
- created_at: timestamptz
```

#### `user_tickets`
User's current betting ticket.
```sql
- user_id: uuid (PRIMARY KEY)
- ticket: jsonb (legs array)
- updated_at: timestamptz
```

#### `generated_tickets`
AI-generated ticket history.
```sql
- id: uuid (PRIMARY KEY)
- user_id: uuid
- legs: jsonb
- total_odds: numeric
- min_target, max_target: numeric
- used_live: boolean
- created_at: timestamptz
```

### Pipeline & Monitoring Tables

#### `optimizer_run_logs`
Pipeline execution logs.
```sql
- id: uuid (PRIMARY KEY)
- run_type: text ('stats-refresh-batch', 'cron-warmup-odds', etc.)
- window_start, window_end: timestamptz
- scanned, with_odds, upserted, skipped, failed: integer
- duration_ms: integer
- started_at, finished_at: timestamptz
- scope: jsonb
- notes: text
```

#### `cron_job_locks`
Prevents overlapping cron executions.
```sql
- job_name: text (PRIMARY KEY)
- locked_until: timestamptz
- locked_by: text
- locked_at: timestamptz
```

#### `league_stats_coverage`
Per-league data quality metrics.
```sql
- league_id: integer (PRIMARY KEY)
- league_name: text
- country: text
- is_cup: boolean
- total_fixtures: integer
- fixtures_with_goals/corners/cards/fouls/offsides: integer
- goals/corners/cards/fouls/offsides_coverage_pct: numeric
- skip_goals/corners/cards/fouls/offsides: boolean
- last_checked_at: timestamptz
```

#### `stats_health_violations`
Data quality issues log.
```sql
- id: bigint (PRIMARY KEY)
- team_id: integer
- team_name: text
- metric: text
- severity: text ('info', 'warning', 'critical')
- db_value, cache_value, diff: numeric
- sample_size: integer
- league_ids: integer[]
- notes: text
- resolved_at: timestamptz
- resolved_by: text
- created_at: timestamptz
```

#### `player_injuries`
Current player injuries.
```sql
- player_id, team_id, league_id, season: composite PRIMARY KEY
- player_name: text
- team_name: text
- position: text
- injury_type: text
- status: text
- start_date, expected_return: date
- last_update: timestamptz
```

#### `player_importance`
Player impact scoring.
```sql
- player_id, team_id, league_id, season: composite PRIMARY KEY
- importance: numeric (0.0-1.0)
- minutes_played, matches_played, matches_started: integer
- goals, assists: integer
- last_update: timestamptz
```

### Views

- `pipeline_health_check` - Real-time pipeline status
- `v_selections_prematch` - Pre-match selections only
- `v_team_totals_prematch` - Pre-match team totals
- `v_best_outcome_prices_prematch` - Best odds by outcome
- `v_is_subscriber` - User subscription status
- `backtest_samples` - Historical performance data

---

## 🔐 Security & RLS

### Row Level Security Policies

All tables have RLS enabled with policies:

1. **Public Read**: `fixtures`, `leagues`, `countries`, `predictions_cache`
2. **Authenticated Read**: `optimized_selections`, `h2h_cache`, `fixture_results`, `player_injuries`, `player_importance`, `team_totals_candidates`
3. **User-specific**: `profiles`, `user_tickets`, `user_entitlements`, `user_trial_credits`, `user_roles`, `generated_tickets`
4. **Admin-only**: `stats_cache`, `odds_cache`, `optimizer_cache`, `analysis_cache`, `league_stats_coverage`, `stats_health_violations`, `optimizer_run_logs`, `cron_job_locks`
5. **Service-role only**: All tables have service_role full access

### Database Functions

```sql
-- Access Control
is_user_whitelisted()      -- Check if user is admin
is_user_subscriber()       -- Check if user has active subscription
user_has_access()          -- Check if user has premium access
has_role(user_id, role)    -- Check specific role

-- Trial System
ensure_trial_row()         -- Initialize trial credits
get_trial_credits()        -- Get remaining credits
try_use_feature(key)       -- Consume trial credit atomically

-- Cron Management
acquire_cron_lock(job, duration)  -- Lock job to prevent overlap
release_cron_lock(job)            -- Release lock
get_cron_internal_key()           -- Get cron auth key
```

---

## 💳 Payment System

### Plans & Pricing

| Plan | Price | Stripe Price ID | Duration |
|------|-------|-----------------|----------|
| Day Pass | $4.99 | price_1SS7L9KAifASkGDzgZL5PPOj | 24 hours |
| Monthly | $14.99 | price_1SRlmOKAifASkGDzgavNBNlQ | 30 days |
| Three-Month | $34.99 | price_1SSIuZKAifASkGDzWZxgNYZX | 90 days |
| Annual | $79.99 | price_1SRlocKAifASkGDzemzpW2xL | 365 days |

### Payment Flow

1. User clicks "Subscribe" → `create-checkout-session` edge function
2. Stripe Checkout session created with:
   - `client_reference_id`: user.id
   - `metadata.plan`: plan key
   - `mode`: 'payment' (day_pass) or 'subscription' (others)
3. User completes payment on Stripe
4. Stripe sends webhook to `stripe-webhook` function
5. Webhook handler:
   - Verifies signature
   - Checks idempotency via `webhook_events` table
   - Creates/updates `user_entitlements`
6. User redirected to `/payment-success`

### Webhook Events Handled

- `checkout.session.completed` - One-time payments (day_pass)
- `customer.subscription.created` - New subscriptions
- `customer.subscription.updated` - Subscription changes
- `customer.subscription.deleted` - Cancellations
- `invoice.payment_succeeded` - Recurring payments

---

## 🔄 Automated Data Pipeline

### Cron Jobs (pg_cron)

| Job | Schedule | Function | Purpose |
|-----|----------|----------|---------|
| stats-refresh-batch-cron | */10 * * * * | stats-refresh | Refresh 25 teams per batch |
| warmup-optimizer-cron | */30 * * * * | cron-warmup-odds | Odds + optimizer refresh |
| stats-health-check-6h | 0 */6 * * * | stats-health-check | Data quality monitoring |
| sync-injuries-12h | 0 */4 * * * | sync-injuries | Player injuries sync |
| sync-player-importance-daily | 0 3 * * * | sync-player-importance | Player stats sync |
| fixtures-history-backfill | 0 */6 * * * | fixtures-history-backfill | Historical data import |
| admin-remediate-stats-gaps-weekly | 0 3 * * 1 | admin-remediate-stats-gaps | Weekly gap remediation |

### Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     DATA INGESTION LAYER                        │
├─────────────────────────────────────────────────────────────────┤
│  API-Football  ──►  fetch-fixtures  ──►  fixtures table         │
│                ──►  results-refresh ──►  fixture_results table  │
│                ──►  sync-injuries   ──►  player_injuries table  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     STATS COMPUTATION LAYER                     │
├─────────────────────────────────────────────────────────────────┤
│  stats-refresh  ──►  Compute last-5 averages  ──►  stats_cache  │
│  (25 teams/10min)    Per-metric partial data     (team stats)   │
│                      League coverage aware                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     OPTIMIZATION LAYER                          │
├─────────────────────────────────────────────────────────────────┤
│  backfill-odds  ──►  Fetch odds  ──►  odds_cache                │
│  optimize-selections-refresh  ──►  Apply rules  ──►             │
│                                     optimized_selections         │
│                      (Goals O2.5, Corners O9.5, Cards O3.5)     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     USER-FACING FEATURES                        │
├─────────────────────────────────────────────────────────────────┤
│  Filterizer  ──►  Query optimized_selections with filters       │
│  Ticket Creator  ──►  AI-generated multi-leg tickets            │
│  Fixture Analyzer  ──►  Deep dive on single fixture             │
│  Winner Panel  ──►  1X2 predictions                             │
│  Team Totals  ──►  Team scoring analysis                        │
└─────────────────────────────────────────────────────────────────┘
```

### Rate Limiting

- API-Football ULTRA plan: 75,000 requests/day
- Current usage: ~25,000-35,000/day (33-47%)
- Centralized rate limiting in `_shared/api_football.ts`
- Token bucket algorithm with configurable RPM (default 50)
- Exponential backoff for 429/5xx errors

---

## 🎯 Core Features

### 1. Filterizer (Premium)
Advanced betting selection filter with:
- Market type: Goals, Corners, Cards
- Date range: Today, Next 2 days, Next 3 days, All
- Odds range slider (1.0 - 5.0)
- Minimum edge % filter
- League/country filtering
- Results sorted by edge %

### 2. AI Ticket Creator (Premium)
Generates optimized multi-leg betting tickets:
- Target odds range (min/max)
- Match day range selection
- Live matches toggle
- Shuffle functionality
- Uses `generate-ticket` and `shuffle-ticket` edge functions

### 3. Fixture Analyzer (Premium)
Deep analysis of single fixture:
- Home team stats (last 5 matches)
- Away team stats (last 5 matches)
- Head-to-head stats (last 5 encounters)
- Combined predicted stats
- Injury impact assessment
- AI analysis via Gemini

### 4. Winner Panel (Premium)
Match outcome predictions:
- Home/Draw/Away probabilities
- Best odds per outcome
- Edge calculation

### 5. Team Totals (Premium)
Team scoring analysis:
- Season scoring rate
- Opponent conceding rate
- Recent form (2+ goals)
- Rules-based qualification

### 6. My Ticket
User's betting slip:
- Add/remove selections
- Stake input
- Total odds calculation
- Potential return
- Sync with server (authenticated users)

---

## 🌐 Supported Leagues

### Top 10 Priority Leagues (100% coverage target)
```javascript
TOP_LEAGUE_IDS = [39, 140, 135, 78, 61, 40, 136, 79, 88, 89]
```
- 39: Premier League (England)
- 140: La Liga (Spain)
- 135: Serie A (Italy)
- 78: Bundesliga (Germany)
- 61: Ligue 1 (France)
- 40: Championship (England)
- 136: Serie B (Italy)
- 79: 2. Bundesliga (Germany)
- 88: Eredivisie (Netherlands)
- 89: Eerste Divisie (Netherlands)

### International Competitions
```javascript
INTERNATIONAL_LEAGUE_IDS = [5, 1, 4, 960, 32, 34, 33, 31, 29, 30, 9, 36, 964]
```
- 2: UEFA Champions League
- 3: UEFA Europa League
- 848: UEFA Conference League
- 5: UEFA Nations League
- 1: World Cup
- etc.

### Domestic Cups
```javascript
CUP_LEAGUE_IDS = [45, 48, 143, 137, 81, 66]
```
- 45: FA Cup
- 48: EFL Cup
- 143: Copa del Rey
- 137: Coppa Italia
- 81: DFB-Pokal
- 66: Coupe de France

### Total Coverage
- 100+ leagues across 50+ countries
- Full ALLOWED_LEAGUE_IDS list in `_shared/leagues.ts`

---

## 📊 Stats Algorithm (Matrix-v3)

### Last-5 Stats Computation

1. **Fixture Selection**: 
   - Query last 5 FT (finished) matches for team
   - Season-aware (current season only)
   - Sorted by timestamp DESC

2. **Per-Metric Partial Averaging**:
   - Each metric (goals, corners, cards, fouls, offsides) computed independently
   - If a fixture has NULL for a metric, skip that fixture for that metric only
   - Prevents one missing stat from zeroing others

3. **League Coverage Awareness**:
   - Check `league_stats_coverage.skip_*` flags
   - Skip metrics for leagues with <30% coverage
   - Goals rarely skipped (only if <80%)

4. **Injury Impact**:
   - Query `player_injuries` joined with `player_importance`
   - Key players (importance >= 0.6) trigger goal reduction
   - Scaled reduction: 5-20% based on injury severity

### Combined Stats Formula
```
combined_goals = home_goals_avg + away_goals_avg
combined_corners = home_corners_avg + away_corners_avg
combined_cards = home_cards_avg + away_cards_avg
```

### Optimization Rules
```
Goals Over 2.5: combined_goals >= 4.5
Goals Over 1.5: combined_goals >= 3.0
Corners Over 9.5: combined_corners >= 10.0
Corners Over 8.5: combined_corners >= 9.0
Cards Over 3.5: combined_cards >= 3.5
```

---

## 🔑 Environment Variables

### Frontend (Vite)
```
VITE_SUPABASE_URL=https://dutkpzrisvqgxadxbkxo.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGc...
VITE_SUPABASE_PROJECT_ID=dutkpzrisvqgxadxbkxo
```

### Backend Secrets (Edge Functions)
```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
API_FOOTBALL_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
APP_URL (https://ticketai.bet)
CRON_INTERNAL_KEY
LOVABLE_API_KEY
```

---

## 🚀 Deployment

### Frontend
- Hosted on Lovable Cloud
- Automatic deployment on git push
- Custom domain: ticketai.bet

### Edge Functions
- Deployed to Supabase
- Automatic deployment via Lovable
- Functions available at: `https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/{function-name}`

### Database
- Supabase PostgreSQL (Lovable Cloud)
- Migrations managed via Lovable migration tool
- Types auto-generated in `src/integrations/supabase/types.ts`

---

## 🌍 Internationalization

### Supported Languages
- English (en) - Default
- Georgian (ka) - ქართული

### Translation Namespaces
- `common.json` - Shared translations
- `account.json` - Account page
- `admin.json` - Admin dashboard
- `filterizer.json` - Filterizer feature
- `filters.json` - Filter controls
- `fixtures.json` - Fixtures display
- `optimizer.json` - Optimizer UI
- `team_totals.json` - Team totals
- `ticket.json` - Ticket builder
- `tooltips.json` - Help tooltips
- `winner.json` - Winner panel

### Key Georgian Mappings
- "Filterizer" → "ფილტრი"
- "Team Totals" → "სტუმარ-მასპინძელი"

---

## 🛡️ Paywall System

### PaywallGate Component
```tsx
<PaywallGate featureKey="bet_optimizer" allowTrial={true}>
  <FeatureComponent />
</PaywallGate>
```

### Access Check Flow
1. Check `is_user_whitelisted()` → Admin bypass
2. Check `user_has_access()` → Paid user bypass
3. If `allowTrial`, call `try_use_feature(key)` → Consume trial credit
4. If no access, show upgrade prompt

### Feature Keys
- `bet_optimizer` - Filterizer, Winner, Team Totals, Ticket Creator
- `gemini_analysis` - AI Analysis feature

---

## 📈 Monitoring & Health

### Pipeline Health Check View
```sql
SELECT * FROM pipeline_health_check;
```
Returns:
- `checked_at` - Query timestamp
- `total_teams`, `fresh_stats`, `coverage_pct`
- `last_stats_batch`, `stats_batch_minutes_ago`
- `last_warmup_optimizer`, `warmup_minutes_ago`
- `active_pipeline_cron_jobs`, `total_cron_jobs`
- `health_status` - 'HEALTHY', 'WARNING', or 'CRITICAL'

### Health Status Criteria
- 🟢 HEALTHY: coverage ≥90%, warmup <60min, stats <20min, 2 active cron jobs
- 🟡 WARNING: coverage 70-90% or timestamps slightly stale
- 🔴 CRITICAL: coverage <70% or pipeline stopped

### Admin Dashboard (`/admin/health`)
- Real-time pipeline metrics
- Manual refresh buttons
- Stats health violations list
- Cron job status
- Turbo backfill triggers

---

## 🐛 Known Issues & Constraints

1. **Edge Function Timeout**: 60-second limit requires batch processing (25 items max)
2. **API Rate Limiting**: 75k/day limit requires careful scheduling
3. **Email Verification**: Required for new accounts (no auto-confirm)
4. **Stats Coverage**: Lower divisions may have <100% coverage
5. **Injury Data**: Only available for top leagues

---

## 📝 Key Operational Commands

### Check Pipeline Health
```sql
SELECT * FROM pipeline_health_check;
```

### Check Stats Coverage for Top Leagues
```sql
SELECT 
  league_id,
  COUNT(*) as total_teams,
  SUM(CASE WHEN sample_size >= 5 THEN 1 ELSE 0 END) as full_coverage,
  ROUND(100.0 * SUM(CASE WHEN sample_size >= 5 THEN 1 ELSE 0 END) / COUNT(*), 1) as pct
FROM stats_cache sc
JOIN fixtures f ON sc.team_id IN (
  (f.teams_home->>'id')::int,
  (f.teams_away->>'id')::int
)
WHERE f.league_id IN (39, 140, 135, 78, 61, 40, 136, 79, 88, 89)
  AND f.timestamp BETWEEN EXTRACT(EPOCH FROM NOW())
  AND EXTRACT(EPOCH FROM NOW() + INTERVAL '7 days')
GROUP BY league_id
ORDER BY pct ASC;
```

### Release Stuck Lock
```sql
DELETE FROM cron_job_locks WHERE job_name = 'stats-refresh';
```

### Manual Stats Refresh (Admin)
```bash
curl -X POST https://dutkpzrisvqgxadxbkxo.supabase.co/functions/v1/stats-refresh \
  -H "Authorization: Bearer {SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"window_hours": 120, "force": true}'
```

---

## 📚 Additional Documentation

- `AUTOMATED_PIPELINE.md` - Pipeline architecture details
- `PIPELINE_DOCUMENTATION.md` - Cron job documentation
- `SECURITY_SETUP.md` - Security configuration
- `STRIPE_SETUP.md` - Payment setup guide
- `STATS_*.md` - Various stats audit reports

---

*Last Updated: December 2025*
*Version: TICKET 1.0 BETA*
