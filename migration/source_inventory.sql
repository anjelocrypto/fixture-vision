-- TICKET AI source inventory
-- Read-only apart from session-local temporary objects. Run as a database
-- administrator and save every result set with a UTC timestamp.

BEGIN READ ONLY;

SELECT
  current_database() AS database_name,
  current_setting('server_version') AS postgres_version,
  now() AT TIME ZONE 'utc' AS captured_at_utc;

SELECT
  extname,
  extversion,
  n.nspname AS schema_name
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY extname;

SELECT
  n.nspname AS schema_name,
  c.relname AS object_name,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'p' THEN 'partitioned_table'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized_view'
    WHEN 'S' THEN 'sequence'
    ELSE c.relkind::text
  END AS object_type,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  c.reltuples::bigint AS estimated_rows,
  pg_total_relation_size(c.oid) AS total_bytes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'auth', 'storage')
  AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
ORDER BY n.nspname, c.relname;

SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

SELECT
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS columns
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_schema = tc.constraint_schema
 AND kcu.constraint_name = tc.constraint_name
 AND kcu.table_name = tc.table_name
WHERE tc.table_schema = 'public'
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
GROUP BY tc.table_schema, tc.table_name, tc.constraint_name, tc.constraint_type
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

SELECT
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  ccu.table_schema AS referenced_schema,
  ccu.table_name AS referenced_table,
  ccu.column_name AS referenced_column,
  rc.update_rule,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name
 AND kcu.constraint_schema = tc.constraint_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.constraint_schema = tc.constraint_schema
JOIN information_schema.referential_constraints rc
  ON rc.constraint_name = tc.constraint_name
 AND rc.constraint_schema = tc.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;

SELECT
  n.nspname AS schema_name,
  p.proname AS routine_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  p.proconfig AS runtime_settings,
  pg_get_userbyid(p.proowner) AS owner
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname, identity_arguments;

SELECT
  routine_schema,
  routine_name,
  grantee,
  privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
ORDER BY routine_name, grantee;

SELECT
  n.nspname AS schema_name,
  p.proname AS routine_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  CASE
    WHEN p.prosrc ~* 'dutkpzrisvqgxadxbkxo' THEN 'legacy_project_ref'
    WHEN p.prosrc ~* 'https://[a-z]{20}\.supabase\.co' THEN 'hardcoded_supabase_url'
    WHEN p.prosrc ~ 'eyJ[A-Za-z0-9_-]{30,}\.' THEN 'jwt_like_literal'
    ELSE 'review'
  END AS finding
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.prosrc ~* 'dutkpzrisvqgxadxbkxo'
    OR p.prosrc ~* 'https://[a-z]{20}\.supabase\.co'
    OR p.prosrc ~ 'eyJ[A-Za-z0-9_-]{30,}\.'
  )
ORDER BY p.proname;

SELECT
  count(*) AS auth_users,
  count(*) FILTER (WHERE email_confirmed_at IS NOT NULL) AS confirmed_users,
  count(*) FILTER (WHERE email_confirmed_at IS NULL) AS unconfirmed_users,
  count(*) FILTER (WHERE banned_until > now()) AS banned_users,
  min(created_at) AS first_user_created_at,
  max(created_at) AS latest_user_created_at
FROM auth.users;

SELECT
  provider,
  count(*) AS identity_count
FROM auth.identities
GROUP BY provider
ORDER BY provider;

SELECT
  lower(trim(email)) AS normalized_email,
  count(*) AS duplicate_count
FROM auth.users
WHERE email IS NOT NULL
GROUP BY lower(trim(email))
HAVING count(*) > 1
ORDER BY duplicate_count DESC, normalized_email;

SELECT
  count(*) AS orphan_profiles
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE u.id IS NULL;

SELECT
  count(*) AS orphan_entitlements
FROM public.user_entitlements e
LEFT JOIN auth.users u ON u.id = e.user_id
WHERE u.id IS NULL;

SELECT
  stripe_customer_id,
  count(*) AS entitlement_count
FROM public.user_entitlements
WHERE stripe_customer_id IS NOT NULL
GROUP BY stripe_customer_id
HAVING count(*) > 1
ORDER BY entitlement_count DESC, stripe_customer_id;

SELECT
  stripe_subscription_id,
  count(*) AS entitlement_count
FROM public.user_entitlements
WHERE stripe_subscription_id IS NOT NULL
GROUP BY stripe_subscription_id
HAVING count(*) > 1
ORDER BY entitlement_count DESC, stripe_subscription_id;

SELECT
  status,
  plan,
  count(*) AS entitlement_count,
  min(current_period_end) AS earliest_period_end,
  max(current_period_end) AS latest_period_end
FROM public.user_entitlements
GROUP BY status, plan
ORDER BY status, plan;

SELECT
  pubname,
  schemaname,
  tablename
FROM pg_publication_tables
ORDER BY pubname, schemaname, tablename;

SELECT
  b.id AS bucket_id,
  b.name,
  b.public,
  count(o.id) AS object_count,
  coalesce(sum((o.metadata->>'size')::bigint), 0) AS object_bytes
FROM storage.buckets b
LEFT JOIN storage.objects o ON o.bucket_id = b.id
GROUP BY b.id, b.name, b.public
ORDER BY b.name;

-- pg_cron is environment-specific and must be recreated separately.
SELECT
  jobid,
  schedule,
  command,
  nodename,
  database,
  username,
  active,
  jobname
FROM cron.job
ORDER BY jobname, jobid;

SELECT
  j.jobname,
  d.status,
  d.start_time,
  d.end_time,
  left(d.return_message, 500) AS return_message
FROM cron.job_run_details d
JOIN cron.job j ON j.jobid = d.jobid
WHERE d.start_time >= now() - interval '30 days'
ORDER BY d.start_time DESC;

ROLLBACK;
