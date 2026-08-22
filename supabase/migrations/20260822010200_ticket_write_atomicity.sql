BEGIN;

-- Persist every user-visible ticket and its learning/outcome rows in one
-- transaction. Any validation or insert error aborts the whole RPC.
CREATE OR REPLACE FUNCTION public.persist_generated_ticket(
  p_user_id uuid,
  p_ticket jsonb,
  p_optimizer_cache_rows jsonb,
  p_leg_outcomes jsonb,
  p_ticket_outcome jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket_id uuid;
  v_leg_count integer;
  v_inserted_legs integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF p_user_id IS NULL OR jsonb_typeof(p_ticket) <> 'object'
     OR jsonb_typeof(p_leg_outcomes) <> 'array'
     OR jsonb_array_length(p_leg_outcomes) < 1 THEN
    RAISE EXCEPTION 'invalid ticket persistence payload';
  END IF;

  v_leg_count := jsonb_array_length(p_leg_outcomes);
  IF jsonb_array_length(COALESCE(p_ticket->'legs', '[]'::jsonb)) <> v_leg_count THEN
    RAISE EXCEPTION 'ticket and outcome leg counts differ';
  END IF;

  INSERT INTO public.generated_tickets (
    user_id, total_odds, min_target, max_target, used_live, legs,
    ticket_mode, ticket_model_prob
  )
  VALUES (
    p_user_id,
    (p_ticket->>'total_odds')::numeric,
    (p_ticket->>'min_target')::numeric,
    (p_ticket->>'max_target')::numeric,
    COALESCE((p_ticket->>'used_live')::boolean, false),
    p_ticket->'legs',
    p_ticket->>'ticket_mode',
    (p_ticket->>'ticket_model_prob')::numeric
  )
  RETURNING id INTO v_ticket_id;

  IF jsonb_typeof(COALESCE(p_optimizer_cache_rows, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(COALESCE(p_optimizer_cache_rows, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.optimizer_cache (
      fixture_id, market, side, line, combined_value, bookmaker, odds, source
    )
    SELECT
      row_data.fixture_id, row_data.market, row_data.side, row_data.line,
      row_data.combined_value, row_data.bookmaker, row_data.odds, row_data.source
    FROM jsonb_to_recordset(p_optimizer_cache_rows) AS row_data(
      fixture_id bigint,
      market text,
      side text,
      line numeric,
      combined_value numeric,
      bookmaker text,
      odds numeric,
      source text
    );
  END IF;

  INSERT INTO public.ticket_leg_outcomes (
    ticket_id, user_id, fixture_id, league_id, market, side, line, odds,
    selection_key, selection, source, picked_at, kickoff_at, result_status,
    derived_from_selection, model_prob
  )
  SELECT
    v_ticket_id,
    p_user_id,
    row_data.fixture_id,
    row_data.league_id,
    row_data.market,
    row_data.side,
    row_data.line,
    row_data.odds,
    row_data.selection_key,
    row_data.selection,
    COALESCE(row_data.source, 'prematch'),
    COALESCE(row_data.picked_at, now()),
    row_data.kickoff_at,
    'PENDING',
    COALESCE(row_data.derived_from_selection, false),
    row_data.model_prob
  FROM jsonb_to_recordset(p_leg_outcomes) AS row_data(
    fixture_id bigint,
    league_id integer,
    market text,
    side text,
    line numeric,
    odds numeric,
    selection_key text,
    selection text,
    source text,
    picked_at timestamptz,
    kickoff_at timestamptz,
    derived_from_selection boolean,
    model_prob numeric
  );

  GET DIAGNOSTICS v_inserted_legs = ROW_COUNT;
  IF v_inserted_legs <> v_leg_count THEN
    RAISE EXCEPTION 'expected % leg rows, inserted %', v_leg_count, v_inserted_legs;
  END IF;

  INSERT INTO public.ticket_outcomes (
    ticket_id, user_id, legs_total, legs_settled, legs_won, legs_lost,
    legs_pushed, legs_void, ticket_status, total_odds, ticket_mode,
    ticket_model_prob
  )
  VALUES (
    v_ticket_id,
    p_user_id,
    v_leg_count,
    0, 0, 0, 0, 0,
    'PENDING',
    (p_ticket_outcome->>'total_odds')::numeric,
    p_ticket_outcome->>'ticket_mode',
    (p_ticket_outcome->>'ticket_model_prob')::numeric
  );

  RETURN v_ticket_id;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_generated_ticket(uuid,jsonb,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_generated_ticket(uuid,jsonb,jsonb,jsonb,jsonb)
  TO service_role;

-- The delete and insert now share the RPC transaction. Coverage guards run
-- before deletion, and any insert failure restores the previous rows.
CREATE OR REPLACE FUNCTION public.replace_optimized_selections(
  p_fixture_ids bigint[],
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_selections jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected integer;
  v_inserted integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  IF COALESCE(array_length(p_fixture_ids, 1), 0) = 0
     OR p_window_start IS NULL OR p_window_end <= p_window_start
     OR jsonb_typeof(p_selections) <> 'array' THEN
    RAISE EXCEPTION 'invalid optimized-selection replacement payload';
  END IF;

  v_expected := jsonb_array_length(p_selections);
  IF v_expected < 1 THEN
    RAISE EXCEPTION 'refusing to replace selections with an empty set';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_selections) AS candidate(
      fixture_id bigint, utc_kickoff timestamptz, market text, side text,
      line numeric, odds numeric, is_live boolean
    )
    WHERE candidate.fixture_id <> ALL(p_fixture_ids)
       OR candidate.utc_kickoff < p_window_start
       OR candidate.utc_kickoff > p_window_end
       OR candidate.market NOT IN ('goals', 'corners')
       OR candidate.side <> 'over'
       OR candidate.line <= 0
       OR candidate.is_live IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION 'selection failed replacement scope validation';
  END IF;

  DELETE FROM public.optimized_selections os
  WHERE os.fixture_id = ANY(p_fixture_ids)
    AND os.is_live = false
    AND os.utc_kickoff >= p_window_start
    AND os.utc_kickoff <= p_window_end;

  INSERT INTO public.optimized_selections (
    fixture_id, league_id, country_code, utc_kickoff, market, side, line,
    bookmaker, odds, is_live, edge_pct, model_prob, sample_size,
    combined_snapshot, rules_version, source, computed_at
  )
  SELECT
    row_data.fixture_id, row_data.league_id, row_data.country_code,
    row_data.utc_kickoff, row_data.market, row_data.side, row_data.line,
    row_data.bookmaker, row_data.odds, false, row_data.edge_pct,
    row_data.model_prob, row_data.sample_size, row_data.combined_snapshot,
    row_data.rules_version, COALESCE(row_data.source, 'api-football'),
    COALESCE(row_data.computed_at, now())
  FROM jsonb_to_recordset(p_selections) AS row_data(
    fixture_id bigint,
    league_id integer,
    country_code text,
    utc_kickoff timestamptz,
    market text,
    side text,
    line numeric,
    bookmaker text,
    odds numeric,
    edge_pct numeric,
    model_prob numeric,
    sample_size integer,
    combined_snapshot jsonb,
    rules_version text,
    source text,
    computed_at timestamptz
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted <> v_expected THEN
    RAISE EXCEPTION 'expected % selections, inserted %', v_expected, v_inserted;
  END IF;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_optimized_selections(bigint[],timestamptz,timestamptz,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_optimized_selections(bigint[],timestamptz,timestamptz,jsonb)
  TO service_role;

COMMIT;
