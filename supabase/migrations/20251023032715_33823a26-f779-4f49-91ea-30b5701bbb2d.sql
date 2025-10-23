-- Fix policy existence checks using correct column names
DO $$ BEGIN
  -- optimizer_cache table and policies
  CREATE TABLE IF NOT EXISTS public.optimizer_cache (
    id uuid primary key default gen_random_uuid(),
    fixture_id bigint not null,
    market text not null,
    side text not null,
    line numeric not null,
    combined_value numeric not null,
    bookmaker text,
    odds numeric,
    source text,
    computed_at timestamptz default now()
  );
  ALTER TABLE public.optimizer_cache ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'optimizer_cache' AND policyname = 'Optimizer cache readable (auth)'
  ) THEN
    CREATE POLICY "Optimizer cache readable (auth)" ON public.optimizer_cache
      FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'optimizer_cache' AND policyname = 'Service role manage optimizer'
  ) THEN
    CREATE POLICY "Service role manage optimizer" ON public.optimizer_cache
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_optimizer_fixture ON public.optimizer_cache(fixture_id);

-- generated_tickets table and policies
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS public.generated_tickets (
    id uuid primary key default gen_random_uuid(),
    total_odds numeric not null,
    min_target numeric not null,
    max_target numeric not null,
    used_live boolean not null default false,
    legs jsonb not null,
    created_at timestamptz default now()
  );
  ALTER TABLE public.generated_tickets ENABLE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'generated_tickets' AND policyname = 'Tickets readable (auth)'
  ) THEN
    CREATE POLICY "Tickets readable (auth)" ON public.generated_tickets
      FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'generated_tickets' AND policyname = 'Service role manage tickets'
  ) THEN
    CREATE POLICY "Service role manage tickets" ON public.generated_tickets
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;