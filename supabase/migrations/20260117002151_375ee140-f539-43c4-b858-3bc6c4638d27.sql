-- Step 1: Add username column (nullable for backfill)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS username text;

-- Step 2: Backfill from display_name ONLY if:
-- - valid format
-- - unique among display_name values
UPDATE public.profiles p
SET username = p.display_name
WHERE p.username IS NULL
  AND p.display_name IS NOT NULL
  AND p.display_name ~ '^[a-zA-Z0-9_]{3,20}$'
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p2
    WHERE p2.display_name = p.display_name
      AND p2.user_id != p.user_id
  );

-- Step 3: Fill remaining nulls with generated unique usernames
UPDATE public.profiles
SET username = 'player_' || left(user_id::text, 8)
WHERE username IS NULL;

-- Step 4: Enforce constraints
ALTER TABLE public.profiles 
ALTER COLUMN username SET NOT NULL;

ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_username_unique UNIQUE (username);

ALTER TABLE public.profiles 
ADD CONSTRAINT username_format_check 
CHECK (username ~ '^[a-zA-Z0-9_]{3,20}$');

-- Step 5: Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);

-- Step 6: Update the leaderboard view to use username
CREATE OR REPLACE VIEW public.v_market_leaderboard
WITH (security_invoker = true)
AS
SELECT 
    mc.user_id,
    COALESCE(p.username, 'player_' || left(mc.user_id::text, 8)) AS display_name,
    mc.balance,
    mc.total_wagered,
    mc.total_won,
    mc.total_fees_paid,
    count(mp.id) FILTER (WHERE mp.status = ANY (ARRAY['won'::text, 'lost'::text])) AS positions_count,
    count(mp.id) FILTER (WHERE mp.status = 'won'::text) AS wins_count,
    count(mp.id) FILTER (WHERE mp.status = 'lost'::text) AS losses_count,
    CASE
        WHEN count(mp.id) FILTER (WHERE mp.status = ANY (ARRAY['won'::text, 'lost'::text])) > 0 
        THEN round(count(mp.id) FILTER (WHERE mp.status = 'won'::text)::numeric / count(mp.id) FILTER (WHERE mp.status = ANY (ARRAY['won'::text, 'lost'::text]))::numeric * 100::numeric, 1)
        ELSE 0::numeric
    END AS win_rate,
    CASE
        WHEN mc.total_wagered > 0 
        THEN round((mc.total_won - mc.total_wagered)::numeric / mc.total_wagered::numeric * 100::numeric, 1)
        ELSE 0::numeric
    END AS roi,
    rank() OVER (ORDER BY mc.balance DESC) AS rank
FROM market_coins mc
LEFT JOIN profiles p ON p.user_id = mc.user_id
LEFT JOIN market_positions mp ON mp.user_id = mc.user_id
GROUP BY mc.user_id, p.username, mc.balance, mc.total_wagered, mc.total_won, mc.total_fees_paid;

-- Verify
SELECT 
    COUNT(*) as total_profiles,
    COUNT(username) as with_username,
    COUNT(CASE WHEN username LIKE 'player_%' THEN 1 END) as generated_usernames
FROM public.profiles;