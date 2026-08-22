BEGIN;

ALTER TABLE public.pipeline_alerts
  ADD COLUMN IF NOT EXISTS fingerprint text,
  ADD COLUMN IF NOT EXISTS occurrence_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS pipeline_alerts_open_fingerprint_idx
  ON public.pipeline_alerts (fingerprint)
  WHERE fingerprint IS NOT NULL AND resolved_at IS NULL;

CREATE OR REPLACE FUNCTION public.record_pipeline_alert(
  p_fingerprint text,
  p_alert_type text,
  p_severity text,
  p_message text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF auth.role() <> 'service_role' OR p_fingerprint IS NULL
     OR p_severity NOT IN ('info', 'warning', 'critical') THEN
    RAISE EXCEPTION 'invalid alert request';
  END IF;

  INSERT INTO public.pipeline_alerts (
    fingerprint, alert_type, severity, message, details, last_seen_at
  )
  VALUES (
    p_fingerprint, p_alert_type, p_severity, p_message,
    COALESCE(p_details, '{}'::jsonb), now()
  )
  ON CONFLICT (fingerprint) WHERE fingerprint IS NOT NULL AND resolved_at IS NULL
  DO UPDATE SET
    occurrence_count = public.pipeline_alerts.occurrence_count + 1,
    last_seen_at = now(),
    severity = excluded.severity,
    message = excluded.message,
    details = excluded.details
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_pipeline_alert(p_fingerprint text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  UPDATE public.pipeline_alerts
  SET resolved_at = now(), resolved_by = 'automatic_recovery'
  WHERE fingerprint = p_fingerprint AND resolved_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.record_pipeline_alert(text,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_pipeline_alert(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pipeline_alert(text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_pipeline_alert(text) TO service_role;

COMMIT;
