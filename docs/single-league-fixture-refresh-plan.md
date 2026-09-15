# Bounded single-league current-fixture refresh — PLAN ONLY (not executed)

The database holds 155 competitions (35 tagged 2024, 120 tagged 2025, none
2026) and zero upcoming fixtures. This plan describes the smallest possible
provider-backed refresh to prove the fixture path end to end. **It is not
authorized and has not been run.** Execution requires an explicit
authorization that lifts the provider-call freeze for this scope only.

## Scope

- Exactly one competition: **Premier League, league 39, season 2026**.
- Fixtures only. No results, no statistics, no odds, no scoring, no holds.
- One provider endpoint: `GET /fixtures?league=39&season=2026`.
- Hard budget: **maximum 3 provider calls**, `maxRetries = 0`, circuit breaker
  latched on the first systemic failure (same `ProviderCallBudget` used by the
  ingestion module).
- No cron activation. A single manual invocation with
  `confirm_provider_calls: true`; job 48 stays the only active cron.

## Preconditions

1. A successful backup / PITR point recorded, with the timestamp captured.
2. Read-only "before" snapshot: fixture count for league 39 by season, max
   kickoff, `leagues.season` for 39, `last_synced_at`.
3. Freeze invariants re-checked: 0 provider calls in the last run window,
   held legs exactly 2 on fixture 1401863, pending legs 9,975.

## Execution

1. Dry run first: fetch and log only, write nothing; assert the payload is a
   non-empty fixture array with valid numeric league/team IDs and terminal or
   scheduled statuses from the allowlist.
2. If the dry run is clean, one write pass upserting fixtures for league 39
   season 2026 only, restricted by an explicit `league_id = 39` predicate.
3. No other table is written. `leagues.season` is **not** flipped to 2026
   unless the fetched fixtures actually cover 2026.

## Verification

- Fixture rows for league 39 season 2026 > 0 and every kickoff in the future.
- Catalogue endpoint now reports league 39 as `current` with a real
  `upcoming_fixtures` count; every other competition still reports `stale`.
- No change to `fixture_results`, `ticket_leg_outcomes`, `ticket_outcomes`,
  market or billing tables (row-count and checksum comparison against the
  "before" snapshot).
- Provider call count matches the budget exactly.

## Rollback

Delete only the fixture rows created by this run (recorded by id list), or
restore from the recorded PITR point. No settled or held row is ever touched,
so rollback cannot affect user outcomes.

## Stop conditions

Any of: provider error, empty payload, malformed IDs, budget exhausted, write
count outside the expected range, or any change detected in a table outside
`fixtures` — stop, write nothing further, report.
