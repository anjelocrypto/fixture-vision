-- Step 1: Add username_updated_at column with NULL default (not now()!)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS username_updated_at timestamptz;

-- Ensure all existing users can change username immediately
UPDATE public.profiles SET username_updated_at = NULL WHERE username_updated_at IS NOT NULL;

-- Step 2: Create RPC to check username availability (authenticated only)
CREATE OR REPLACE FUNCTION public.check_username_available(p_username text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_username text;
BEGIN
  -- Normalize to lowercase for comparison
  normalized_username := lower(trim(p_username));
  
  -- Validate format
  IF normalized_username !~ '^[a-z0-9_]{3,20}$' THEN
    RETURN false;
  END IF;
  
  -- Check if username exists (case-insensitive)
  RETURN NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE lower(username) = normalized_username
  );
END;
$$;

-- Step 3: Create RPC to update username with 24h cooldown
CREATE OR REPLACE FUNCTION public.update_username(p_new_username text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_username text;
  current_user_id uuid;
  last_update timestamptz;
  hours_remaining int;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  -- Normalize to lowercase
  normalized_username := lower(trim(p_new_username));
  
  -- Validate format
  IF normalized_username !~ '^[a-z0-9_]{3,20}$' THEN
    RETURN json_build_object('success', false, 'error', 'Invalid format: 3-20 chars, letters/numbers/underscore only');
  END IF;
  
  -- Check cooldown (only if username_updated_at is NOT NULL)
  SELECT username_updated_at INTO last_update
  FROM public.profiles
  WHERE user_id = current_user_id;
  
  IF last_update IS NOT NULL AND last_update > now() - interval '24 hours' THEN
    hours_remaining := EXTRACT(EPOCH FROM (last_update + interval '24 hours' - now())) / 3600;
    RETURN json_build_object('success', false, 'error', 'Cooldown active', 'hours_remaining', hours_remaining);
  END IF;
  
  -- Check uniqueness (case-insensitive)
  IF EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE lower(username) = normalized_username 
    AND user_id != current_user_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Username already taken');
  END IF;
  
  -- Update username and set cooldown timestamp
  UPDATE public.profiles
  SET username = normalized_username,
      username_updated_at = now(),
      updated_at = now()
  WHERE user_id = current_user_id;
  
  RETURN json_build_object('success', true, 'username', normalized_username);
END;
$$;

-- Step 4: Create RPC for signup (creates profile with username)
CREATE OR REPLACE FUNCTION public.create_profile_with_username(p_username text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_username text;
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  
  -- Normalize to lowercase
  normalized_username := lower(trim(p_username));
  
  -- Validate format
  IF normalized_username !~ '^[a-z0-9_]{3,20}$' THEN
    RETURN json_build_object('success', false, 'error', 'Invalid format');
  END IF;
  
  -- Check uniqueness
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = normalized_username) THEN
    RETURN json_build_object('success', false, 'error', 'Username already taken');
  END IF;
  
  -- Insert or update profile
  INSERT INTO public.profiles (user_id, username, username_updated_at)
  VALUES (current_user_id, normalized_username, NULL)
  ON CONFLICT (user_id) DO UPDATE
  SET username = normalized_username,
      username_updated_at = NULL,
      updated_at = now();
  
  RETURN json_build_object('success', true, 'username', normalized_username);
END;
$$;

-- Step 5: Grant permissions (authenticated ONLY - no anon!)
GRANT EXECUTE ON FUNCTION public.check_username_available(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_username(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_profile_with_username(text) TO authenticated;

-- Explicitly revoke from anon for safety
REVOKE EXECUTE ON FUNCTION public.check_username_available(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_username(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_profile_with_username(text) FROM anon;