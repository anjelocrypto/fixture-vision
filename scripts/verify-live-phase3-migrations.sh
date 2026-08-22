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
  supabase/migrations/20260822160231_23f736a1-0a22-44ac-a367-09e52462c3b5.sql
  supabase/migrations/20260822160257_eef3a665-7db4-4d02-922b-16c29b8c6b26.sql
  supabase/migrations/20260822160349_c21b22e2-5d99-4dd3-96dc-4af4681553c0.sql
  supabase/migrations/20260822160441_d167d730-c703-46e3-9717-9fd4ddf4162e.sql
  supabase/migrations/20260822160514_f3569797-7e5b-4c44-a633-1626945594e8.sql
  supabase/migrations/20260822160558_2ec25c7d-327b-4818-bc30-bdc26397193a.sql
  supabase/migrations/20260822160650_89501ea0-ee1b-4cec-bfaf-5beeb4fecb5a.sql
  supabase/migrations/20260822160736_bd6d1fc3-88c2-4a02-801e-e62296d673b3.sql
  supabase/migrations/20260822160808_65598210-0ecc-408a-a8e1-d48685ea5c54.sql
  supabase/migrations/20260822160850_19836f05-01fe-4790-a25b-309c24a6c99a.sql
  supabase/migrations/20260822160933_c02a473d-551a-4ec8-ab79-ae9ff571c9d1.sql
)

for migration_file in "${migration_files[@]}"; do
  psql "${psql_args[@]}" -f "${migration_file}"
done

psql "${psql_args[@]}" -f migration/phase3_safety_test.sql
psql "${psql_args[@]}" -f migration/live_phase3_postflight.sql
psql "${psql_args[@]}" -f migration/billing_safety_test.sql

echo "Phase 3 disposable migration and rollback safety checks passed."
