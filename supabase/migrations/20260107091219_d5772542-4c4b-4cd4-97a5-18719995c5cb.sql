-- Add league_key column for proper unique constraint (avoids COALESCE expression index)
ALTER TABLE public.performance_weights
ADD COLUMN IF NOT EXISTS league_key INTEGER NOT NULL DEFAULT -1;

-- Backfill existing rows
UPDATE public.performance_weights
SET league_key = COALESCE(league_id, -1)
WHERE league_key = -1 AND league_id IS NOT NULL;

-- Create trigger function to keep league_key in sync
CREATE OR REPLACE FUNCTION public.performance_weights_set_league_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.league_key := COALESCE(NEW.league_id, -1);
  RETURN NEW;
END;
$$;

-- Create trigger
DROP TRIGGER IF EXISTS trg_perf_weights_league_key ON public.performance_weights;
CREATE TRIGGER trg_perf_weights_league_key
BEFORE INSERT OR UPDATE OF league_id
ON public.performance_weights
FOR EACH ROW
EXECUTE FUNCTION public.performance_weights_set_league_key();

-- Drop old expression-based index and create proper unique index
DROP INDEX IF EXISTS public.performance_weights_unique_key;
CREATE UNIQUE INDEX IF NOT EXISTS performance_weights_unique_key2
  ON public.performance_weights (market, side, line, league_key);