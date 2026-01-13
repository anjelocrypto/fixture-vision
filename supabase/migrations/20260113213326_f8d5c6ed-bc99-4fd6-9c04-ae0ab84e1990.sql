-- ============================================================================
-- Prediction Markets: Atomic Resolution RPC + Close Expired RPC
-- FIXED: Security, column names, JSONB, action types
-- ============================================================================

-- =============================================================================
-- 1) resolve_market RPC - SECURITY DEFINER, service_role only
-- =============================================================================
CREATE OR REPLACE FUNCTION public.resolve_market(
  _market_id UUID,
  _winning_outcome TEXT,  -- 'yes', 'no', or NULL for void/refund
  _admin_user_id UUID DEFAULT NULL,
  _is_system BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market RECORD;
  v_position RECORD;
  v_new_status TEXT;
  v_payout NUMERIC;
  v_won_count INT := 0;
  v_lost_count INT := 0;
  v_refunded_count INT := 0;
  v_total_payout NUMERIC := 0;
  v_action TEXT;
BEGIN
  -- Validate winning_outcome
  IF _winning_outcome IS NOT NULL AND _winning_outcome NOT IN ('yes', 'no') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'winning_outcome must be yes, no, or null (void)');
  END IF;

  -- Lock and fetch market
  SELECT * INTO v_market
  FROM prediction_markets
  WHERE id = _market_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Market not found');
  END IF;

  IF v_market.status = 'resolved' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Market already resolved');
  END IF;

  -- Determine action for audit log
  IF _winning_outcome IS NULL THEN
    v_action := 'void';
  ELSIF _is_system THEN
    v_action := 'auto_resolve';
  ELSE
    v_action := 'manual_resolve';
  END IF;

  -- Process all pending positions
  FOR v_position IN
    SELECT mp.*, mc.balance AS current_balance, mc.total_won AS current_total_won
    FROM market_positions mp
    JOIN market_coins mc ON mc.user_id = mp.user_id
    WHERE mp.market_id = _market_id AND mp.status = 'pending'
    FOR UPDATE OF mp, mc
  LOOP
    IF _winning_outcome IS NULL THEN
      -- Void/refund: return full stake
      v_new_status := 'refunded';
      v_payout := v_position.stake;
      v_refunded_count := v_refunded_count + 1;
    ELSIF v_position.outcome = _winning_outcome THEN
      -- Winner: pay potential_payout
      v_new_status := 'won';
      v_payout := v_position.potential_payout;
      v_won_count := v_won_count + 1;
    ELSE
      -- Loser: no payout
      v_new_status := 'lost';
      v_payout := 0;
      v_lost_count := v_lost_count + 1;
    END IF;

    v_total_payout := v_total_payout + v_payout;

    -- Update position with correct column names
    UPDATE market_positions
    SET status = v_new_status,
        payout_amount = v_payout,
        settled_at = NOW()
    WHERE id = v_position.id;

    -- Credit balance for winners/refunds
    IF v_payout > 0 THEN
      UPDATE market_coins
      SET balance = balance + v_payout,
          total_won = total_won + CASE WHEN v_new_status = 'won' THEN v_payout ELSE 0 END
      WHERE user_id = v_position.user_id;
    END IF;
  END LOOP;

  -- Update market status
  UPDATE prediction_markets
  SET status = 'resolved',
      winning_outcome = _winning_outcome,
      resolved_at = NOW()
  WHERE id = _market_id;

  -- Insert audit log with JSONB directly (no cast)
  INSERT INTO admin_market_audit_log (
    admin_user_id,
    market_id,
    action,
    details,
    is_system
  ) VALUES (
    _admin_user_id,
    _market_id,
    v_action,
    jsonb_build_object(
      'winning_outcome', _winning_outcome,
      'positions_won', v_won_count,
      'positions_lost', v_lost_count,
      'positions_refunded', v_refunded_count,
      'total_payout', v_total_payout
    ),
    _is_system
  );

  RETURN jsonb_build_object(
    'ok', true,
    'market_id', _market_id,
    'winning_outcome', _winning_outcome,
    'positions_won', v_won_count,
    'positions_lost', v_lost_count,
    'positions_refunded', v_refunded_count,
    'total_payout', v_total_payout
  );
END;
$$;

-- CRITICAL: Grant only to service_role (Edge Functions use service role key)
REVOKE ALL ON FUNCTION public.resolve_market(UUID, TEXT, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_market(UUID, TEXT, UUID, BOOLEAN) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_market(UUID, TEXT, UUID, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_market(UUID, TEXT, UUID, BOOLEAN) TO service_role;

-- =============================================================================
-- 2) close_expired_markets RPC - auto-close markets past closes_at
-- =============================================================================
CREATE OR REPLACE FUNCTION public.close_expired_markets()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed_count INT := 0;
  v_market_id UUID;
BEGIN
  FOR v_market_id IN
    SELECT id FROM prediction_markets
    WHERE status = 'open' AND closes_at < NOW()
    FOR UPDATE
  LOOP
    UPDATE prediction_markets
    SET status = 'closed'
    WHERE id = v_market_id;

    -- Audit log for close_expired with is_system=true
    INSERT INTO admin_market_audit_log (
      admin_user_id,
      market_id,
      action,
      details,
      is_system
    ) VALUES (
      NULL,
      v_market_id,
      'close_expired',
      jsonb_build_object('reason', 'Market closed automatically after closes_at'),
      true
    );

    v_closed_count := v_closed_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'closed_count', v_closed_count);
END;
$$;

-- Grant only to service_role (cron Edge Functions)
REVOKE ALL ON FUNCTION public.close_expired_markets() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_expired_markets() FROM anon;
REVOKE ALL ON FUNCTION public.close_expired_markets() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.close_expired_markets() TO service_role;