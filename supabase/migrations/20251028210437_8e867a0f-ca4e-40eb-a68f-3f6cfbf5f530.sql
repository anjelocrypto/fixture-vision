-- Shared credits table (one row per user for trial pool)
CREATE TABLE IF NOT EXISTS public.user_trial_credits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  remaining_uses integer NOT NULL DEFAULT 5,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_trial_credits ENABLE ROW LEVEL SECURITY;

-- RLS: owner can read/update own
DROP POLICY IF EXISTS "Users can read own trial credits" ON public.user_trial_credits;
CREATE POLICY "Users can read own trial credits"
  ON public.user_trial_credits
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own trial credits" ON public.user_trial_credits;
CREATE POLICY "Users can update own trial credits"
  ON public.user_trial_credits
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role manage
DROP POLICY IF EXISTS "Service manage trial credits" ON public.user_trial_credits;
CREATE POLICY "Service manage trial credits"
  ON public.user_trial_credits
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Helper to ensure row exists (SECURITY DEFINER; hardened search_path)
CREATE OR REPLACE FUNCTION public.ensure_trial_row()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_trial_credits (user_id, remaining_uses)
  VALUES (auth.uid(), 5)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

-- Entitlement view that considers whitelist emails "active"
CREATE OR REPLACE VIEW public.current_user_is_whitelisted AS
SELECT
  (lower(COALESCE((current_setting('request.jwt.claims', true))::json->>'email', '')) IN
   (SELECT unnest(ARRAY['lukaanjaparidzee99@gmail.com']))) AS is_whitelisted;

-- Atomic RPC to check access for a feature and decrement the trial if needed
CREATE OR REPLACE FUNCTION public.try_use_feature(feature_key text)
RETURNS TABLE(allowed boolean, reason text, remaining_uses integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_paid boolean;
  is_whitelisted boolean;
  cur_remaining int;
BEGIN
  -- Paid access (existing helper)
  SELECT public.user_has_access() INTO has_paid;

  -- Whitelist
  SELECT current_user_is_whitelisted.is_whitelisted 
  FROM public.current_user_is_whitelisted 
  INTO is_whitelisted;

  IF has_paid OR is_whitelisted THEN
    RETURN QUERY SELECT true, 'entitled', NULL::integer;
    RETURN;
  END IF;

  -- Ticket Creator & Filterizer are never free
  IF feature_key NOT IN ('gemini_analysis', 'bet_optimizer') THEN
    RETURN QUERY SELECT false, 'paywalled_feature', NULL::integer;
    RETURN;
  END IF;

  -- Ensure row exists
  PERFORM public.ensure_trial_row();

  -- Lock row and check credits
  SELECT remaining_uses
  INTO cur_remaining
  FROM public.user_trial_credits
  WHERE user_id = auth.uid()
  FOR UPDATE;

  IF cur_remaining IS NULL THEN
    cur_remaining := 0;
  END IF;

  IF cur_remaining <= 0 THEN
    RETURN QUERY SELECT false, 'no_trial_credits', 0;
    RETURN;
  END IF;

  -- Decrement one shared credit
  UPDATE public.user_trial_credits
  SET remaining_uses = remaining_uses - 1,
      updated_at = now()
  WHERE user_id = auth.uid();

  RETURN QUERY
    SELECT true, 'trial', cur_remaining - 1;
END;
$$;

-- Helper to check if current user is whitelisted (for client queries)
CREATE OR REPLACE FUNCTION public.is_user_whitelisted()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result boolean;
BEGIN
  SELECT is_whitelisted 
  FROM public.current_user_is_whitelisted 
  INTO result;
  
  RETURN COALESCE(result, false);
END;
$$;

-- Helper to get current trial credits
CREATE OR REPLACE FUNCTION public.get_trial_credits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  credits int;
BEGIN
  -- Ensure row exists first
  PERFORM public.ensure_trial_row();
  
  SELECT remaining_uses 
  INTO credits
  FROM public.user_trial_credits
  WHERE user_id = auth.uid();
  
  RETURN COALESCE(credits, 5);
END;
$$;