# TICKET AI Supabase migration package

This directory is the controlled path from the Lovable-owned backend to a new
TICKET AI Supabase project. It intentionally does not contain credentials or a
fabricated database baseline.

## Current gate

The authenticated Supabase CLI account can access the Octopus project, but it
cannot access the Lovable-owned TICKET AI project (`dutkpzrisvqgxadxbkxo`).
Octopus is not a migration target and must not be modified.

Before a staging restore can begin, obtain one of:

1. a full database backup that contains `auth.users`, `auth.identities`, and
   password hashes; or
2. direct read-only database access plus a separate Lovable user export; or
3. table CSV exports plus the enhanced `export-users` output, accepting forced
   password reset and a tested old-ID to new-ID crosswalk.

Lovable currently documents user migration as partial and says passwords are
not exportable. A genuine full Supabase backup is different: Supabase documents
that the auth schema can preserve password hashes. Inspect the artifact before
choosing the identity path.

## Non-negotiable safety rules

- Do not run the historical `supabase/migrations` directory in a new project.
  The leading guard migration blocks accidental replay.
- Do not use the Octopus database as TICKET AI staging or production.
- Do not create production until a separate staging restore passes all gates.
- Never put project URLs, JWTs, database passwords, API keys, or cron keys in SQL.
- Preserve current Stripe customer, subscription, price, and entitlement IDs.
- Keep the old Stripe webhook enabled until the new endpoint has processed and
  reconciled live events successfully.
- Expect all existing Supabase sessions to expire at cutover.

## Phase 1 — source evidence

Run `source_inventory.sql` with read-only access and retain the result with the
cutover evidence. Also export:

- the complete database backup or every table listed in
  `table-classification.csv`;
- the live `cron.job` rows and the last 30 run results;
- auth provider, URL/redirect, SMTP, email-template, rate-limit, CAPTCHA, and MFA
  settings;
- Edge Function secrets by name only (re-enter values separately);
- deployed Edge Function names and versions;
- Storage buckets, policies, and object files, even if the repository scan found
  no Storage usage;
- Realtime publications;
- Stripe active/trialing/past-due/canceling subscriptions and one-time passes.

Record UTC timestamps and SHA-256 hashes for every export.

## Phase 2 — clean schema baseline

Preferred path with a direct connection:

```sh
mkdir -p migration/artifacts
pg_dump "$SOURCE_DB_URL" \
  --schema-only \
  --schema=public \
  --no-owner \
  --no-privileges \
  --file=migration/artifacts/baseline_schema.sql
node scripts/validate-baseline.mjs migration/artifacts/baseline_schema.sql
```

The dump is only a candidate. Review every `SECURITY DEFINER` function, grant,
policy, trigger, extension dependency, hardcoded URL, email, UUID, and secret.
Cron is deliberately not part of the public-schema baseline.

Then:

1. add explicit, reviewed extension declarations;
2. fold the three July 28 hardening migrations into the baseline;
3. put approved reference rows in a separate `reference_seed.sql`;
4. regenerate Supabase TypeScript types from staging;
5. replace the guarded legacy history with one timestamped baseline plus
   forward-only migrations;
6. replay it in an empty staging project twice: once fresh, once after teardown.

If only CSV exports are available, generate the schema from the live SQL
inventory and current desired definitions. Do not infer it solely from generated
TypeScript types.

## Phase 3 — identity decision

### Path A: full auth backup is present

Restore auth data in staging using Supabase's supported backup/restore path.
Verify user UUIDs, identities, password hashes, confirmation state, and metadata.
Use the target project's new JWT secret and require users to sign in again.

### Path B: password hashes are absent

Create a deterministic crosswalk with:

```text
old_user_id,new_user_id,normalized_email,source_created_at,migration_status
```

Do not import public user-owned tables until every active user has exactly one
target identity and the crosswalk has no duplicate normalized email. Rewrite
every user foreign key during staging import. Trigger password-recovery messages
only after SMTP and redirects pass end-to-end testing.

## Phase 4 — staged import order

1. extensions and clean public schema;
2. auth users/identities or the approved crosswalk;
3. profiles and roles;
4. billing entitlements and Stripe mappings;
5. market ledgers, positions, audit records, user tickets, outcomes, and credits;
6. reference data;
7. approved retained operational data;
8. optional warm cache data;
9. Edge Function secrets;
10. the production function allowlist;
11. Stripe test webhook, then live webhook;
12. approved cron jobs, installed disabled and enabled one by one.

Use `SET session_replication_role` only if an explicit, reviewed restore plan
requires it. Never leave triggers or RLS disabled after import.

## Phase 5 — staging gates

- `target_validation.sql` returns no failing rows.
- `billing_safety_test.sql` completes and rolls back without an exception.
- `npm ci`, typecheck, tests, build, and all Edge Function Deno checks pass.
- A new user can sign up, confirm, sign in, reset a password, and sign out.
- A migrated user can recover access and sees the correct owned records.
- RLS prevents cross-user access using real staging JWTs.
- Stripe test checkout, webhook replay, stale-event replay, cancellation,
  portal, restore-purchase, and reconciliation all pass.
- A duplicate webhook delivery changes entitlement state exactly once.
- Sports API quotas, backoff, and cron schedules are approved.
- Every `deploy_no_schedule` function in `function-registry.csv` has an owner,
  quota, and explicitly approved schedule before it is enabled.
- Source and target counts/checksums are reconciled by classification.
- Backup restore and application rollback are rehearsed.

## Phase 6 — production cutover

1. Lower DNS TTL at least 24 hours before the window.
2. Announce the maintenance window and password-reset behavior.
3. Disable source writes and source cron; record the UTC freeze time.
4. Take and hash the final export.
5. Restore the final delta and rerun validation.
6. Deploy functions and frontend with target project variables.
7. Enable the new Stripe webhook while keeping the old endpoint available.
8. Smoke-test auth, paid access, tickets, markets, and admin operations.
9. Enable approved cron jobs gradually.
10. Monitor errors, Stripe drift, sports API usage, and database load.
11. Keep the source read-only for the agreed rollback window.

Rollback means repointing the frontend to the still-intact source and disabling
target writes/webhooks/cron. It is not a reverse data merge.
