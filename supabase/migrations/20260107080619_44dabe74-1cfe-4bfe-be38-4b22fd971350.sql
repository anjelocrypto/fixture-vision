-- =============================================
-- Phase 1 (Final): Outcome Tracking Tables
-- With kickoff_at + service_role policies
-- =============================================

BEGIN;

-- ---------- Table 1: ticket_leg_outcomes ----------
CREATE TABLE IF NOT EXISTS public.ticket_leg_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  ticket_id UUID NOT NULL
    REFERENCES public.generated_tickets(id) ON DELETE CASCADE,

  user_id UUID NOT NULL,
  fixture_id BIGINT NOT NULL,
  league_id INTEGER,

  -- Canonical fields (deterministic scoring)
  market TEXT NOT NULL,
  side   TEXT NOT NULL,
  line   NUMERIC NOT NULL,
  odds   NUMERIC NOT NULL,
  selection_key TEXT NOT NULL,

  -- Original/audit fields
  selection TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'prematch',

  -- Timing
  picked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  kickoff_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,

  -- Outcome
  result_status TEXT NOT NULL DEFAULT 'PENDING',
  actual_value NUMERIC,
  scored_version TEXT DEFAULT 'v1',
  derived_from_selection BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Constraints
  CONSTRAINT ticket_leg_outcomes_valid_result_status
    CHECK (result_status IN ('PENDING', 'WIN', 'LOSS', 'PUSH', 'VOID', 'UNKNOWN')),

  CONSTRAINT ticket_leg_outcomes_valid_side
    CHECK (side IN ('over', 'under', 'yes', 'no', 'home', 'away', 'draw')),

  CONSTRAINT ticket_leg_outcomes_valid_market
    CHECK (market IN ('goals', 'corners', 'cards', 'fouls', 'offsides', 'team_goals'))
);

-- Uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_leg_outcomes_unique
  ON public.ticket_leg_outcomes (ticket_id, fixture_id, market, side, line);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_leg_outcomes_ticket ON public.ticket_leg_outcomes (ticket_id);
CREATE INDEX IF NOT EXISTS idx_leg_outcomes_user ON public.ticket_leg_outcomes (user_id);
CREATE INDEX IF NOT EXISTS idx_leg_outcomes_fixture ON public.ticket_leg_outcomes (fixture_id);
CREATE INDEX IF NOT EXISTS idx_leg_outcomes_league ON public.ticket_leg_outcomes (league_id);
CREATE INDEX IF NOT EXISTS idx_leg_outcomes_status ON public.ticket_leg_outcomes (result_status);
CREATE INDEX IF NOT EXISTS idx_leg_outcomes_market_line ON public.ticket_leg_outcomes (market, side, line);
CREATE INDEX IF NOT EXISTS idx_leg_outcomes_pending ON public.ticket_leg_outcomes (result_status) WHERE result_status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_leg_outcomes_kickoff ON public.ticket_leg_outcomes (kickoff_at);

-- ---------- RLS: ticket_leg_outcomes ----------
ALTER TABLE public.ticket_leg_outcomes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_leg_outcomes' AND policyname = 'Users can view their own leg outcomes') THEN
    CREATE POLICY "Users can view their own leg outcomes" ON public.ticket_leg_outcomes FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_leg_outcomes' AND policyname = 'Admins can view all leg outcomes') THEN
    CREATE POLICY "Admins can view all leg outcomes" ON public.ticket_leg_outcomes FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_leg_outcomes' AND policyname = 'Service role full access (ticket_leg_outcomes)') THEN
    CREATE POLICY "Service role full access (ticket_leg_outcomes)" ON public.ticket_leg_outcomes FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;


-- ---------- Table 2: ticket_outcomes ----------
CREATE TABLE IF NOT EXISTS public.ticket_outcomes (
  ticket_id UUID PRIMARY KEY
    REFERENCES public.generated_tickets(id) ON DELETE CASCADE,

  user_id UUID NOT NULL,

  legs_total  INTEGER NOT NULL DEFAULT 0,
  legs_settled INTEGER NOT NULL DEFAULT 0,
  legs_won    INTEGER NOT NULL DEFAULT 0,
  legs_lost   INTEGER NOT NULL DEFAULT 0,
  legs_pushed INTEGER NOT NULL DEFAULT 0,
  legs_void   INTEGER NOT NULL DEFAULT 0,

  ticket_status TEXT NOT NULL DEFAULT 'PENDING',
  total_odds NUMERIC NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ,

  CONSTRAINT ticket_outcomes_valid_ticket_status
    CHECK (ticket_status IN ('PENDING', 'WON', 'LOST', 'VOID', 'PARTIAL'))
);

CREATE INDEX IF NOT EXISTS idx_ticket_outcomes_user ON public.ticket_outcomes (user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_outcomes_status ON public.ticket_outcomes (ticket_status);

-- ---------- RLS: ticket_outcomes ----------
ALTER TABLE public.ticket_outcomes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_outcomes' AND policyname = 'Users can view their own ticket outcomes') THEN
    CREATE POLICY "Users can view their own ticket outcomes" ON public.ticket_outcomes FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_outcomes' AND policyname = 'Admins can view all ticket outcomes') THEN
    CREATE POLICY "Admins can view all ticket outcomes" ON public.ticket_outcomes FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_outcomes' AND policyname = 'Service role full access (ticket_outcomes)') THEN
    CREATE POLICY "Service role full access (ticket_outcomes)" ON public.ticket_outcomes FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

COMMIT;