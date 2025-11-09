BEGIN;

-- 0) Table: create if missing, otherwise extend in place (no drops)
CREATE TABLE IF NOT EXISTS public.user_entitlements (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('free','daypass','monthly','quarterly','yearly')),
  status TEXT NOT NULL CHECK (status IN ('active','past_due','canceled','free')),
  current_period_end TIMESTAMPTZ,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  source TEXT DEFAULT 'stripe',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure all columns exist (idempotent ALTERs)
ALTER TABLE public.user_entitlements
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 1) RLS enabled
ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;

-- (Re)create policies idempotently
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_entitlements' AND policyname='Users can read own entitlements'
  ) THEN
    EXECUTE 'DROP POLICY "Users can read own entitlements" ON public.user_entitlements';
  END IF;
  EXECUTE $pol$
    CREATE POLICY "Users can read own entitlements"
    ON public.user_entitlements
    FOR SELECT
    USING (auth.uid() = user_id);
  $pol$;

  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_entitlements' AND policyname='Service can insert entitlements'
  ) THEN
    EXECUTE 'DROP POLICY "Service can insert entitlements" ON public.user_entitlements';
  END IF;
  EXECUTE $pol$
    CREATE POLICY "Service can insert entitlements"
    ON public.user_entitlements
    FOR INSERT
    WITH CHECK (auth.role() = 'service_role');
  $pol$;

  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_entitlements' AND policyname='Service can update entitlements'
  ) THEN
    EXECUTE 'DROP POLICY "Service can update entitlements" ON public.user_entitlements';
  END IF;
  EXECUTE $pol$
    CREATE POLICY "Service can update entitlements"
    ON public.user_entitlements
    FOR UPDATE
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
  $pol$;

  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_entitlements' AND policyname='Service can delete entitlements'
  ) THEN
    EXECUTE 'DROP POLICY "Service can delete entitlements" ON public.user_entitlements';
  END IF;
  EXECUTE $pol$
    CREATE POLICY "Service can delete entitlements"
    ON public.user_entitlements
    FOR DELETE
    USING (auth.role() = 'service_role');
  $pol$;

  -- Optional: allow service_role SELECT too (useful for admin dashboards)
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_entitlements' AND policyname='Service can read entitlements'
  ) THEN
    EXECUTE 'DROP POLICY "Service can read entitlements" ON public.user_entitlements';
  END IF;
  EXECUTE $pol$
    CREATE POLICY "Service can read entitlements"
    ON public.user_entitlements
    FOR SELECT
    USING (auth.role() = 'service_role');
  $pol$;

END$$;

-- 2) Helper view (recreate safely)
CREATE OR REPLACE VIEW public.v_is_subscriber AS
SELECT 
  user_id,
  (status = 'active'
   AND COALESCE(current_period_end, NOW()) >= NOW()
   AND plan <> 'free') AS is_subscriber
FROM public.user_entitlements;

-- 3) updated_at trigger function (create first)
CREATE OR REPLACE FUNCTION public.update_entitlements_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- 4) Trigger (create if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.user_entitlements'::regclass
      AND tgname = 'update_entitlements_updated_at'
  ) THEN
    CREATE TRIGGER update_entitlements_updated_at
      BEFORE UPDATE ON public.user_entitlements
      FOR EACH ROW
      EXECUTE FUNCTION public.update_entitlements_updated_at();
  END IF;
END$$;

-- 5) Tiny index to speed up expiration/downgrade sweeps
CREATE INDEX IF NOT EXISTS idx_entitlements_status_period
  ON public.user_entitlements (status, current_period_end);

COMMIT;