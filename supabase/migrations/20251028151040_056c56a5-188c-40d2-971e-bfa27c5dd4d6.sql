-- Safer: no SECURITY DEFINER for simple timestamp trigger
CREATE OR REPLACE FUNCTION public.update_entitlements_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;