-- Create RPC function to get auto-fill odds for market templates
-- Uses odds_cache data with proper binary conversion for 1X2 markets

CREATE OR REPLACE FUNCTION public.get_market_template_odds(
  _fixture_id BIGINT,
  _resolution_rule TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload JSONB;
  v_bookmakers JSONB;
  v_bookmaker_name TEXT;
  v_bets JSONB;
  v_bet JSONB;
  v_values JSONB;
  v_value JSONB;
  v_bet_id INT;
  v_target_bet_id INT;
  v_target_value_yes TEXT;
  v_target_value_no TEXT;
  v_odds_yes NUMERIC := NULL;  -- Start NULL, set defaults at end
  v_odds_no NUMERIC := NULL;   -- Start NULL, set defaults at end
  v_found_bookmaker TEXT := NULL;
  v_line TEXT;
  v_home_odds NUMERIC;
  v_draw_odds NUMERIC;
  v_away_odds NUMERIC;
  v_p_home NUMERIC;
  v_p_draw NUMERIC;
  v_p_away NUMERIC;
  v_total_prob NUMERIC;
  v_p_yes NUMERIC;
  v_p_no NUMERIC;
BEGIN
  -- Admin check: only admins can call this
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  -- Fetch latest cached odds for fixture
  SELECT payload INTO v_payload
  FROM odds_cache
  WHERE fixture_id = _fixture_id
  ORDER BY captured_at DESC
  LIMIT 1;

  -- If no cache, return defaults immediately
  IF v_payload IS NULL THEN
    RETURN jsonb_build_object(
      'odds_yes', 1.80,
      'odds_no', 2.00,
      'source', 'default',
      'bookmaker', 'none'
    );
  END IF;

  -- Determine target bet_id and values based on resolution_rule
  -- Over/Under goals: bet_id = 5
  -- BTTS: bet_id = 8
  -- Match Winner: bet_id = 1
  
  IF _resolution_rule LIKE 'over_%_goals' THEN
    v_target_bet_id := 5;
    v_line := REPLACE(REPLACE(_resolution_rule, 'over_', ''), '_goals', '');
    v_target_value_yes := 'Over ' || REPLACE(v_line, '_', '.');
    v_target_value_no := 'Under ' || REPLACE(v_line, '_', '.');
    
  ELSIF _resolution_rule LIKE 'under_%_goals' THEN
    v_target_bet_id := 5;
    v_line := REPLACE(REPLACE(_resolution_rule, 'under_', ''), '_goals', '');
    v_target_value_yes := 'Under ' || REPLACE(v_line, '_', '.');
    v_target_value_no := 'Over ' || REPLACE(v_line, '_', '.');
    
  ELSIF _resolution_rule = 'btts' THEN
    v_target_bet_id := 8;
    v_target_value_yes := 'Yes';
    v_target_value_no := 'No';
    
  ELSIF _resolution_rule IN ('home_win', 'draw', 'away_win') THEN
    v_target_bet_id := 1;
    -- Will handle 1X2 separately with probability conversion
    
  ELSE
    -- Unknown rule, return defaults
    RETURN jsonb_build_object(
      'odds_yes', 1.80,
      'odds_no', 2.00,
      'source', 'default',
      'bookmaker', 'none'
    );
  END IF;

  -- Parse bookmakers from payload
  v_bookmakers := v_payload->'bookmakers';
  
  IF v_bookmakers IS NULL OR jsonb_array_length(v_bookmakers) = 0 THEN
    RETURN jsonb_build_object(
      'odds_yes', 1.80,
      'odds_no', 2.00,
      'source', 'default',
      'bookmaker', 'none'
    );
  END IF;

  -- Iterate through bookmakers to find matching odds
  FOR i IN 0..jsonb_array_length(v_bookmakers) - 1 LOOP
    v_bookmaker_name := v_bookmakers->i->>'name';
    v_bets := v_bookmakers->i->'bets';
    
    IF v_bets IS NULL THEN
      CONTINUE;
    END IF;
    
    -- Iterate through bets
    FOR j IN 0..jsonb_array_length(v_bets) - 1 LOOP
      v_bet := v_bets->j;
      v_bet_id := (v_bet->>'id')::INT;
      
      IF v_bet_id = v_target_bet_id THEN
        v_values := v_bet->'values';
        
        IF v_values IS NULL THEN
          CONTINUE;
        END IF;

        -- Handle Match Winner (1X2) with probability conversion
        IF _resolution_rule IN ('home_win', 'draw', 'away_win') THEN
          v_home_odds := NULL;
          v_draw_odds := NULL;
          v_away_odds := NULL;
          
          -- Extract all three outcomes
          FOR k IN 0..jsonb_array_length(v_values) - 1 LOOP
            v_value := v_values->k;
            IF v_value->>'value' = 'Home' THEN
              v_home_odds := (v_value->>'odd')::NUMERIC;
            ELSIF v_value->>'value' = 'Draw' THEN
              v_draw_odds := (v_value->>'odd')::NUMERIC;
            ELSIF v_value->>'value' = 'Away' THEN
              v_away_odds := (v_value->>'odd')::NUMERIC;
            END IF;
          END LOOP;
          
          -- Calculate implied probabilities if we have all three
          IF v_home_odds IS NOT NULL AND v_draw_odds IS NOT NULL AND v_away_odds IS NOT NULL 
             AND v_home_odds > 0 AND v_draw_odds > 0 AND v_away_odds > 0 THEN
            v_p_home := 1.0 / v_home_odds;
            v_p_draw := 1.0 / v_draw_odds;
            v_p_away := 1.0 / v_away_odds;
            
            -- Normalize to remove overround
            v_total_prob := v_p_home + v_p_draw + v_p_away;
            v_p_home := v_p_home / v_total_prob;
            v_p_draw := v_p_draw / v_total_prob;
            v_p_away := v_p_away / v_total_prob;
            
            -- Calculate YES/NO based on rule
            IF _resolution_rule = 'home_win' THEN
              v_p_yes := v_p_home;
              v_p_no := v_p_draw + v_p_away;
            ELSIF _resolution_rule = 'draw' THEN
              v_p_yes := v_p_draw;
              v_p_no := v_p_home + v_p_away;
            ELSE -- away_win
              v_p_yes := v_p_away;
              v_p_no := v_p_home + v_p_draw;
            END IF;
            
            -- Convert back to odds (with small margin protection)
            IF v_p_yes > 0.01 THEN
              v_odds_yes := ROUND(1.0 / v_p_yes, 2);
            END IF;
            IF v_p_no > 0.01 THEN
              v_odds_no := ROUND(1.0 / v_p_no, 2);
            END IF;
            v_found_bookmaker := v_bookmaker_name;
            EXIT; -- Found odds, exit bet loop
          END IF;
          
        ELSE
          -- Handle binary markets (Over/Under, BTTS)
          FOR k IN 0..jsonb_array_length(v_values) - 1 LOOP
            v_value := v_values->k;
            IF v_value->>'value' = v_target_value_yes THEN
              v_odds_yes := (v_value->>'odd')::NUMERIC;
            ELSIF v_value->>'value' = v_target_value_no THEN
              v_odds_no := (v_value->>'odd')::NUMERIC;
            END IF;
          END LOOP;
          
          IF v_odds_yes IS NOT NULL AND v_odds_no IS NOT NULL THEN
            v_found_bookmaker := v_bookmaker_name;
            EXIT; -- Found both odds, exit bet loop
          END IF;
        END IF;
      END IF;
    END LOOP;
    
    -- Exit bookmaker loop if found
    IF v_odds_yes IS NOT NULL AND v_odds_no IS NOT NULL THEN
      EXIT;
    END IF;
  END LOOP;

  -- Final check: if odds still NULL, use defaults
  IF v_odds_yes IS NULL OR v_odds_no IS NULL THEN
    RETURN jsonb_build_object(
      'odds_yes', 1.80,
      'odds_no', 2.00,
      'source', 'default',
      'bookmaker', 'none'
    );
  END IF;

  -- Return found odds
  RETURN jsonb_build_object(
    'odds_yes', v_odds_yes,
    'odds_no', v_odds_no,
    'source', 'api_football',
    'bookmaker', COALESCE(v_found_bookmaker, 'unknown')
  );
END;
$$;

-- Security hardening: revoke from PUBLIC/anon, grant only to authenticated
REVOKE ALL ON FUNCTION public.get_market_template_odds(BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_market_template_odds(BIGINT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_market_template_odds(BIGINT, TEXT) TO authenticated;