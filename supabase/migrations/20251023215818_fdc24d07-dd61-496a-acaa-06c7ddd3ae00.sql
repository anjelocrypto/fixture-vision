-- Add performance index for user tickets query
CREATE INDEX IF NOT EXISTS idx_tickets_user_created 
  ON public.generated_tickets(user_id, created_at DESC);