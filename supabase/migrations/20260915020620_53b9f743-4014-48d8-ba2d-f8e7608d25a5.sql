CREATE OR REPLACE FUNCTION public.fixtures_record_schedule_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_kick timestamptz := CASE WHEN OLD.timestamp IS NULL THEN NULL ELSE to_timestamp(OLD.timestamp) END;
  v_new_kick timestamptz := CASE WHEN NEW.timestamp IS NULL THEN NULL ELSE to_timestamp(NEW.timestamp) END;
  -- Malformed stored identifiers must never abort a legitimate write; they are
  -- recorded as unknown (NULL) instead of raising a cast error.
  v_old_home bigint := NULLIF(public.safe_jsonb_id(OLD.teams_home -> 'id'), -1);
  v_new_home bigint := NULLIF(public.safe_jsonb_id(NEW.teams_home -> 'id'), -1);
  v_old_away bigint := NULLIF(public.safe_jsonb_id(OLD.teams_away -> 'id'), -1);
  v_new_away bigint := NULLIF(public.safe_jsonb_id(NEW.teams_away -> 'id'), -1);
  v_kick_changed boolean;
  v_dir_changed boolean;
  v_status_changed boolean;
BEGIN
  v_kick_changed := v_old_kick IS DISTINCT FROM v_new_kick;
  v_dir_changed := (v_old_home IS DISTINCT FROM v_new_home) OR (v_old_away IS DISTINCT FROM v_new_away);
  v_status_changed := OLD.status IS DISTINCT FROM NEW.status;

  IF NOT (v_kick_changed OR v_dir_changed OR v_status_changed) THEN
    RETURN NEW;
  END IF;

  IF v_kick_changed THEN
    IF NEW.original_kickoff_at IS NULL AND OLD.original_kickoff_at IS NULL THEN
      NEW.original_kickoff_at := v_old_kick;
    END IF;
    NEW.last_rescheduled_at := now();
  END IF;

  INSERT INTO public.fixture_schedule_changes (
    fixture_id, previous_kickoff_at, new_kickoff_at,
    previous_status, new_status,
    previous_home_team_id, new_home_team_id,
    previous_away_team_id, new_away_team_id,
    kickoff_delta_seconds, direction_swapped, source
  ) VALUES (
    NEW.id, v_old_kick, v_new_kick,
    OLD.status, NEW.status,
    v_old_home, v_new_home,
    v_old_away, v_new_away,
    CASE WHEN v_old_kick IS NULL OR v_new_kick IS NULL THEN NULL
         ELSE EXTRACT(epoch FROM (v_new_kick - v_old_kick))::bigint END,
    (v_old_home IS NOT NULL AND v_new_away IS NOT NULL AND v_old_home = v_new_away
      AND v_old_away IS NOT NULL AND v_new_home IS NOT NULL AND v_old_away = v_new_home),
    'fixtures_trigger'
  );

  RETURN NEW;
END;
$function$;