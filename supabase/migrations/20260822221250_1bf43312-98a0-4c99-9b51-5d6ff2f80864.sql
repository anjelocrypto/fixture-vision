CREATE OR REPLACE FUNCTION public.persist_generated_ticket(p_user_id uuid, p_ticket jsonb, p_optimizer_cache_rows jsonb, p_leg_outcomes jsonb, p_ticket_outcome jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    derived_from_selection, model_prob,
    home_team_id_snapshot, away_team_id_snapshot, settlement_policy_version
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
    row_data.model_prob,
    row_data.home_team_id_snapshot,
    row_data.away_team_id_snapshot,
    COALESCE(row_data.settlement_policy_version, 'reschedule-integrity-v1')
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
    model_prob numeric,
    home_team_id_snapshot bigint,
    away_team_id_snapshot bigint,
    settlement_policy_version text
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
$function$;