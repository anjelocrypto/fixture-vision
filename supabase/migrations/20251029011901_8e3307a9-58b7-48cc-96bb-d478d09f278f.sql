-- Fix the security definer view warning by explicitly setting security_invoker
-- This ensures the view runs with the privileges of the querying user, not the view owner
ALTER VIEW public.current_user_is_whitelisted 
SET (security_invoker = true);