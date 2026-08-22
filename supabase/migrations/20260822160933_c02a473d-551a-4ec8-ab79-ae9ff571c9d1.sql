BEGIN;

CREATE TABLE IF NOT EXISTS public.privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_type text NOT NULL CHECK (request_type IN ('deletion')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected', 'canceled')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_notes text
);

CREATE UNIQUE INDEX IF NOT EXISTS privacy_requests_one_open_per_type_idx
  ON public.privacy_requests (user_id, request_type)
  WHERE status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS privacy_requests_status_idx
  ON public.privacy_requests (status, requested_at);

-- Shared market records and audit entries must survive an administrator's
-- account deletion without retaining a blocking auth.users reference.
DO $$
BEGIN
  IF to_regclass('public.prediction_markets') IS NOT NULL THEN
    ALTER TABLE public.prediction_markets ALTER COLUMN created_by DROP NOT NULL;
    ALTER TABLE public.prediction_markets
      DROP CONSTRAINT IF EXISTS prediction_markets_created_by_fkey;
    ALTER TABLE public.prediction_markets
      ADD CONSTRAINT prediction_markets_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.prediction_markets
      VALIDATE CONSTRAINT prediction_markets_created_by_fkey;
  END IF;

  IF to_regclass('public.admin_market_audit_log') IS NOT NULL THEN
    ALTER TABLE public.admin_market_audit_log ALTER COLUMN admin_user_id DROP NOT NULL;
    ALTER TABLE public.admin_market_audit_log
      DROP CONSTRAINT IF EXISTS admin_market_audit_log_admin_user_id_fkey;
    ALTER TABLE public.admin_market_audit_log
      ADD CONSTRAINT admin_market_audit_log_admin_user_id_fkey
      FOREIGN KEY (admin_user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    ALTER TABLE public.admin_market_audit_log
      VALIDATE CONSTRAINT admin_market_audit_log_admin_user_id_fkey;
  END IF;
END;
$$;

ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own privacy requests" ON public.privacy_requests;
CREATE POLICY "Users can read own privacy requests"
  ON public.privacy_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.privacy_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, user_id, request_type, status, details, requested_at, completed_at
) ON public.privacy_requests TO authenticated;
GRANT ALL ON public.privacy_requests TO service_role;

CREATE OR REPLACE FUNCTION public.request_account_deletion(p_confirmation text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_request_id uuid;
BEGIN
  IF v_uid IS NULL OR p_confirmation <> 'DELETE MY ACCOUNT' THEN
    RAISE EXCEPTION 'explicit account deletion confirmation required';
  END IF;

  INSERT INTO public.privacy_requests (user_id, request_type, details)
  VALUES (
    v_uid,
    'deletion',
    jsonb_build_object(
      'subscription_must_be_canceled_before_completion',
      EXISTS (
        SELECT 1 FROM public.user_entitlements
        WHERE user_id = v_uid
          AND status IN ('active', 'past_due')
          AND stripe_subscription_id IS NOT NULL
      )
    )
  )
  ON CONFLICT (user_id, request_type)
    WHERE status IN ('pending', 'in_progress')
    DO NOTHING
  RETURNING id INTO v_request_id;

  IF v_request_id IS NULL THEN
    SELECT id INTO v_request_id
    FROM public.privacy_requests
    WHERE user_id = v_uid
      AND request_type = 'deletion'
      AND status IN ('pending', 'in_progress')
    ORDER BY requested_at DESC
    LIMIT 1;
  END IF;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'account deletion request could not be recorded';
  END IF;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(text) TO authenticated;

-- Step one of an approved deletion: remove user-owned application rows only
-- after recurring billing is canceled. The auth identity is deliberately
-- deleted separately through the supported Supabase Auth Admin API.
CREATE OR REPLACE FUNCTION public.purge_user_application_data_for_deletion(
  p_user_id uuid,
  p_confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table text;
  v_count integer;
  v_counts jsonb := '{}'::jsonb;
BEGIN
  IF auth.role() <> 'service_role'
     OR p_user_id IS NULL
     OR p_confirmation <> 'PURGE USER APPLICATION DATA' THEN
    RAISE EXCEPTION 'service role and exact purge confirmation required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('privacy-delete:' || p_user_id::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.privacy_requests
    WHERE user_id = p_user_id
      AND request_type = 'deletion'
      AND status IN ('pending', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'open account deletion request not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_entitlements
    WHERE user_id = p_user_id
      AND stripe_subscription_id IS NOT NULL
      AND status <> 'canceled'
  ) THEN
    RAISE EXCEPTION 'recurring Stripe subscription must be canceled first';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'market_positions',
    'market_leaderboard_snapshots',
    'market_coins',
    'ticket_leg_outcomes',
    'ticket_outcomes',
    'generated_tickets',
    'user_tickets',
    'analytics_events',
    'user_rate_limits',
    'feature_usage_reservations',
    'user_roles',
    'profiles',
    'user_trial_credits',
    'user_entitlements'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('DELETE FROM public.%I WHERE user_id = $1', v_table)
        USING p_user_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_counts := v_counts || jsonb_build_object(v_table, v_count);
    END IF;
  END LOOP;

  UPDATE public.privacy_requests
  SET status = 'in_progress',
      details = details || jsonb_build_object(
        'application_data_purged_at', now(),
        'purged_row_counts', v_counts
      )
  WHERE user_id = p_user_id
    AND request_type = 'deletion'
    AND status IN ('pending', 'in_progress');

  RETURN v_counts;
END;
$$;

-- Step two is allowed only after Auth deletion has fired the ON DELETE SET
-- NULL reference, providing a database-verifiable completion condition.
CREATE OR REPLACE FUNCTION public.complete_account_deletion_request(
  p_request_id uuid,
  p_resolution_notes text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role'
     OR p_request_id IS NULL
     OR length(COALESCE(p_resolution_notes, '')) > 1000 THEN
    RAISE EXCEPTION 'invalid account deletion completion';
  END IF;

  UPDATE public.privacy_requests
  SET status = 'completed',
      completed_at = now(),
      resolution_notes = NULLIF(btrim(p_resolution_notes), '')
  WHERE id = p_request_id
    AND request_type = 'deletion'
    AND status = 'in_progress'
    AND user_id IS NULL;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_user_application_data_for_deletion(uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_account_deletion_request(uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_user_application_data_for_deletion(uuid,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_account_deletion_request(uuid,text)
  TO service_role;

COMMIT;