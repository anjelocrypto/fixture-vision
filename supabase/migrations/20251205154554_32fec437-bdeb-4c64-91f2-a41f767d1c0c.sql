-- Fix SECURITY INVOKER on pipeline_health_check view
ALTER VIEW pipeline_health_check SET (security_invoker = on);