-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1) Table to store final results
CREATE TABLE IF NOT EXISTS public.fixture_results (
  fixture_id BIGINT PRIMARY KEY REFERENCES public.fixtures(id) ON DELETE CASCADE,
  league_id  INTEGER NOT NULL,
  kickoff_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Final scores
  goals_home SMALLINT NOT NULL,
  goals_away SMALLINT NOT NULL,
  -- Optional additional stats
  corners_home SMALLINT,
  corners_away SMALLINT,
  cards_home SMALLINT,
  cards_away SMALLINT,
  -- Metadata
  status TEXT NOT NULL DEFAULT 'FT',
  source TEXT NOT NULL DEFAULT 'api-football',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Indexes for fast backtests
CREATE INDEX IF NOT EXISTS idx_fixture_results_finished     ON public.fixture_results (finished_at);
CREATE INDEX IF NOT EXISTS idx_fixture_results_league_time  ON public.fixture_results (league_id, finished_at);

-- 3) RLS
ALTER TABLE public.fixture_results ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Read for any authenticated user
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='fixture_results' AND policyname='Anyone can view results'
  ) THEN
    CREATE POLICY "Anyone can view results"
      ON public.fixture_results FOR SELECT
      TO authenticated
      USING (true);
  END IF;

  -- Service role full access
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname='public' AND tablename='fixture_results' AND policyname='Service role can manage results'
  ) THEN
    CREATE POLICY "Service role can manage results"
      ON public.fixture_results FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END$$;

-- 4) Backtest join view
CREATE OR REPLACE VIEW public.backtest_samples AS
SELECT 
  os.id AS selection_id,
  os.fixture_id,
  os.league_id,
  os.market,
  os.side,
  os.line,
  os.bookmaker,
  os.odds AS book_odds,
  os.model_prob,
  os.edge_pct,
  os.sample_size,
  os.combined_snapshot,
  os.computed_at AS created_at,
  os.utc_kickoff AS kickoff_at,

  fr.goals_home,
  fr.goals_away,
  fr.corners_home,
  fr.corners_away,
  fr.cards_home,
  fr.cards_away,
  fr.finished_at,

  CASE 
    WHEN os.market='goals'   AND os.side='over'  THEN (fr.goals_home + fr.goals_away) >  os.line
    WHEN os.market='goals'   AND os.side='under' THEN (fr.goals_home + fr.goals_away) <  os.line
    WHEN os.market='corners' AND os.side='over'  THEN COALESCE(fr.corners_home + fr.corners_away, 0) >  os.line
    WHEN os.market='corners' AND os.side='under' THEN COALESCE(fr.corners_home + fr.corners_away, 0) <  os.line
    WHEN os.market='cards'   AND os.side='over'  THEN COALESCE(fr.cards_home + fr.cards_away, 0) >  os.line
    WHEN os.market='cards'   AND os.side='under' THEN COALESCE(fr.cards_home + fr.cards_away, 0) <  os.line
    ELSE NULL
  END AS result_win,

  EXTRACT(EPOCH FROM (os.utc_kickoff - os.computed_at))/3600.0 AS hours_to_kickoff
FROM public.optimized_selections os
JOIN public.fixture_results fr ON fr.fixture_id = os.fixture_id
WHERE fr.status = 'FT';

COMMENT ON VIEW public.backtest_samples IS 'Selections joined to final results for backtesting.';

-- 5) Retention: keep results 18 months (run monthly)
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-old-results');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'cleanup-old-results',
  '0 4 1 * *',  -- 04:00 UTC on the 1st of each month
  $$
  DELETE FROM public.fixture_results
  WHERE finished_at < NOW() - INTERVAL '18 months';
  ANALYZE public.fixture_results;
  $$
);

-- 6) Cron for results-refresh (every 30 min, 09:00-23:30 UTC daily)
DO $$
BEGIN
  PERFORM cron.unschedule('results-refresh-30m');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'results-refresh-30m',
  '*/30 9-23 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('supabase.functions.url', true) || '/results-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-CRON-KEY', public.get_cron_internal_key()
    ),
    body := jsonb_build_object('window_hours', 6)
  );
  $$
);