-- Add indexes for fast league lookups by country
CREATE INDEX IF NOT EXISTS leagues_country_id_idx ON public.leagues(country_id);
CREATE INDEX IF NOT EXISTS leagues_season_country_idx ON public.leagues(season, country_id);

-- Optional: partial index for active/allowed leagues if you filter by that later
-- CREATE INDEX IF NOT EXISTS leagues_country_allowed_idx ON public.leagues(country_id) WHERE allowed = true;