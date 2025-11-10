-- SAFE: keep the same signature and return shape your UI expects
-- Returns: (allowed boolean, reason text, remaining_uses integer)
CREATE OR REPLACE FUNCTION public.try_use_feature(feature_key text)
RETURNS TABLE(allowed boolean, reason text, remaining_uses integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  cur_remaining integer;
BEGIN
  -- must be logged in
  IF uid IS NULL THEN
    RETURN QUERY SELECT false, 'unauthenticated', NULL::integer;
    RETURN;
  END IF;

  -- admin bypass (no trial consumption)
  IF public.is_user_whitelisted() THEN
    RETURN QUERY SELECT true, 'admin', NULL::integer;
    RETURN;
  END IF;

  -- paid/entitled bypass (no trial consumption)
  IF public.user_has_access() THEN
    RETURN QUERY SELECT true, 'entitled', NULL::integer;
    RETURN;
  END IF;

  -- trial only allowed for specific features
  IF feature_key NOT IN ('bet_optimizer','gemini_analysis') THEN
    RETURN QUERY SELECT false, 'paywalled_feature', NULL::integer;
    RETURN;
  END IF;

  -- ensure a row exists, then lock it
  PERFORM public.ensure_trial_row();

  SELECT remaining_uses
    INTO cur_remaining
  FROM public.user_trial_credits
  WHERE user_id = uid
  FOR UPDATE;

  IF cur_remaining IS NULL THEN
    -- safety: unexpected missing row
    RETURN QUERY SELECT false, 'no_trial_row', 0;
    RETURN;
  END IF;

  IF cur_remaining > 0 THEN
    UPDATE public.user_trial_credits
       SET remaining_uses = remaining_uses - 1,
           updated_at = now()
     WHERE user_id = uid
     RETURNING remaining_uses INTO cur_remaining;

    RETURN QUERY SELECT true, 'trial', cur_remaining;
    RETURN;
  ELSE
    RETURN QUERY SELECT false, 'no_credits', 0;
    RETURN;
  END IF;
END
$$;

-- Lock down execute permissions (idempotent)
REVOKE ALL ON FUNCTION public.try_use_feature(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.try_use_feature(text) TO authenticated, service_role;