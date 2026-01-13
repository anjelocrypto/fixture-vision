-- ============================================================================
-- Fix #1: Audit log action constraint - include ALL legacy + new actions
-- ============================================================================
ALTER TABLE public.admin_market_audit_log
DROP CONSTRAINT IF EXISTS admin_market_audit_log_action_check;

ALTER TABLE public.admin_market_audit_log
ADD CONSTRAINT admin_market_audit_log_action_check
CHECK (action IN (
  'create','update','publish','close','resolve','cancel','delete',
  'auto_resolve','close_expired','manual_resolve','refund','void'
));

-- Make admin_user_id nullable for system actions
ALTER TABLE public.admin_market_audit_log
ALTER COLUMN admin_user_id DROP NOT NULL;

-- Add is_system flag for automated actions
ALTER TABLE public.admin_market_audit_log
ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- ============================================================================
-- Fix #3: Add resolution_rule column for auto-resolve logic
-- ============================================================================
ALTER TABLE public.prediction_markets
ADD COLUMN IF NOT EXISTS resolution_rule TEXT;

-- Make winning_outcome nullable (for void/refund cases where there's no winner)
ALTER TABLE public.prediction_markets
ALTER COLUMN winning_outcome DROP NOT NULL;

-- ============================================================================
-- Fix #2: Atomic bet placement RPC with duplicate handling
-- Uses fixed odds (no recalculation), proper locking, exception handling
-- ============================================================================
CREATE OR REPLACE FUNCTION public.place_market_bet(
  _market_id UUID,
  _outcome TEXT,
  _stake INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_market RECORD;
  v_balance INTEGER;
  v_fee INTEGER;
  v_net_stake INTEGER;
  v_odds NUMERIC;
  v_potential_payout INTEGER;
  v_position_id UUID;
  v_new_balance INTEGER;
BEGIN
  -- Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Authentication required');
  END IF;

  -- Validate outcome
  IF _outcome NOT IN ('yes', 'no') THEN
    RETURN json_build_object('ok', false, 'error', 'Outcome must be yes or no');
  END IF;

  -- Validate stake (minimum 10)
  IF _stake < 10 THEN
    RETURN json_build_object('ok', false, 'error', 'Minimum stake is 10 coins');
  END IF;

  -- Lock and fetch market
  SELECT * INTO v_market
  FROM prediction_markets
  WHERE id = _market_id
  FOR UPDATE;

  IF v_market IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Market not found');
  END IF;

  IF v_market.status <> 'open' THEN
    RETURN json_build_object('ok', false, 'error', 'Market is not open for betting');
  END IF;

  IF v_market.closes_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'error', 'Market has closed');
  END IF;

  -- Ensure user has coins row (upsert)
  INSERT INTO market_coins (user_id, balance, total_wagered, total_fees_paid)
  VALUES (v_user_id, 1000, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Lock and fetch user balance
  SELECT balance INTO v_balance
  FROM market_coins
  WHERE user_id = v_user_id
  FOR UPDATE;

  -- Calculate fee (2%, minimum 1 coin)
  v_fee := GREATEST(1, FLOOR(_stake * 0.02));
  v_net_stake := _stake - v_fee;

  -- Check balance
  IF v_balance < _stake THEN
    RETURN json_build_object('ok', false, 'error', 
      format('Insufficient balance. Need %s, have %s', _stake, v_balance));
  END IF;

  -- Get FIXED odds (no recalculation!)
  v_odds := CASE WHEN _outcome = 'yes' THEN v_market.odds_yes ELSE v_market.odds_no END;
  v_potential_payout := FLOOR(v_net_stake * v_odds);

  -- Deduct from user balance atomically
  UPDATE market_coins
  SET 
    balance = balance - _stake,
    total_wagered = total_wagered + _stake,
    total_fees_paid = total_fees_paid + v_fee
  WHERE user_id = v_user_id;

  v_new_balance := v_balance - _stake;

  -- Insert position (with duplicate handling)
  BEGIN
    INSERT INTO market_positions (
      user_id, market_id, outcome, stake, fee_amount, net_stake,
      odds_at_placement, potential_payout, status
    ) VALUES (
      v_user_id, _market_id, _outcome, _stake, v_fee, v_net_stake,
      v_odds, v_potential_payout, 'pending'
    )
    RETURNING id INTO v_position_id;
  EXCEPTION WHEN unique_violation THEN
    -- Rollback balance deduction
    UPDATE market_coins
    SET 
      balance = balance + _stake,
      total_wagered = total_wagered - _stake,
      total_fees_paid = total_fees_paid - v_fee
    WHERE user_id = v_user_id;
    
    RETURN json_build_object('ok', false, 'error', 'You already placed a bet on this market');
  END;

  -- Update market totals (for UI display only, NOT odds)
  UPDATE prediction_markets
  SET 
    total_staked_yes = total_staked_yes + CASE WHEN _outcome = 'yes' THEN v_net_stake ELSE 0 END,
    total_staked_no = total_staked_no + CASE WHEN _outcome = 'no' THEN v_net_stake ELSE 0 END
  WHERE id = _market_id;

  RETURN json_build_object(
    'ok', true,
    'position_id', v_position_id,
    'stake', _stake,
    'fee', v_fee,
    'net_stake', v_net_stake,
    'odds', v_odds,
    'potential_payout', v_potential_payout,
    'new_balance', v_new_balance
  );
END;
$$;

-- Grant execute to authenticated users only
REVOKE ALL ON FUNCTION public.place_market_bet(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.place_market_bet(UUID, TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.place_market_bet(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_market_bet(UUID, TEXT, INTEGER) TO service_role;