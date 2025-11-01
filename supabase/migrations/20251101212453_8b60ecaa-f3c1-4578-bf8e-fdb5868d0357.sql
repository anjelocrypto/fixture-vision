-- Link outcome_selections → leagues (this is the missing one)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'outcome_selections'
      AND c.conname = 'outcome_selections_league_id_fkey'
  ) THEN
    ALTER TABLE public.outcome_selections
      ADD CONSTRAINT outcome_selections_league_id_fkey
      FOREIGN KEY (league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;
  END IF;
END$$;

-- Link outcome_selections → fixtures (only if you DON'T already have outcome_selections_fixture_fk)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'outcome_selections'
      AND c.conname IN ('outcome_selections_fixture_fk','outcome_selections_fixture_id_fkey')
  ) THEN
    ALTER TABLE public.outcome_selections
      ADD CONSTRAINT outcome_selections_fixture_id_fkey
      FOREIGN KEY (fixture_id) REFERENCES public.fixtures(id) ON DELETE CASCADE;
  END IF;
END$$;

-- Ensure authenticated users can read leagues
GRANT SELECT ON public.leagues TO authenticated;