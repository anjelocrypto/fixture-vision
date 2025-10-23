
-- Function to backfill optimized selections
CREATE OR REPLACE FUNCTION backfill_optimized_selections()
RETURNS TABLE (
  scanned INT,
  inserted INT,
  skipped INT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scanned INT := 0;
  v_inserted INT := 0;
  v_skipped INT := 0;
  v_fixture RECORD;
  v_home_stats RECORD;
  v_away_stats RECORD;
  v_odds_data RECORD;
  v_combined_goals NUMERIC;
  v_combined_corners NUMERIC;
  v_combined_cards NUMERIC;
  v_combined_fouls NUMERIC;
  v_combined_offsides NUMERIC;
  v_sample_size INT;
  v_best_odds NUMERIC;
  v_best_bookmaker TEXT;
  v_utc_kickoff TIMESTAMPTZ;
BEGIN
  -- Loop through upcoming fixtures (next 7 days)
  FOR v_fixture IN 
    SELECT * FROM fixtures 
    WHERE timestamp >= EXTRACT(EPOCH FROM NOW())
      AND timestamp <= EXTRACT(EPOCH FROM (NOW() + INTERVAL '7 days'))
  LOOP
    v_scanned := v_scanned + 1;
    
    -- Get home team stats
    SELECT * INTO v_home_stats 
    FROM stats_cache 
    WHERE team_id = (v_fixture.teams_home->>'id')::INT
    LIMIT 1;
    
    -- Get away team stats
    SELECT * INTO v_away_stats 
    FROM stats_cache 
    WHERE team_id = (v_fixture.teams_away->>'id')::INT
    LIMIT 1;
    
    -- Skip if no stats
    IF v_home_stats IS NULL OR v_away_stats IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    
    -- Calculate combined stats
    v_combined_goals := v_home_stats.goals + v_away_stats.goals;
    v_combined_corners := v_home_stats.corners + v_away_stats.corners;
    v_combined_cards := v_home_stats.cards + v_away_stats.cards;
    v_combined_fouls := v_home_stats.fouls + v_away_stats.fouls;
    v_combined_offsides := v_home_stats.offsides + v_away_stats.offsides;
    v_sample_size := LEAST(v_home_stats.sample_size, v_away_stats.sample_size);
    v_utc_kickoff := to_timestamp(v_fixture.timestamp);
    
    -- Get odds data
    SELECT * INTO v_odds_data 
    FROM odds_cache 
    WHERE fixture_id = v_fixture.id
    LIMIT 1;
    
    -- Skip if no odds
    IF v_odds_data IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    
    -- For now, insert a simple Goals Over 2.5 selection with dummy odds
    -- (Full implementation would parse odds_data.payload and apply all rules)
    IF v_combined_goals >= 4.0 THEN
      INSERT INTO optimized_selections (
        fixture_id, league_id, country_code, utc_kickoff,
        market, side, line, bookmaker, odds, is_live,
        edge_pct, model_prob, sample_size, combined_snapshot,
        rules_version, source, computed_at
      ) VALUES (
        v_fixture.id,
        v_fixture.league_id,
        NULL, -- country_code to be joined later
        v_utc_kickoff,
        'goals',
        'over',
        2.5,
        'bet365', -- placeholder
        1.80, -- placeholder odds
        FALSE,
        5.0, -- placeholder edge
        0.60, -- placeholder model_prob
        v_sample_size,
        jsonb_build_object(
          'goals', v_combined_goals,
          'corners', v_combined_corners,
          'cards', v_combined_cards,
          'fouls', v_combined_fouls,
          'offsides', v_combined_offsides
        ),
        'v1.0-sql',
        'api-football',
        NOW()
      )
      ON CONFLICT (fixture_id, market, side, line, bookmaker, is_live) 
      DO UPDATE SET
        odds = EXCLUDED.odds,
        computed_at = EXCLUDED.computed_at;
      
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_scanned, v_inserted, v_skipped;
END;
$$;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION backfill_optimized_selections() TO service_role;

-- Run the backfill immediately
SELECT * FROM backfill_optimized_selections();
