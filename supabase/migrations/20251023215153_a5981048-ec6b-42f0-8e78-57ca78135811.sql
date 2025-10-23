-- Security hardening: enforce user ownership on generated_tickets

-- First, delete any existing tickets with NULL user_id (cleanup orphaned data)
DELETE FROM public.generated_tickets WHERE user_id IS NULL;

-- Make user_id NOT NULL
ALTER TABLE public.generated_tickets
  ALTER COLUMN user_id SET NOT NULL;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own tickets" ON public.generated_tickets;
DROP POLICY IF EXISTS "Admins can view all tickets" ON public.generated_tickets;
DROP POLICY IF EXISTS "Users can create their own tickets" ON public.generated_tickets;
DROP POLICY IF EXISTS "Service role can manage tickets" ON public.generated_tickets;

-- Create comprehensive RLS policies for user ownership
CREATE POLICY "Users can view their own tickets"
  ON public.generated_tickets
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all tickets"
  ON public.generated_tickets
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can insert their own tickets"
  ON public.generated_tickets
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tickets"
  ON public.generated_tickets
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tickets"
  ON public.generated_tickets
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access"
  ON public.generated_tickets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);