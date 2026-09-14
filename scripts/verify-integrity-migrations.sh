#!/usr/bin/env bash
# Applies every migration that landed AFTER the original 11 Phase 3 migrations
# (reschedule-integrity, hold-safety, security hardening, production-integrity
# RC3) to a disposable database and runs the SQL behaviour suites against it.
set -euo pipefail

test_database="${TICKET_AI_INTEGRITY_DATABASE:-ticket_ai_phase3_integrity}"
case "${test_database}" in
  ticket_ai_phase3_*) ;;
  *)
    echo "Refusing to replace unexpected database: ${test_database}" >&2
    exit 2
    ;;
esac

dropdb --if-exists "${test_database}"
# UTF8 is mandatory: the team-name normaliser relies on multi-byte translate().
createdb --encoding=UTF8 --locale=C --template=template0 "${test_database}"

psql_args=(-X -q -v ON_ERROR_STOP=1 -d "${test_database}")

# Disposable production-shaped fixtures.
psql "${psql_args[@]}" -f supabase/tests/reschedule_integrity_harness.sql
psql "${psql_args[@]}" -f supabase/tests/security_surface_harness.sql

post_phase3_migrations=(
  supabase/migrations/20260822182759_bba040c2-8412-4bf0-ada6-1609a585474e.sql
  supabase/migrations/20260822221157_f13a944d-fc25-4bff-879d-a7dcd076b413.sql
  supabase/migrations/20260822221221_2f225235-b5d0-4ea8-bd3c-59ad423873e6.sql
  supabase/migrations/20260822221250_1bf43312-98a0-4c99-9b51-5d6ff2f80864.sql
  supabase/migrations/20260822222105_29c1bfe0-a8ee-41af-8f5c-ea77c906e01f.sql
  supabase/migrations/20260822225213_d2f72358-a392-4ba6-af23-8256a81e81f9.sql
  supabase/migrations/20260822232643_f99cef81-0fdb-4278-9dfb-23367552a7fe.sql
  supabase/migrations/20260822234440_82e15228-eb7e-4cda-afd6-a63692b0d615.sql
  supabase/migrations/20260822234539_870bac5d-0322-4444-b9a8-fa6da4d00115.sql
  supabase/migrations/20260914220921_7a853358-0292-4ede-a5ad-7a4908309517.sql
)

for migration_file in "${post_phase3_migrations[@]}"; do
  echo "-- applying ${migration_file}"
  psql "${psql_args[@]}" -f "${migration_file}"
done

# Every migration in supabase/migrations newer than the Phase 3 batch must be
# listed above, otherwise CI silently stops covering new schema.
newest_covered="20260914220921"
uncovered="$(
  find supabase/migrations -maxdepth 1 -name '2026082216*.sql' -prune -o \
    -maxdepth 1 -name '*.sql' -print |
  sed 's|.*/||' |
  awk -F_ -v newest="${newest_covered}" '$1 > "20260822160933" && $1 > newest'
)"
if [ -n "${uncovered}" ]; then
  echo "Migrations not covered by this script:" >&2
  echo "${uncovered}" >&2
  exit 3
fi

psql "${psql_args[@]}" -f supabase/tests/reschedule_integrity_test.sql
psql "${psql_args[@]}" -f supabase/tests/hold_safety_v2_test.sql

echo "Post-Phase 3 migration, reschedule-integrity and hold-safety suites passed."
