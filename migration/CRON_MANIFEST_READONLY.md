# TICKET AI — live cron manifest (read-only export)

Exported for the next Provider/Cron Control gate. Secrets redacted: every HTTP
job reads `X-CRON-KEY` from `public.app_settings` at run time; no key material
appears here. Nothing in this file was modified or activated.

Total jobs: 28. Active: 1 (jobid 48).

| jobid | name | schedule | active | target | request body |
|---|---|---|---|---|---|
| 24 | cleanup-old-results | 0 4 1 * * | no | sql-only | — |
| 26 | purge-stale-prematch-selections-5m | */5 * * * * | no | sql-only | — |
| 31 | cron-fetch-fixtures-10m | */10 * * * * | no | fetch-fixtures | `{"window_hours":120}` |
| 37 | sync-injuries-12h | 0 */4 * * * | no | sync-injuries | `{"season":2025}` |
| 38 | sync-player-importance-daily | 0 3 * * * | no | sync-player-importance | `{"season":2025}` |
| 40 | fixtures-history-backfill-cron | 0 */6 * * * | no | fixtures-history-backfill | `{"seasonsBack":2,"batchSize":5,"fixturesPerLeague":50}` |
| 41 | admin-remediate-stats-gaps-weekly | 0 3 * * 1 | no | admin-remediate-stats-gaps | `{"mode":"weekly","maxAPICallsPerRun":500}` |
| 42 | stats-health-check-6h | 0 */6 * * * | no | stats-health-check | `{"mode":"upcoming","autoHeal":true,"lookbackDays":7}` |
| 43 | stats-refresh-batch-cron | */10 * * * * | no | stats-refresh | `{"window_hours":48,"stats_ttl_hours":24,"force":false}` |
| 44 | warmup-optimizer-cron | */30 * * * * | no | cron-warmup-odds | `{"window_hours":48}` |
| 47 | smoke-test-analytics-6h | 0 */6 * * * | no | smoke-test-analytics | `{}` |
| 48 | auto-release-stuck-locks-15m | */15 * * * * | **yes** | sql-only (`auto_release_stuck_locks(30)`) | — |
| 49 | btts-refresh-6h | 0 */6 * * * | no | btts-refresh | `{"source":"cron"}` |
| 54 | basketball-backfill | 0 */6 * * * | no | basketball-backfill | `{"league_key":"nba"}` |
| 55 | score-ticket-legs-cron | */10 * * * * | no | score-ticket-legs | `{"limit":500}` |
| 56 | basketball-sync-fixtures | */30 * * * * | no | basketball-sync-fixtures | `{"window_hours":72}` |
| 57 | basketball-sync-results | */30 * * * * | no | basketball-sync-results | `{"limit":100}` |
| 58 | basketball-stats-refresh | 0 */2 * * * | no | basketball-stats-refresh | `{}` |
| 59 | team-totals-refresh-cron | 0 */6 * * * | no | team-totals-refresh | `{"window_hours":48}` |
| 60 | update-performance-weights-weekly | 0 3 * * 0 | no | update-performance-weights | `{"source":"cron"}` |
| 61 | market-close-expired-cron | */5 * * * * | no | sql-only | — |
| 62 | market-auto-resolve-cron | */10 * * * * | no | sql-only | — |
| 63 | downgrade-expired-entitlements-5m | */5 * * * * | no | sql-only | — |
| 64 | populate-safe-zone-picks-hourly | 15 */1 * * * | no | populate-safe-zone-picks | `{}` |
| 65 | auto-backfill-drain-5m | */5 * * * * | no | auto-backfill-results | `{"batch_size":50,"lookback_days":30}` |
| 66 | pipeline-health-snapshot-10m | */10 * * * * | no | pipeline-health-snapshot | `{}` |
| 67 | rebuild-green-buckets-daily | 0 4 * * * | no | rebuild-green-buckets | `{}` |
| 68 | prune-operational-logs | 0 3 * * * | no | sql-only | — |

Notes for the next gate:
- Job 65 (`auto-backfill-results`) now runs the RC3 strict parser and the atomic
  `ingest_fixture_result_tx` writer; it is the only provider-calling ingestion job.
- Job 55 (`score-ticket-legs`) now writes `scorer_run_logs` and can never settle a
  held or dynamically unsafe leg (`finalize_scored_ticket_leg` re-evaluates under lock).
- Jobs 31/37/38/40/41/42/43/44 are the provider-quota consumers; re-activation must be
  sequenced against the 65,000 daily API-Football budget.
