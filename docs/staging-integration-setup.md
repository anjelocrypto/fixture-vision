# Staging integration environment (RC3.3)

The protected `integration` CI job runs the live authorization suite. It must
point at a **dedicated non-production Supabase project**. Production URLs and
keys must never be entered here, and no service-role key is used anywhere in
the suite.

## 1. Create the staging project

1. Create a new Supabase project, e.g. `ticket-ai-staging`.
2. Apply the approved schema: every file in `supabase/migrations`, in filename
   order (`supabase db push`).
3. Deploy every function in `supabase/functions` to that project.
4. Disable all cron jobs in the staging project. The suite makes no provider
   calls and expects no background mutation.

## 2. Create the synthetic users

Two confirmed email/password users, created through the staging project's auth
admin API (never real customer addresses):

| User | Email | Purpose |
| ---- | ----- | ------- |
| A | `staging-user-a@ticketai.test` | owner identity |
| B | `staging-user-b@ticketai.test` | foreign identity |

Use strong generated passwords and store them only as GitHub environment
secrets (below).

## 3. Seed the synthetic data

Run `supabase/staging/seed_staging_integration.sql` with the service role
against the staging project. It refuses to run if the database looks like
production (more than 5,000 fixtures) and creates:

- a staging country, league and finished fixture (`990001`),
- one persisted ticket with two legs for user A,
- one persisted ticket with one leg for user B.

The ids are fixed and mirrored in `src/test/rls-enforcement.test.ts`.

## 4. Environment secrets (owner action — the agent cannot set these)

GitHub → repository **Settings** → **Environments** → create/open
`staging-integration`, then add these **environment secrets**:

| Secret | Value |
| ------ | ----- |
| `TEST_SUPABASE_URL` | staging project URL |
| `TEST_SUPABASE_PUBLISHABLE_KEY` | staging publishable (anon) key |
| `TEST_USER_A_EMAIL` | `staging-user-a@ticketai.test` |
| `TEST_USER_A_PASSWORD` | user A password |
| `TEST_USER_B_EMAIL` | `staging-user-b@ticketai.test` |
| `TEST_USER_B_PASSWORD` | user B password |

## 5. Protection rules for the environment

- **Deployment branches:** `main` only.
- **Required reviewers:** at least one owner, so a pull request cannot pull the
  secrets on its own.
- The `integration` job is already gated to `workflow_dispatch` or a push to
  `main`, so fork pull requests never see these values.
- Never add production credentials to this environment, and never add these
  secrets at repository (non-environment) scope.

## 6. Running it

- CI: the `integration` job runs `node scripts/run-integration-tests.mjs`,
  which fails on **any** skipped test, so a missing secret is a red build
  rather than silent non-coverage.
- Locally: export the same six variables and run the same script.
