-- Make the existing view run as the caller (respect RLS), without dropping it
BEGIN;

ALTER VIEW public.backtest_samples
  SET (security_invoker = true);

COMMENT ON VIEW public.backtest_samples
  IS 'Historical backtest data; SECURITY INVOKER so RLS on base tables is enforced';

-- Tighten permissions: no PUBLIC; allow only signed-in users + backend
REVOKE ALL ON public.backtest_samples FROM PUBLIC;
GRANT SELECT ON public.backtest_samples TO authenticated, service_role;

COMMIT;

-- Quick verification: confirm the security_invoker flag is set
SELECT *
FROM pg_options_to_table((
  SELECT reloptions
  FROM pg_class
  WHERE relname = 'backtest_samples' AND relnamespace = 'public'::regnamespace
));

-- Sanity: RLS must be ON for both base tables (should be true/true)
SELECT relname, relrowsecurity AS rls_enabled
FROM pg_class
WHERE relname IN ('optimized_selections','fixture_results')
  AND relnamespace = 'public'::regnamespace
ORDER BY relname;