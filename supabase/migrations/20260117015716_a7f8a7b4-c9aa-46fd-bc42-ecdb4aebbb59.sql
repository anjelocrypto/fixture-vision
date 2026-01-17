-- Fix the handle_new_user trigger to include a default username
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, preferred_lang, username)
  VALUES (
    NEW.id, 
    'en', 
    'player_' || LEFT(NEW.id::text, 8)
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;