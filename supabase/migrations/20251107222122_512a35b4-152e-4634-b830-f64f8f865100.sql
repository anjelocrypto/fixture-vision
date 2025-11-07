-- ============================================================
-- TASK: Pre-Match Only Visibility + Performance Indexes
-- ============================================================

-- 1) Create indexes for fast pre-match filtering
CREATE INDEX IF NOT EXISTS idx_fixtures_status_kickoff 
  ON public.fixtures (status, timestamp)
  WHERE status IN ('NS', 'TBD');

CREATE INDEX IF NOT EXISTS idx_opt_sel_kickoff
  ON public.optimized_selections (utc_kickoff DESC, fixture_id);

CREATE INDEX IF NOT EXISTS idx_outcome_kickoff
  ON public.outcome_selections (utc_kickoff DESC, fixture_id);

-- 2) Create pre-match view for optimized_selections
-- Only show selections for upcoming matches (NS/TBD status, kickoff >= now + 5min buffer)
CREATE OR REPLACE VIEW public.v_selections_prematch
WITH (security_invoker = true)
AS
SELECT 
  os.*
FROM public.optimized_selections os
INNER JOIN public.fixtures f ON f.id = os.fixture_id
WHERE 
  f.status IN ('NS', 'TBD')  -- Only Not Started or To Be Determined
  AND os.utc_kickoff >= (now() + interval '5 minutes')  -- 5-minute buffer before kickoff
;

COMMENT ON VIEW public.v_selections_prematch IS 
  'Pre-match selections only: filters out live/finished matches. Used by Filterizer and Ticket Creator.';

-- 3) Create pre-match view for outcome_selections (Winner panel)
CREATE OR REPLACE VIEW public.v_outcomes_prematch
WITH (security_invoker = true)
AS
SELECT 
  os.*
FROM public.outcome_selections os
INNER JOIN public.fixtures f ON f.id = os.fixture_id
WHERE 
  f.status IN ('NS', 'TBD')
  AND os.utc_kickoff >= (now() + interval '5 minutes')
;

COMMENT ON VIEW public.v_outcomes_prematch IS 
  'Pre-match 1X2 outcomes only: filters out live/finished matches. Used by Winner panel.';

-- 4) Create pre-match view for best_outcome_prices (Winner panel alternative)
CREATE OR REPLACE VIEW public.v_best_outcome_prices_prematch
WITH (security_invoker = true)
AS
SELECT 
  bop.*
FROM public.best_outcome_prices bop
INNER JOIN public.fixtures f ON f.id = bop.fixture_id
WHERE 
  f.status IN ('NS', 'TBD')
  AND bop.utc_kickoff >= (now() + interval '5 minutes')
;

COMMENT ON VIEW public.v_best_outcome_prices_prematch IS 
  'Pre-match best 1X2 prices only: filters out live/finished matches. Used by Winner panel.';

-- 5) Grant SELECT access on views to authenticated users
GRANT SELECT ON public.v_selections_prematch TO authenticated;
GRANT SELECT ON public.v_outcomes_prematch TO authenticated;
GRANT SELECT ON public.v_best_outcome_prices_prematch TO authenticated;

-- 6) Grant full access to service role
GRANT ALL ON public.v_selections_prematch TO service_role;
GRANT ALL ON public.v_outcomes_prematch TO service_role;
GRANT ALL ON public.v_best_outcome_prices_prematch TO service_role;