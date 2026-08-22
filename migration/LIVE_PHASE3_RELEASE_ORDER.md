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

After Gate B, run `migration/target_validation.sql`, then run
`migration/billing_safety_test.sql`. The billing test must finish with a
rollback. Do not resume paused jobs.

## Gate C — code release

Only after Gate B passes:

1. Merge the reviewed release commit so that it becomes the exact `main` tip.
2. Confirm all changed Edge Functions finish syncing.
3. Read `/version` and require the reported `release_sha` to equal the approved
   GitHub `main` SHA before publishing the frontend.
4. Publish the frontend update.
5. Run authenticated smoke tests for sign-in, paid access, checkout verification,
   ticket generation, ticket analysis, account/billing, and admin authorization.

## Gate D — controlled job recovery

Keep the five Phase 2 paused jobs paused. First run the football pipeline jobs
manually, one at a time, with recorded inputs/outputs and provider-call counts.
Activate a learned green policy only if it contains at least one validated
bucket; otherwise retain the explicitly labeled bootstrap policy. Resume a cron
job only after its manual run is healthy and its rollback is recorded.

The basketball jobs stay paused until current-season configuration and a quota
budget are separately approved.
