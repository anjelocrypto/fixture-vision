-- 1) DROP existing function to allow recreation with correct signature
DROP FUNCTION IF EXISTS place_market_bet(uuid, text, integer);

-- 2) FIX RACE CONDITION: Recreate place_market_bet with resolved market check
CREATE FUNCTION place_market_bet(
  _market_id uuid,
  _outcome text,
  _stake integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_market record;
  v_balance integer;
  v_fee integer;
  v_net_stake integer;
  v_odds numeric;
  v_potential_payout integer;
  v_position_id uuid;
  v_new_balance integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authenticated');
  END IF;

  -- Lock market row and validate
  SELECT id, status, odds_yes, odds_no, closes_at, winning_outcome
  INTO v_market
  FROM prediction_markets
  WHERE id = _market_id
  FOR UPDATE;

  IF v_market IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Market not found');
  END IF;

  -- CRITICAL: Block if market not open
  IF v_market.status != 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Market is not open for betting');
  END IF;

  -- CRITICAL: Block if already resolved (race condition fix)
  IF v_market.winning_outcome IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Market has already been resolved');
  END IF;

  -- CRITICAL: Block if past closing time
  IF v_market.closes_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Market has closed');
  END IF;

  -- Validate outcome
  IF _outcome NOT IN ('yes', 'no') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid outcome');
  END IF;

  -- Validate stake
  IF _stake < 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Minimum stake is 10 coins');
  END IF;

  -- Get or create user coins row
  INSERT INTO market_coins (user_id, balance, total_wagered, total_fees_paid)
  VALUES (v_user_id, 1000, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance INTO v_balance
  FROM market_coins
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF v_balance < _stake THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Insufficient balance');
  END IF;

  -- Calculate fee (2%, min 1 coin)
  v_fee := GREATEST(1, FLOOR(_stake * 0.02));
  v_net_stake := _stake - v_fee;

  -- Get odds for selected outcome
  v_odds := CASE WHEN _outcome = 'yes' THEN v_market.odds_yes ELSE v_market.odds_no END;
  v_potential_payout := FLOOR(v_net_stake * v_odds);

  -- Deduct from balance
  UPDATE market_coins
  SET 
    balance = balance - _stake,
    total_wagered = total_wagered + v_net_stake,
    total_fees_paid = total_fees_paid + v_fee
  WHERE user_id = v_user_id
  RETURNING balance INTO v_new_balance;

  -- Insert position (with duplicate handling)
  INSERT INTO market_positions (
    user_id, market_id, outcome, stake, fee_amount, net_stake, 
    odds_at_placement, potential_payout, status
  )
  VALUES (
    v_user_id, _market_id, _outcome, _stake, v_fee, v_net_stake,
    v_odds, v_potential_payout, 'pending'
  )
  RETURNING id INTO v_position_id;

  -- Update market totals (display only)
  UPDATE prediction_markets
  SET 
    total_staked_yes = total_staked_yes + CASE WHEN _outcome = 'yes' THEN v_net_stake ELSE 0 END,
    total_staked_no = total_staked_no + CASE WHEN _outcome = 'no' THEN v_net_stake ELSE 0 END
  WHERE id = _market_id;

  RETURN jsonb_build_object(
    'ok', true,
    'position_id', v_position_id,
    'stake', _stake,
    'fee', v_fee,
    'net_stake', v_net_stake,
    'odds', v_odds,
    'potential_payout', v_potential_payout,
    'new_balance', v_new_balance
  );

EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'You already have a position on this market');
END;
$$;

-- 3) Grant permissions
GRANT EXECUTE ON FUNCTION place_market_bet(uuid, text, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION place_market_bet(uuid, text, integer) FROM anon, public;