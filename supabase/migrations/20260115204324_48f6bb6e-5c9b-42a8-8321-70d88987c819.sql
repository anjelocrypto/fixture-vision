-- 1) UNIQUE INDEX (safe - no duplicates exist)
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_positions_user_market 
ON market_positions (user_id, market_id);

-- 2) EXPLICIT RLS POLICY for anyone to view markets
ALTER TABLE prediction_markets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view markets" ON prediction_markets;

CREATE POLICY "Anyone can view markets"
ON prediction_markets
FOR SELECT
TO anon, authenticated
USING (status IN ('open', 'closed', 'resolved'));

-- 3) IDEMPOTENT orphan settlement + credit (CTE ensures no double-pay)
WITH settled AS (
  UPDATE market_positions mp
  SET 
    status = CASE 
      WHEN mp.outcome = pm.winning_outcome THEN 'won'
      ELSE 'lost'
    END,
    payout_amount = CASE 
      WHEN mp.outcome = pm.winning_outcome THEN mp.potential_payout
      ELSE 0
    END,
    settled_at = now()
  FROM prediction_markets pm
  WHERE mp.market_id = pm.id
    AND mp.status = 'pending'
    AND pm.winning_outcome IS NOT NULL
    AND pm.resolved_at IS NOT NULL
    AND mp.created_at > pm.resolved_at
  RETURNING mp.user_id, mp.payout_amount
)
UPDATE market_coins mc
SET balance = balance + subq.total_payout
FROM (
  SELECT user_id, SUM(payout_amount) AS total_payout
  FROM settled
  WHERE payout_amount > 0
  GROUP BY user_id
) subq
WHERE mc.user_id = subq.user_id;