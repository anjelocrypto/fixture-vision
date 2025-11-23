-- Add fouls and offsides columns to fixture_results table
ALTER TABLE public.fixture_results
ADD COLUMN fouls_home SMALLINT,
ADD COLUMN fouls_away SMALLINT,
ADD COLUMN offsides_home SMALLINT,
ADD COLUMN offsides_away SMALLINT;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_fixture_results_fouls ON public.fixture_results(fouls_home, fouls_away);
CREATE INDEX IF NOT EXISTS idx_fixture_results_offsides ON public.fixture_results(offsides_home, offsides_away);