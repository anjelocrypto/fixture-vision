#!/usr/bin/env bash
set -euo pipefail

test_database="${TICKET_AI_TEST_DATABASE:-ticket_ai_phase3_ci}"
case "${test_database}" in
  ticket_ai_phase3_*) ;;
  *)
    echo "Refusing to replace unexpected database: ${test_database}" >&2
    exit 2
    ;;
esac

dropdb --if-exists "${test_database}"
createdb "${test_database}"

psql_args=(-X -q -v ON_ERROR_STOP=1 -d "${test_database}")
psql "${psql_args[@]}" -f migration/test_support/phase3_schema_fixture.sql
psql "${psql_args[@]}" -f migration/live_phase3_preflight.sql

migration_files=(
  supabase/migrations/20260728000200_stripe_webhook_safety.sql
  supabase/migrations/20260728000300_unique_stripe_mappings.sql
  supabase/migrations/20260822010100_access_and_rate_limit_safety.sql
  supabase/migrations/20260822010200_ticket_write_atomicity.sql
  supabase/migrations/20260822010300_green_policy_versions.sql
  supabase/migrations/20260822010400_worker_claims_and_cron_leases.sql
  supabase/migrations/20260822010500_alert_lifecycle.sql
  supabase/migrations/20260822010600_legacy_path_interop.sql
  supabase/migrations/20260822010700_authoritative_football_rosters.sql
  supabase/migrations/20260822010800_stats_refresh_queue.sql
  supabase/migrations/20260822010900_privacy_requests.sql
)

for migration_file in "${migration_files[@]}"; do
  psql "${psql_args[@]}" -f "${migration_file}"
done

psql "${psql_args[@]}" -f migration/phase3_safety_test.sql
psql "${psql_args[@]}" -f migration/live_phase3_postflight.sql
psql "${psql_args[@]}" -f migration/billing_safety_test.sql

echo "Phase 3 disposable migration and rollback safety checks passed."
