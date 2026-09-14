# TICKET AI — cron activation-readiness matrix (read-only export)

Exported under the production freeze for the next Provider/Cron Control gate.
**Nothing in this file was activated, rescheduled, or modified.** Secrets are
redacted: no key material appears here, only the mechanism each job uses.

- Total jobs: 28. Active: 1 (jobid 48, `auto-release-stuck-locks-15m`).
- `cmd_md5` is the md5 of the exact live `cron.job.command` text at export time;
  it pins both the schedule target and the request body.
- Deployed function SHA: every Edge Function in this project is deployed from a
  single repository revision. The currently deployed revision is recorded in the
  release report accompanying this export; the platform does not expose a
  per-function content hash, so a per-job SHA column would be invented data and
  is deliberately **not** stated here.
- Provider budget: the API-Football plan limits are **not independently
  verified**. The previously circulated "65,000 calls/day" figure is an
  unverified assumption and must not be used as an activation input. Every
  provider-calling job below is marked `quota: UNVERIFIED` until plan evidence
  is produced.

## Authentication mechanisms

| code | meaning |
|---|---|
| `rpc` | header key read via `public.get_cron_internal_key()` |
| `direct` | header key read directly from `public.app_settings` (legacy split-brain read; must be migrated to `rpc` before activation) |
| `none` | SQL-only job, no HTTP call, no credential |

## Matrix

| jobid | name | schedule | active | target | cmd_md5 | auth | provider | max provider calls / exec | / day | timeout · retries · breaker | idempotency / locking | required confirmation | activation-safe |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 24 | cleanup-old-results | `0 4 1 * *` | no | sql-only (DELETE >18 months) | 7b678099 | none | no | 0 | 0 | single statement · none · n/a | destructive DELETE, not idempotent | none (destructive — owner sign-off required) | **NO** — destructive retention job |
| 26 | purge-stale-prematch-selections-5m | `*/5 * * * *` | no | sql-only | d407c76a | none | no | 0 | 0 | single statement · none · n/a | idempotent DELETE of expired rows | none | yes (low risk) |
| 31 | cron-fetch-fixtures-10m | `*/10 * * * *` | no | fetch-fixtures `{"window_hours":120}` | da220aa2 | rpc | **yes** | unbounded (legacy, no budget) | UNVERIFIED | no explicit timeout · unknown retries · none | none | none implemented | **NO** — legacy, unbudgeted |
| 37 | sync-injuries-12h | `0 */4 * * *` | no | sync-injuries `{"season":2025}` | c1ffdf7f | direct | **yes** | unbounded | UNVERIFIED | no explicit budget · unknown · none | none | none | **NO** |
| 38 | sync-player-importance-daily | `0 3 * * *` | no | sync-player-importance `{"season":2025}` | fe5d4096 | direct | **yes** | unbounded | UNVERIFIED | no explicit budget · unknown · none | overwrite-in-place | none | **NO** |
| 40 | fixtures-history-backfill-cron | `0 */6 * * *` | no | fixtures-history-backfill `{"seasonsBack":2,"batchSize":5,"fixturesPerLeague":50}` | 80757aa6 | direct | **yes** | ~250 (5 leagues × 50) — not enforced in code | UNVERIFIED | none · unknown · none | none | none | **NO** — legacy, unenforced budget |
| 41 | admin-remediate-stats-gaps-weekly | `0 3 * * 1` | no | admin-remediate-stats-gaps `{"mode":"weekly","maxAPICallsPerRun":500}` | 4ba2967c | direct | **yes** | 500 (declared in body only) | UNVERIFIED | none · unknown · none | none | none | **NO** — legacy |
| 42 | stats-health-check-6h | `0 */6 * * *` | no | stats-health-check `{"mode":"upcoming","autoHeal":true,"lookbackDays":7}` | 5dcfed33 | direct | **yes** | unbounded — **`autoHeal:true` makes this a writing, provider-calling job, not read-only** (previous classification corrected) | UNVERIFIED | none · unknown · none | none | none | **NO** — reclassified as a provider consumer; also has the known coverage arithmetic defect (>100% coverage) |
| 43 | stats-refresh-batch-cron | `*/10 * * * *` | no | stats-refresh `{"window_hours":48,"stats_ttl_hours":24,"force":false}` | a38c5c24 | direct | **yes** | 25 teams/run (documented batch cap) | UNVERIFIED | function-level batching · unknown · none | `team_stats_refresh_queue` claim/release | none | conditional — needs `rpc` auth migration + budget evidence |
| 44 | warmup-optimizer-cron | `*/30 * * * *` | no | cron-warmup-odds `{"window_hours":48}` | fa15fc92 | direct | **yes** | unbounded | UNVERIFIED | none · unknown · none | odds upsert is idempotent | none | **NO** — legacy |
| 47 | smoke-test-analytics-6h | `0 */6 * * *` | no | smoke-test-analytics `{}` | 97886e97 | rpc | no | 0 | 0 | n/a | read-only smoke checks | none | yes |
| 48 | auto-release-stuck-locks-15m | `*/15 * * * *` | **yes** | sql-only `auto_release_stuck_locks(30)` | fff3d65c | none | no | 0 | 0 | single statement · none · n/a | idempotent; only releases leases older than 30 min | none | yes — **currently the only active job** |
| 49 | btts-refresh-6h | `0 */6 * * *` | no | btts-refresh `{"source":"cron"}` | e742d565 | direct | no (local DB only) | 0 | 0 | none · unknown · none | recompute-in-place | none | conditional — needs `rpc` auth migration |
| 54 | basketball-backfill | `0 */6 * * *` | no | basketball-backfill `{"league_key":"nba"}` | 6aba6be3 | direct | **yes (provider consumer — omitted from the previous manifest)** | unbounded | UNVERIFIED | none · unknown · none | none | none | **NO** |
| 55 | score-ticket-legs | `*/10 * * * *` | no | score-ticket-legs `{"limit":500}` | 6b4c97d4 | rpc | no | 0 | 0 | 10 min claim lease · zero provider retries · n/a | durable claim token + fingerprint; finalization is atomic with the parent ticket refresh | **`confirm_scoring=true` and an explicit `batch_size`** | **NO as currently defined** — the body sends `limit`, which the function does **not** accept; RC3.1 scoring is strict and fail-closed, so this job body must be rewritten to `{"confirm_scoring":true,"batch_size":<1..500>}` before activation |
| 56 | basketball-sync-fixtures | `*/30 * * * *` | no | basketball-sync-fixtures `{"window_hours":72}` | 3e2401c9 | rpc | **yes (provider consumer — omitted from the previous manifest)** | unbounded | UNVERIFIED | none · unknown · none | upsert by fixture id | none | **NO** |
| 57 | basketball-sync-results | `*/30 * * * *` | no | basketball-sync-results `{"limit":100}` | bbc51f9b | rpc | **yes (provider consumer — omitted from the previous manifest)** | ≤100 | UNVERIFIED | none · unknown · none | upsert by fixture id | none | **NO** |
| 58 | basketball-stats-refresh | `0 */2 * * *` | no | basketball-stats-refresh `{}` | 59c3613e | rpc | **yes** | unbounded | UNVERIFIED | none · unknown · none | recompute-in-place | none | **NO** |
| 59 | team-totals-refresh-cron | `0 */6 * * *` | no | team-totals-refresh `{"window_hours":48}` | 36de2f5d | rpc | **yes (provider consumer — omitted from the previous manifest)** | unbounded | UNVERIFIED | none · unknown · none | recompute-in-place | none | **NO** |
| 60 | update-performance-weights-weekly | `0 3 * * 0` | no | update-performance-weights `{"source":"cron"}` | bb2f5a4f | rpc | no (local DB only) | 0 | 0 | none · unknown · none | delete-then-insert within a run | none | yes |
| 61 | market-close-expired-cron | `*/5 * * * *` | no | sql-only `close_expired_markets()` | 6382fb17 | none | no | 0 | 0 | single statement | idempotent status transition | none | yes |
| 62 | market-auto-resolve-cron | `*/10 * * * *` | no | sql-only `auto_resolve_markets()` | 8bf88b25 | none | no | 0 | 0 | single statement | idempotent; resolves only settled fixtures | none | yes |
| 63 | downgrade-expired-entitlements-5m | `*/5 * * * *` | no | sql-only | 872e7a52 | none | no | 0 | 0 | single statement | idempotent | none | yes |
| 64 | populate-safe-zone-picks-hourly | `15 */1 * * *` | no | populate-safe-zone-picks `{}` | f9343920 | rpc | no (local DB only) | 0 | 0 | none · unknown · none | recompute-in-place | none | yes |
| 65 | auto-backfill-drain-5m | `*/5 * * * *` | no | auto-backfill-results `{"batch_size":50,"lookback_days":30}` | c24b20d6 | rpc | **yes** | ≤ enforced `ProviderCallBudget` per run | UNVERIFIED | full-exchange timeout (headers + body + parse) · **0 retries** · circuit breaker latches on provider error envelopes and schema failures | atomic `ingest_fixture_result_tx`; safe to re-run | **`confirm_provider_calls=true`** — **missing from the current job body** | **NO as currently defined** — body must add `confirm_provider_calls: true`, otherwise every run is rejected |
| 66 | pipeline-health-snapshot-10m | `*/10 * * * *` | no | pipeline-health-snapshot `{}` | 3dcf9a3c | rpc | no | 0 | 0 | none · none · n/a | read-only snapshot + alert dedup | none | yes — RC3.1 replaced the false-liveness metrics (actionable 30-day backlog, real scorer progress, held/unsafe counts) |
| 67 | rebuild-green-buckets-daily | `0 4 * * *` | no | rebuild-green-buckets `{}` | 81e4eeac | rpc | no (local DB only) | 0 | 0 | none · unknown · none | full rebuild, idempotent | none | yes |
| 68 | prune-operational-logs | `0 3 * * *` | no | sql-only | 30ca4ea4 | none | no | 0 | 0 | single statement | idempotent retention prune | none | yes (retention policy already owner-approved) |

## Rollback / disable procedure (per job)

1. `SELECT cron.alter_job(<jobid>, active := false);` — takes effect immediately;
   an in-flight HTTP call still completes.
2. Confirm with `SELECT jobid, active FROM cron.job WHERE jobid = <jobid>;`.
3. For provider jobs, confirm no further calls: check the function's run log
   table (`pipeline_run_logs` / `scorer_run_logs`) for the next 2 intervals.
4. Scoring (55) and ingestion (65) are additionally fail-closed: removing the
   confirmation field from the body disables all mutating work without
   touching the schedule.

## Blockers that must clear before any ramp

- Jobs 37, 38, 40, 41, 42, 43, 44, 49, 54 read the cron key directly from
  `app_settings` instead of `get_cron_internal_key()` — the split-brain read
  must be unified first.
- Independently verified API-Football plan evidence (calls/minute and
  calls/day) is required before any job marked `UNVERIFIED` is activated.
- Job 55 body (`limit`) and job 65 body (missing `confirm_provider_calls`) must
  be rewritten; both jobs are fail-closed today and would only log rejections.
- Job 42's coverage arithmetic defect (reported >100% coverage) is unfixed and
  `autoHeal:true` makes it a writing provider consumer.
