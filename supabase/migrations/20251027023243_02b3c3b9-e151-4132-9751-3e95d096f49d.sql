-- Table
CREATE TABLE IF NOT EXISTS public.user_tickets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket  jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.user_tickets ENABLE ROW LEVEL SECURITY;

-- Policies (user-scoped CRUD)
CREATE POLICY "Users can view their own ticket"
  ON public.user_tickets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ticket"
  ON public.user_tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ticket"
  ON public.user_tickets FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own ticket"
  ON public.user_tickets FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_tickets_updated_at ON public.user_tickets;
CREATE TRIGGER trg_user_tickets_updated_at
BEFORE UPDATE ON public.user_tickets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_tickets_user_id ON public.user_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tickets_updated_at ON public.user_tickets(updated_at DESC);