# TicketAI Deep-Dive Audit Prompts

This document contains **copy-paste ready prompts** for Lovable to audit the remaining 10-20% of system details: timezones, UX edge cases, performance, AI costs, and code quality.

---

## 1. Timezones, Dates & "Today" Logic

### Prompt 1.1 - UTC Conversion Audit
```
Search in the whole repo for "utc_kickoff", "kickoff_at", "timestamp" and show me all the places where we convert between local time and UTC.
```

### Prompt 1.2 - Upcoming Fixtures Window
```
Show how we determine "upcoming fixtures" in all edge functions (fetch-fixtures, cron-fetch-fixtures, warmup-odds, optimize-selections-refresh). Do we consistently use UTC and the same time window (e.g., next 120 hours)?
```

### Prompt 1.3 - Unsafe Date Usage
```
Find any code that uses new Date() without specifying timezones. For each place, tell me if it's safe (purely for logging) or used in logic (season selection, filtering fixtures, etc.).
```

### Prompt 1.4 - Frontend Timezone Display
```
In the frontend, show where we display kickoff times. Are we formatting them in the user's local timezone, and are we consistent across CenterRail, RightRail, TicketDrawer, and WinnerPanel?
```

### Prompt 1.5 - SQL Timezone Bugs
```
Check if any SQL queries compare timestamps like "NOW()" vs a TIMESTAMP WITHOUT TIME ZONE column in a way that could cause off-by-one-day bugs.
```

---

## 2. Live vs Pre-Match Logic

### Prompt 2.1 - is_live Filter Audit
```
Search for "is_live" in the codebase and list all places where we set or filter by is_live. Confirm that optimizer and frontend currently only surface pre-match selections.
```

### Prompt 2.2 - Odds Mixing Prevention
```
In fetch-odds and get-latest-odds, show how we filter markets by status. Are we ever mixing live odds with pre-match odds?
```

### Prompt 2.3 - Cron Status Filters
```
Show if any cron job or edge function is filtering fixtures by status in a way that could accidentally include LIVE or POSTPONED fixtures.
```

### Prompt 2.4 - Results Refresh Status
```
Check if results-refresh uses only status = 'FT' fixtures when writing to fixture_results and stats_cache.
```

---

## 3. Analyzer / Ticket Validation Path

### Prompt 3.1 - Analyze Ticket Flow
```
Open supabase/functions/analyze-ticket/index.ts and explain the full control flow: what inputs it expects, which tables it reads, and what validations it performs on a user's ticket.
```

### Prompt 3.2 - Frontend Access Control
```
Show where analyze-ticket is called from the frontend (components/pages). Are we enforcing authentication and access control (plan/trial) before calling it?
```

### Prompt 3.3 - Missing Data Handling
```
Check if analyze-ticket internally calls stats_cache, optimized_selections, or raw odds_cache. If so, describe how it handles missing stats or missing odds for a leg.
```

### Prompt 3.4 - Gemini Analysis Guardrails
```
For analyze-fixture (Gemini analysis), show how we build the prompt to Lovable AI and what guardrails we have: max length of prompt, rate limiting per user, and error handling when Gemini is down or slow.
```

### Prompt 3.5 - Matrix-v3 Integration
```
Confirm whether analyze-ticket is using matrix-v3 stats (the new logic) or any older stats paths. Show me any TODO comments or legacy code paths related to Analyzer.
```

---

## 4. Filterizer / Winner / Team Totals Performance & Safety

### Prompt 4.1 - Filterizer Query Performance
```
Open supabase/functions/filterizer-query/index.ts and show all SQL queries it runs. Estimate their complexity: which indexes are used on optimized_selections or related tables?
```

### Prompt 4.2 - Result Limits
```
Check if filterizer-query has any hard limit on number of rows returned (e.g. limit 100/200). If a user asks for a super broad filter, do we risk returning thousands of rows?
```

### Prompt 4.3 - Winner Model Probability
```
Open populate-winner-outcomes and show how we compute model_prob for 1X2. Is this derived from API-Football predictions or our own formula?
```

### Prompt 4.4 - Team Totals Rules
```
For populate-team-totals-candidates, list all rules we apply when deciding whether a candidate "passes". Are these rules documented anywhere as business logic, or only embedded in code?
```

### Prompt 4.5 - Frontend Error States
```
Check whether WinnerPanel, TeamTotalsPanel, and FilterizerPanel each have proper loading/error/empty states on the frontend when the backend returns no data or errors.
```

---

## 5. Frontend UX Edge Cases & Error States

### Prompt 5.1 - Toast Coverage
```
Search for "toast.error" and "toast.success" in the frontend and list all user-visible error/success flows. Are there critical backend failures where the user gets no feedback?
```

### Prompt 5.2 - Selection Display States
```
Open CenterRail.tsx and SelectionsDisplay.tsx. Show how they behave when optimized_selections returns an empty array, when the fetch fails, and when the request is still loading.
```

### Prompt 5.3 - Gemini Analysis Failures
```
In GeminiAnalysis.tsx, show what we render if the analysis edge function times out, returns 500, or returns malformed data. Do we show a friendly retry option?
```

### Prompt 5.4 - Session Loss Handling
```
Check all ProtectedRoute and auth flows: what happens if Supabase client suddenly has no session (token revoked)? Do we redirect to /auth with a clear message, or does the app just hang?
```

### Prompt 5.5 - Ticket Drawer Null States
```
Show how MyTicketDrawer and TicketDrawer behave when there is no ticket data in the DB. Do we handle null/undefined states safely?
```

---

## 6. AI Costs, Rate Limiting & Abuse Prevention

### Prompt 6.1 - AI Call Inventory
```
Search for all calls to Lovable/Gemini in edge functions (e.g., analyze-fixture) and list them, including model names and any temperature/max tokens settings.
```

### Prompt 6.2 - Rate Limiting Check
```
Confirm whether there is any per-user or per-IP rate limiting on analyze-fixture or other AI-heavy endpoints. If not, show where we could plug in basic rate limiting (e.g., via app_settings or a rate_limits table).
```

### Prompt 6.3 - AI Error Handling
```
Show how we handle error types from Lovable AI: timeouts, API errors, quota exceeded. Are we catching those and returning clean error responses to the frontend?
```

### Prompt 6.4 - AI Response Caching
```
Check if any AI-generated content is cached (e.g., by fixture_id) so that repeated analysis of the same fixture by the same user doesn't re-hit Gemini every time. If not, show where a simple cache could be added.
```

### Prompt 6.5 - AI Code TODOs
```
Search for any "TODO" or "FIXME" comments in AI-related files and list them with context.
```

---

## 7. Code Quality: Dead Code, TODOs, Legacy Paths

### Prompt 7.1 - Comment Audit
```
Search the entire repo for "TODO", "FIXME", "HACK", and "legacy" and list all occurrences with filenames and line numbers.
```

### Prompt 7.2 - Unused Edge Functions
```
List any edge functions that are no longer called from the frontend or other functions (e.g., old stats or optimizer versions).
```

### Prompt 7.3 - Orphaned Secrets
```
Search for any environment variables referenced in code that are no longer defined in Lovable/Supabase secrets.
```

### Prompt 7.4 - Unused Types
```
Find any TypeScript types/interfaces that are defined but never used (e.g., old Ticket models or stats models).
```

### Prompt 7.5 - Legacy Systems
```
Show if there are any old rules engines, stats calculators, or optimizer versions still present (e.g., matrix-v1, matrix-v2) and confirm they are fully unused.
```

---

## 8. Testing & Local Development

### Prompt 8.1 - Test Coverage
```
Check if there are any automated tests (Jest, Vitest, etc.) in the repo. If yes, list them and summarize what they cover.
```

### Prompt 8.2 - Local Dev Setup
```
Show the recommended local dev flow in README/PROJECT docs: how to run frontend and edge functions locally, and how to point them to a dev database (if any).
```

### Prompt 8.3 - Test Data in Prod
```
Search for hardcoded values that look like "test", "sandbox", or "debug" in production functions – list any that could accidentally leak test behavior into prod.
```

### Prompt 8.4 - Debug Modes
```
Show if any edge function has a hidden "debug" mode triggered by query parameters or headers (e.g., ?debug=true).
```

---

## 9. Observability & Alerting

### Prompt 9.1 - External Monitoring
```
Search for any integration with external logging/monitoring tools (Sentry, Logflare, etc.). If none, confirm that our only observability is Supabase/Lovable logs.
```

### Prompt 9.2 - Stripe Webhook Monitoring
```
Show how we monitor Stripe webhook failures – do we rely solely on Stripe dashboard emails, or is there any in-app log/alert for repeated webhook errors?
```

### Prompt 9.3 - Error State Persistence
```
Check if any function writes "error states" into app_settings or another table for later inspection (e.g., last failed cron run).
```

### Prompt 9.4 - Error Categorization
```
List all usages of console.error in edge functions and categorize which ones are: transient warnings vs critical failures that should probably be alerted.
```

---

## 10. Business Logic Consistency & Docs

### Prompt 10.1 - Rules vs Spec
```
Compare the goals/corners/cards rule thresholds in _shared/rules.ts with the ones described in the project summary. Point out any differences in thresholds, markets, or edge calculations.
```

### Prompt 10.2 - Premium Feature Gating
```
Check that all premium features (filterizer, winner, team_totals, ticket_creator, gemini_analysis) are consistently gated via both PaywallGate in the frontend and try_use_feature in the backend.
```

### Prompt 10.3 - Rules Version Audit
```
Search for "rules_version" in the code and list all possible values we use. Confirm that only 'matrix-v3' is used for current optimizer output, and older versions are filtered out in the frontend.
```

### Prompt 10.4 - Matrix-v3 Documentation
```
Show if there is any explicit mapping or documentation in code (comments or README) that explains matrix-v3 design, so a new dev can onboard quickly without this external doc.
```

---

## How to Use This Document

1. **Copy each prompt** from the sections above
2. **Paste into Lovable** one at a time or in batches
3. **Document responses** in a new file like `DEEP_DIVE_AUDIT_RESULTS.md`
4. **Create action items** for any issues discovered
5. **Prioritize** based on:
   - **P0 (Critical)**: Security holes, data corruption risks, payment bugs
   - **P1 (High)**: UX blockers, performance issues, missing error handling
   - **P2 (Medium)**: Code quality, TODOs, missing docs
   - **P3 (Low)**: Nice-to-haves, optimization opportunities

---

---

## 11. Database Backups, Migration Safety & Disaster Recovery

### Prompt 11.1 - Backup Strategy
```
Show how backups are handled for the TicketAI database. Do we rely purely on Supabase automated backups, or is there any additional backup/export configured? What is the retention period and how would we restore to a previous point in time?
```

### Prompt 11.2 - Migration Safety
```
List the last 10 migrations related to TicketAI and show which of them are destructive (DROP/ALTER dropping columns or tables). For each destructive migration, describe how we would roll back if something went wrong in production.
```

### Prompt 11.3 - Disaster Playbook
```
If the TicketAI database or Supabase project became corrupted or accidentally dropped, what is the exact recovery process using Supabase/Lovable tools? Please outline a step-by-step plan (including restoring backups, re-deploying edge functions, and reconnecting the frontend).
```

### Prompt 11.4 - Single Points of Failure
```
Identify any single points of failure in the current TicketAI architecture (for example: dependence on a single Supabase region, Stripe/webhook availability, API-Football outages). For each, suggest how we could mitigate or at least detect failures quickly.
```

---

## 12. Analytics, Usage & Product Understanding

### Prompt 12.1 - Usage Analytics
```
Search the repo for any analytics integrations (e.g., Google Analytics, PostHog, custom events). If there are any, list what we track (page views, feature usage, conversions). If there are none, confirm that we currently have no behavioral analytics for TicketAI.
```

### Prompt 12.2 - Feature Usage Distribution
```
Using the database, estimate how many distinct users have used each premium feature (bet_optimizer, filterizer, winner, team_totals, ticket_creator, gemini_analysis) in the last 30 days. Output a small table with counts per feature.
```

### Prompt 12.3 - Trial Funnel
```
Using user_trial_credits and user_entitlements, compute:
- How many users have used at least 1 trial credit
- How many of those later purchased any plan
- Average number of trial uses before purchase

Return these numbers so we understand our trial → paid conversion.
```

---

## 13. External Plans, Quotas & Cost Risk

### Prompt 13.1 - API-Football Plan & Quotas
```
Document the current API-Football plan we are on (from env/notes if available): request limits per day/minute. Then estimate how many calls per day our current cron + backfill setup generates in worst case, and whether we are close to any limits.
```

### Prompt 13.2 - Stripe Live vs Test Safety
```
Show all places where Stripe keys and price IDs are used and confirm which ones are LIVE vs TEST. Verify that production uses only live keys and IDs, and that there is no way for a test key to be accidentally used in production.
```

### Prompt 13.3 - AI Cost Surface
```
List all AI/Lovable calls that incur variable cost (per-token or per-request). For each, estimate worst-case daily usage based on current code (e.g., if 100 active users all hit analyze-fixture 10 times). Highlight any endpoints that could accidentally generate large bills if abused.
```

### Prompt 13.4 - Abuse Scenarios
```
Based on our current access control and lack/presence of rate limiting, list concrete abuse scenarios (e.g., a single user spamming analyze-fixture) and suggest guardrails we should add (rate limiting, max requests per day, etc.).
```

---

## Next Steps After Audit

Based on findings, create:
1. **SECURITY_FIXES.md** - Immediate security patches needed
2. **PERFORMANCE_IMPROVEMENTS.md** - Index additions, query optimization
3. **UX_POLISH.md** - Error states, loading states, empty states
4. **CODE_CLEANUP.md** - Dead code removal, TODO resolution
5. **MONITORING_SETUP.md** - Alerting and observability improvements
6. **DISASTER_RECOVERY.md** - Backup verification, migration rollback procedures
7. **ANALYTICS_SETUP.md** - Usage tracking, conversion funnels, feature adoption
8. **COST_CONTROLS.md** - Rate limiting, quota monitoring, abuse prevention
