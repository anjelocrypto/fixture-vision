# TICKET AI live Phase 3 release order

This is the expand-first release path for the existing Lovable Cloud project.
It is separate from the future clean-Supabase migration described in
`migration/README.md`.

## Hard stops

- Keep the production Cloud freeze active.
- Do not replay the historical migration directory.
- Do not apply `00000000000000_DO_NOT_REPLAY_LEGACY.sql` to production; it is
  an intentional guard for a mistakenly empty migration target.
- Do not apply `20260728000100_rotate_exposed_cron_key.sql` to the current live
  project. Lovable Phase 2 already rotated/contained that credential; repeating
  the rotation is outside this release.
- Do not merge application/Edge Function changes into `main` before the expand
  migrations below have applied and passed their validation gates.
- Immediately before Gate B, capture all `cron.job` rows and pause every active
  job. Keep jobs paused through Edge Function synchronization. This prevents an
  old worker and a newly deployed worker from overlapping during cutover.

## Gate A — evidence and recovery

1. Verify a current Supabase-managed backup and record its UTC timestamp.
2. Run `migration/live_phase3_preflight.sql` read-only.
3. Stop on any exception, duplicate Stripe mapping, missing prerequisite, or
   unexpected existing Phase 3 object. Return evidence; do not improvise a fix.

## Gate B — database expand

Apply these forward migrations in this exact order, one at a time:

1. `20260728000200_stripe_webhook_safety.sql`
2. `20260728000300_unique_stripe_mappings.sql`
3. `20260822010100_access_and_rate_limit_safety.sql`
4. `20260822010200_ticket_write_atomicity.sql`
5. `20260822010300_green_policy_versions.sql`
6. `20260822010400_worker_claims_and_cron_leases.sql`
7. `20260822010500_alert_lifecycle.sql`
8. `20260822010600_legacy_path_interop.sql`
9. `20260822010700_authoritative_football_rosters.sql`
10. `20260822010800_stats_refresh_queue.sql`
11. `20260822010900_privacy_requests.sql`

After Gate B, run `migration/live_phase3_postflight.sql`, then run
`migration/billing_safety_test.sql`. Both must finish with a rollback. The
broader `target_validation.sql` remains the clean-project migration gate; it is
not a substitute for this live postflight. Do not resume paused jobs.

## Gate C — code release

Only after Gate B passes:

1. Merge the reviewed release commit so that it becomes the exact `main` tip.
2. Confirm all changed Edge Functions finish syncing.
3. Read `/version` and require the reported `release_sha` to equal the approved
   GitHub `main` SHA before publishing the frontend.
4. Publish the frontend update.
5. Run authenticated smoke tests for sign-in, paid access, checkout verification,
   ticket generation, ticket analysis, account/billing, personal-data export,
   deletion-request idempotency, and admin authorization. Do not purge the
   staging test account until its export has been verified.
6. Confirm old lock, scorer, and credit entrypoints coordinate with the new
   token/reservation paths using the validation queries; do not drop the legacy
   wrappers during the rollback window.

## Gate D — controlled job recovery

Keep the five Phase 2 paused jobs paused. First run the football pipeline jobs
manually, one at a time, with recorded inputs/outputs and provider-call counts.
Run `sync-football-rosters` in dry-run mode first. Execute the four core league
calls only with `confirm_provider_calls=true` after the quota owner approves the
four-call budget. Do not run roster-dependent analytics before those four
authoritative rosters exist.
Activate a learned green policy only if it contains at least one validated
bucket; otherwise retain the explicitly labeled bootstrap policy. Resume a cron
job only after its manual run is healthy and its rollback is recorded.

The basketball jobs stay paused until current-season configuration and a quota
budget are separately approved. The release code resolves seasons dynamically,
but that does not authorize provider calls. Restore the pre-release active state
only for jobs that pass a manual run; the five Phase 2 holds remain disabled.

## Ongoing privacy operations

Assign an owner and response target for pending `privacy_requests` before the
Account privacy controls are published. Process verified deletions only through
`migration/PRIVACY_OPERATIONS_RUNBOOK.md`; the user-facing request intentionally
does not cancel Stripe or delete an Auth identity by itself.
