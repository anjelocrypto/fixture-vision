-- Add missing foreign key from outcome_selections to fixtures
ALTER TABLE public.outcome_selections
  ADD CONSTRAINT outcome_selections_fixture_fk
  FOREIGN KEY (fixture_id) REFERENCES public.fixtures(id) ON DELETE CASCADE;