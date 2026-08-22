BEGIN;

ALTER TABLE public.pipeline_alerts
  ADD COLUMN IF NOT EXISTS fingerprint text,
  ADD COLUMN IF NOT EXISTS occurrence_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

-- Preserve the historical evidence while collapsing exact duplicate open
-- alerts. No row is deleted: the newest exact duplicate remains open and the
-- older copies are marked resolved by this migration. This prevents the
-- existing backlog from bypassing the new partial unique index forever.
UPDATE public.pipeline_alerts
SET fingerprint = CASE alert_type
      WHEN 'scorer_stalled' THEN 'pipeline:score-ticket-legs:stalled'
      WHEN 'backfill_stalled' THEN 'pipeline:auto-backfill-results:stalled'
      ELSE 'legacy:' || encode(
        digest(
          concat_ws(
            E'\x1f',
            alert_type,
            severity,
            message,
            COALESCE(details::text, '')
          ),
          'sha256'
        ),
        'hex'
      )
    END,
    last_seen_at = GREATEST(last_seen_at, created_at)
WHERE fingerprint IS NULL;

-- These rows describe completed billing lifecycle actions, not unresolved
-- incidents. Preserve them as resolved history so they do not inflate the
-- operations queue.
UPDATE public.pipeline_alerts
SET resolved_at = COALESCE(resolved_at, last_seen_at),
    resolved_by = COALESCE(resolved_by, 'phase3_non_incident_reclassification')
WHERE resolved_at IS NULL
  AND alert_type IN ('billing_downgrade', 'purchase_restored', 'billing_reconciled');

WITH duplicate_groups AS (
  SELECT
    fingerprint,
    max(id) AS keeper_id,
    sum(occurrence_count)::integer AS total_occurrences,
    max(last_seen_at) AS latest_seen
  FROM public.pipeline_alerts
  WHERE resolved_at IS NULL AND fingerprint IS NOT NULL
  GROUP BY fingerprint
), updated_keepers AS (
  UPDATE public.pipeline_alerts pa
  SET occurrence_count = dg.total_occurrences,
      last_seen_at = dg.latest_seen
  FROM duplicate_groups dg
  WHERE pa.id = dg.keeper_id
  RETURNING pa.id
)
UPDATE public.pipeline_alerts pa
SET resolved_at = now(),
    resolved_by = 'phase3_exact_duplicate_collapse'
FROM duplicate_groups dg
WHERE pa.fingerprint = dg.fingerprint
  AND pa.resolved_at IS NULL
  AND pa.id <> dg.keeper_id;

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
     OR btrim(p_fingerprint) = '' OR length(p_fingerprint) > 200
     OR p_alert_type IS NULL OR btrim(p_alert_type) = '' OR length(p_alert_type) > 120
     OR p_message IS NULL OR btrim(p_message) = '' OR length(p_message) > 2000
     OR p_severity NOT IN ('info', 'warning', 'critical') THEN
    RAISE EXCEPTION 'invalid alert request';
  END IF;

  INSERT INTO public.pipeline_alerts (
    fingerprint, alert_type, severity, message, details, last_seen_at
  )
  VALUES (
    btrim(p_fingerprint), btrim(p_alert_type), p_severity, btrim(p_message),
    COALESCE(p_details, '{}'::jsonb), now()
  )
  ON CONFLICT (fingerprint) WHERE fingerprint IS NOT NULL AND resolved_at IS NULL
  DO UPDATE SET
    occurrence_count = public.pipeline_alerts.occurrence_count + 1,
    last_seen_at = now(),
    severity = CASE
      WHEN public.pipeline_alerts.severity = 'critical' OR excluded.severity = 'critical'
        THEN 'critical'
      WHEN public.pipeline_alerts.severity = 'warning' OR excluded.severity = 'warning'
        THEN 'warning'
      ELSE 'info'
    END,
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
  IF auth.role() <> 'service_role' OR p_fingerprint IS NULL
     OR btrim(p_fingerprint) = '' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  UPDATE public.pipeline_alerts
  SET resolved_at = now(), resolved_by = 'automatic_recovery'
  WHERE fingerprint = btrim(p_fingerprint) AND resolved_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Bounded retention helper. It can remove only alerts that have already been
-- resolved for at least the requested period; open evidence is never pruned.
CREATE OR REPLACE FUNCTION public.prune_resolved_pipeline_alerts(
  p_retention_days integer DEFAULT 90,
  p_batch_limit integer DEFAULT 1000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.role() <> 'service_role'
     OR p_retention_days < 30 OR p_retention_days > 3650
     OR p_batch_limit < 1 OR p_batch_limit > 5000 THEN
    RAISE EXCEPTION 'invalid alert retention request';
  END IF;

  WITH candidates AS (
    SELECT id
    FROM public.pipeline_alerts
    WHERE resolved_at < now() - make_interval(days => p_retention_days)
    ORDER BY resolved_at ASC
    LIMIT p_batch_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.pipeline_alerts pa
  USING candidates c
  WHERE pa.id = c.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.record_pipeline_alert(text,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_pipeline_alert(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_resolved_pipeline_alerts(integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pipeline_alert(text,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_pipeline_alert(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_resolved_pipeline_alerts(integer,integer) TO service_role;

COMMIT;