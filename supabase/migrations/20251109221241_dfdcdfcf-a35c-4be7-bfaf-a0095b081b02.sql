-- Create unique constraint on countries.code (regular index, safe for small tables)
CREATE UNIQUE INDEX IF NOT EXISTS countries_code_uk_idx
  ON public.countries (code);

ALTER TABLE public.countries
  ADD CONSTRAINT countries_code_uk
  UNIQUE USING INDEX countries_code_uk_idx;