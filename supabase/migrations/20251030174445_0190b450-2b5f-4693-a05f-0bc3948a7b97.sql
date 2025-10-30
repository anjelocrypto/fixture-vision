-- Fix security definer view by enabling security invoker mode
-- This makes the view respect RLS policies of the querying user instead of the view creator

ALTER VIEW public.backtest_samples SET (security_invoker = on);