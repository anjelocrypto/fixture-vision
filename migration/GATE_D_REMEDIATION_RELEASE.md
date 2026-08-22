# Gate D Remediation RC Release Procedure

This release is deliberately limited to Gate D blockers. It does not authorize
provider validation, bulk backfills, rebuilds, paid quota changes, Gate E, or
activation of any cron job other than the already-active job 48.

## Preconditions

1. Record the exact RC commit SHA and verify it is a descendant of production.
2. Verify `cron.job` contains 28 jobs, exactly one active job, and that active
   job is job 48 (`auto-release-stuck-locks-15m`).
3. Verify every other cron job, including jobs 42, 55, 64, and 66, is inactive.
4. Read job 64 without exposing its credential. Confirm its command contains a
   literal HTTPS URL ending in `/functions/v1/populate-safe-zone-picks`; record
   only a redacted command hash and whether an Authorization header is present.
5. Do not invoke any Edge Function or provider endpoint during this release.

## Apply

1. Apply only `supabase/migrations/20260822174500_gate_d_remediation.sql`.
2. Deploy only these corrected Edge Functions from the exact RC SHA:
   - `stats-health-check`
   - `pipeline-health-snapshot`
   - `score-ticket-legs`
   - `cron-fetch-fixtures`
   - `stats-refresh`
   - `sync-injuries`
   - `sync-player-importance`
   - `team-totals-refresh`
   - `optimize-selections-refresh`
   - `btts-refresh`

Shared modules imported by those function bundles are part of the deployment.
Do not publish the frontend and do not deploy any other function.

## Required postflight (read-only)

1. Confirm `claim_scorable_ticket_legs(integer)` and
   `get_ticket_pipeline_health_metrics()` exist and are executable only by
   `service_role` (not PUBLIC, `anon`, or `authenticated`).
2. Confirm job 64 remains inactive, its command uses `x-cron-key` through
   `public.get_cron_internal_key()`, and it no longer contains an Authorization
   header or JWT-like literal. Do not print any secret value.
3. Confirm all 10 function deployments succeeded from the exact RC SHA.
4. Confirm `cron.job` still has exactly one active job and it is job 48; every
   other job remains inactive.
5. Stop and report. Provider validation and additional cron activation require
   separate authorization.

## Failure handling

- On migration error, rely on the transaction rollback and make no deployment.
- On partial function-deployment error, leave all affected cron jobs inactive,
  keep job 48 as the sole active job, report the exact deployment set, and stop.
- Do not restore job 64's embedded bearer credential. If its rewrite cannot be
  verified, keep job 64 inactive and report the blocker.
