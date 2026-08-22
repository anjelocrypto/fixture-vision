# TICKET AI live Phase 3 release order

This is the expand-first release path for the existing Lovable Cloud project.
It is separate from the future clean-Supabase migration described in
`migration/README.md`.

## Production status — 2026-08-22

Gate A and Gate B passed. Lovable applied all 11 migrations to production and
recorded them on `main` using platform-generated timestamps. The Gate C branch
must preserve those applied records and must not add the earlier candidate
filenames to `supabase/migrations`, because Lovable would treat them as new.

## Hard stops

- Keep the production Cloud freeze active.
- Do not replay the historical migration directory.
- Keep the manual legacy replay guard at `migration/DO_NOT_REPLAY_LEGACY.sql`;
  never move it into Lovable's auto-applied `supabase/migrations` directory.
- Do not add or apply `20260728000100_rotate_exposed_cron_key.sql` to the live
  project. Lovable Phase 2 already rotated/contained that credential.
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

Applied production records, in order:

1. `20260822160231_23f736a1-0a22-44ac-a367-09e52462c3b5.sql` — Stripe webhook safety
2. `20260822160257_eef3a665-7db4-4d02-922b-16c29b8c6b26.sql` — unique Stripe mappings
3. `20260822160349_c21b22e2-5d99-4dd3-96dc-4af4681553c0.sql` — access and rate-limit safety
4. `20260822160441_d167d730-c703-46e3-9717-9fd4ddf4162e.sql` — ticket write atomicity
5. `20260822160514_f3569797-7e5b-4c44-a633-1626945594e8.sql` — green policy versions
6. `20260822160558_2ec25c7d-327b-4818-bc30-bdc26397193a.sql` — worker claims and cron leases
7. `20260822160650_89501ea0-ee1b-4cec-bfaf-5beeb4fecb5a.sql` — alert lifecycle
8. `20260822160736_bd6d1fc3-88c2-4a02-801e-e62296d673b3.sql` — legacy path interop
9. `20260822160808_65598210-0ecc-408a-a8e1-d48685ea5c54.sql` — authoritative football rosters
10. `20260822160850_19836f05-01fe-4790-a25b-309c24a6c99a.sql` — stats refresh queue
11. `20260822160933_c02a473d-551a-4ec8-ab79-ae9ff571c9d1.sql` — privacy requests

These migrations have already been applied. Do not apply them again to the
live project. The disposable CI database replays them only for verification.

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
