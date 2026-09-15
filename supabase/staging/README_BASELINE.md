# Staging clean baseline (RC3.4)

The staging project must be created from a **reviewed clean baseline**, never by
replaying `supabase/migrations`. The historical directory is a production event
log; replaying it is blocked deliberately by
`migration/DO_NOT_REPLAY_LEGACY.sql`.

## Why the baseline cannot be produced from this sandbox

Exporting the approved schema requires a direct database connection
(`pg_dump --schema-only`) using the production database password. That
credential is not available to the agent, so the export is an **owner action**.

## Owner procedure

1. Record a successful backup / PITR point for the source project and keep the
   timestamp; the release gate requires it.
2. Export a schema-only baseline from the source project:

   ```bash
   pg_dump --schema-only --no-owner --no-privileges --schema=public \
     "$SOURCE_DB_URL" > migration/candidate_baseline_schema.sql
   ```

   Append the grant, RLS-policy and extension statements the dump omits, then
   strip every `cron.schedule(...)` call — staging runs **no** cron jobs and
   makes **no** provider calls during bootstrap.
3. Validate the candidate automatically, then review it by hand:

   ```bash
   node scripts/validate-baseline.mjs migration/candidate_baseline_schema.sql
   ```

   The validator rejects project references, JWT/Stripe-shaped literals,
   `SECURITY DEFINER` functions without a pinned `search_path`, and any cron
   scheduling. Manual SQL, RLS, grant, extension, trigger and seed review is
   still required before the baseline is accepted.
4. Apply the accepted baseline to the staging project, then deploy every edge
   function in `supabase/functions`.
5. Create the two synthetic users and run
   `supabase/staging/seed_staging_integration.sql` with the service role. The
   seed is idempotent — running it twice leaves the same rows.

## Environment protection (before the secrets are added)

GitHub → Settings → Environments → `staging-integration`:

- **Deployment branches:** `main` only.
- **Required reviewers:** at least one owner.
- Fork pull requests must never receive these values; the `integration` job is
  already gated to `workflow_dispatch` or a push to `main`.

Then add the six environment secrets listed in
`docs/staging-integration-setup.md`. Never production credentials.

## Local proof already in the repository

`supabase/staging/seed_schema_fixture.sql` mirrors the real column definitions,
nullability, defaults and unique keys of every table the seed touches. The seed
is executed twice against it in verification, proving validity and idempotence
without any staging access.
