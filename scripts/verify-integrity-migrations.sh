#!/usr/bin/env bash
# Applies every migration that landed AFTER the original 11 Phase 3 migrations
# (reschedule-integrity, hold-safety, security hardening, production-integrity
# RC3) to disposable databases and runs the SQL behaviour suites against them.
# Each suite gets its own database so state cannot leak between suites.
set -euo pipefail

base_database="${TICKET_AI_INTEGRITY_DATABASE:-ticket_ai_phase3_integrity}"
case "${base_database}" in
  ticket_ai_phase3_*) ;;
  *)
    echo "Refusing to replace unexpected database: ${base_database}" >&2
    exit 2
    ;;
esac

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
  supabase/migrations/20260914223437_34442ed3-f533-4b98-bfb1-2dbcf51fd226.sql
)

# Guard: every migration newer than the Phase 3 batch must be listed above.
newest_covered="$(printf '%s\n' "${post_phase3_migrations[@]}" | sed 's|.*/||' | cut -d_ -f1 | sort | tail -1)"
uncovered="$(
  find supabase/migrations -maxdepth 1 -name '*.sql' |
  sed 's|.*/||' |
  awk -F_ -v newest="${newest_covered}" '$1 > "20260822160933" && $1 > newest'
)"
if [ -n "${uncovered}" ]; then
  echo "Migrations not covered by this script:" >&2
  echo "${uncovered}" >&2
  exit 3
fi

run_suite() {
  local suite_file="$1"
  local db="${base_database}_$2"

  dropdb --if-exists "${db}"
  # UTF8 is mandatory: the team-name normaliser relies on multi-byte translate().
  createdb --encoding=UTF8 --locale=C --template=template0 "${db}"

  local psql_args=(-X -q -v ON_ERROR_STOP=1 -d "${db}")
  psql "${psql_args[@]}" -f supabase/tests/reschedule_integrity_harness.sql
  psql "${psql_args[@]}" -f supabase/tests/security_surface_harness.sql
  for migration_file in "${post_phase3_migrations[@]}"; do
    psql "${psql_args[@]}" -f "${migration_file}"
  done
  psql "${psql_args[@]}" -f "${suite_file}"
  dropdb --if-exists "${db}"
}

run_suite supabase/tests/reschedule_integrity_test.sql reschedule
run_suite supabase/tests/hold_safety_v3_test.sql hold

echo "Post-Phase 3 migration, reschedule-integrity and hold-safety suites passed."
