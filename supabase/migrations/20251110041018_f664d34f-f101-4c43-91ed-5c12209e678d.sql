-- Convert v_is_subscriber to SECURITY INVOKER (respects RLS on base tables)
BEGIN;

ALTER VIEW public.v_is_subscriber
  SET (security_invoker = true);

COMMENT ON VIEW public.v_is_subscriber
  IS 'User subscription status; SECURITY INVOKER so RLS on user_entitlements is enforced';

-- Tighten permissions: only authenticated users and service_role
REVOKE ALL ON public.v_is_subscriber FROM PUBLIC;
GRANT SELECT ON public.v_is_subscriber TO authenticated, service_role;

COMMIT;

-- Verification: confirm security_invoker is set
SELECT c.relname AS view_name,
       CASE WHEN 'security_invoker=true' = ANY(c.reloptions) THEN 'SECURITY INVOKER ✓'
            ELSE 'SECURITY DEFINER ✗'
       END AS security_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'v'
  AND n.nspname = 'public'
  AND c.relname IN ('backtest_samples', 'v_is_subscriber')
ORDER BY c.relname;