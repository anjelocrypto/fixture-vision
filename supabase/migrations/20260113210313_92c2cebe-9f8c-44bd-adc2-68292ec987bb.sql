-- Fix legacy views to use SECURITY INVOKER consistently

-- 1. Fix pipeline_health_check (has security_invoker=on, should be =true)
ALTER VIEW public.pipeline_health_check SET (security_invoker = true);

-- 2. Fix v_problematic_cups (missing security_invoker)
ALTER VIEW public.v_problematic_cups SET (security_invoker = true);