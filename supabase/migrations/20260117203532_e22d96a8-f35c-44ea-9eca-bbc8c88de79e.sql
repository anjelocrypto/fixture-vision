-- Add cancellation tracking columns to user_entitlements
ALTER TABLE public.user_entitlements 
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;