-- Safe leaderboard fix: Allow authenticated users to view all balances
-- This enables Top 10 traders to work for logged-in users
-- Does NOT expose to anon/public (prevents scraping)

CREATE POLICY "Authenticated users can view all balances for leaderboard"
ON market_coins
FOR SELECT
TO authenticated
USING (true);

-- Verify the policy was created
SELECT policyname, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'market_coins';