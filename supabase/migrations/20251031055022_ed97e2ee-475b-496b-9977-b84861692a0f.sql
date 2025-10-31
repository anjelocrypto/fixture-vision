-- Safer try_use_feature with admin bypass + auth guard + underflow guard
CREATE OR REPLACE FUNCTION public.try_use_feature(feature_key text)
RETURNS TABLE(allowed boolean, reason text, remaining_uses integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  uid uuid := auth.uid();
  has_paid boolean;
  is_admin boolean;
  cur_remaining int;
BEGIN
  -- 0) Auth required
  IF uid IS NULL THEN
    RETURN QUERY SELECT false, 'unauthenticated', NULL::integer;
    RETURN;
  END IF;

  -- 1) Admin bypass (replaces old view)
  SELECT public.is_user_whitelisted() INTO is_admin;
  IF is_admin THEN
    RETURN QUERY SELECT true, 'admin', NULL::integer;
    RETURN;
  END IF;

  -- 2) Paid access
  SELECT public.user_has_access() INTO has_paid;
  IF has_paid THEN
    RETURN QUERY SELECT true, 'entitled', NULL::integer;
    RETURN;
  END IF;

  -- 3) Trial eligibility by feature
  -- Only these two are eligible for trial credits
  IF feature_key NOT IN ('gemini_analysis','bet_optimizer') THEN
    RETURN QUERY SELECT false, 'paywalled_feature', NULL::integer;
    RETURN;
  END IF;

  -- 4) Ensure trial row exists, then lock
  PERFORM public.ensure_trial_row();

  SELECT remaining_uses
    INTO cur_remaining
  FROM public.user_trial_credits
  WHERE user_id = uid
  FOR UPDATE;

  IF coalesce(cur_remaining, 0) <= 0 THEN
    RETURN QUERY SELECT false, 'no_trial_credits', 0;
    RETURN;
  END IF;

  -- 5) Decrement with underflow guard
  UPDATE public.user_trial_credits
     SET remaining_uses = remaining_uses - 1,
         updated_at     = now()
   WHERE user_id = uid
     AND remaining_uses > 0;

  RETURN QUERY SELECT true, 'trial', cur_remaining - 1;
END;
$$;

-- Make sure only authenticated users can execute
REVOKE ALL     ON FUNCTION public.try_use_feature(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.try_use_feature(text) TO authenticated;