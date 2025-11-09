BEGIN;

-- 1) Safer security-definer function (guards cross-user access)
CREATE OR REPLACE FUNCTION public.is_user_subscriber(check_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text := auth.role();
  target_user uuid := COALESCE(check_user_id, auth.uid());
BEGIN
  -- Only service_role may probe another user's status
  IF check_user_id IS NOT NULL AND check_user_id <> auth.uid() AND caller_role <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: cannot query another user''s subscription';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_entitlements ue
    WHERE ue.user_id = target_user
      AND ue.status = 'active'
      AND COALESCE(ue.current_period_end, now()) >= now()
      AND ue.plan <> 'free'
  );
END;
$$;

-- 2) Lock down execute privileges (SECURITY DEFINER best practice)
REVOKE ALL ON FUNCTION public.is_user_subscriber(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_user_subscriber(uuid) TO authenticated, anon, service_role;

-- 3) Back-compat view (so existing code that selects from v_is_subscriber doesn't break)
DROP VIEW IF EXISTS public.v_is_subscriber;
CREATE VIEW public.v_is_subscriber AS
SELECT
  auth.uid() AS user_id,
  public.is_user_subscriber(NULL) AS is_subscriber;

COMMIT;