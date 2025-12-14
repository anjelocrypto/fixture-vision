-- Fix security definer view warning by using SECURITY INVOKER
ALTER VIEW public.pipeline_health_dashboard SET (security_invoker = true);