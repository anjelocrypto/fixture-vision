-- Drop the security definer view
DROP VIEW IF EXISTS public.current_user_is_whitelisted;

-- Update is_user_whitelisted function to query user_roles directly
CREATE OR REPLACE FUNCTION public.is_user_whitelisted()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'admin'::app_role
  );
$$;