-- Create user_entitlements table
CREATE TABLE IF NOT EXISTS public.user_entitlements (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL,
  status text NOT NULL,
  current_period_end timestamptz NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  source text NOT NULL DEFAULT 'stripe',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;

-- Drop old policies (idempotent)
DROP POLICY IF EXISTS "Users can read own entitlements" ON public.user_entitlements;
DROP POLICY IF EXISTS "Service role can insert entitlements" ON public.user_entitlements;
DROP POLICY IF EXISTS "Service role can update entitlements" ON public.user_entitlements;
DROP POLICY IF EXISTS "Service role can delete entitlements" ON public.user_entitlements;
DROP POLICY IF EXISTS "Service can insert entitlements" ON public.user_entitlements;
DROP POLICY IF EXISTS "Service can update entitlements" ON public.user_entitlements;
DROP POLICY IF EXISTS "Service can delete entitlements" ON public.user_entitlements;

-- 1) Users can read only their own entitlements
CREATE POLICY "Users can read own entitlements"
  ON public.user_entitlements
  FOR SELECT
  USING (auth.uid() = user_id);

-- 2) Webhooks/service can insert/update/delete via service_role
CREATE POLICY "Service can insert entitlements"
  ON public.user_entitlements
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service can update entitlements"
  ON public.user_entitlements
  FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service can delete entitlements"
  ON public.user_entitlements
  FOR DELETE
  USING (auth.role() = 'service_role');

-- Safer helper function: no-arg, current user only
CREATE OR REPLACE FUNCTION public.user_has_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_entitlements ue
    WHERE ue.user_id = auth.uid()
      AND ue.status = 'active'
      AND ue.current_period_end > now()
  );
$$;

-- Ensure updated_at trigger exists
CREATE OR REPLACE FUNCTION public.update_entitlements_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_entitlements_timestamp ON public.user_entitlements;
CREATE TRIGGER update_entitlements_timestamp
  BEFORE UPDATE ON public.user_entitlements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_entitlements_updated_at();

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_entitlements_status ON public.user_entitlements(status);
CREATE INDEX IF NOT EXISTS idx_user_entitlements_period_end ON public.user_entitlements(current_period_end);