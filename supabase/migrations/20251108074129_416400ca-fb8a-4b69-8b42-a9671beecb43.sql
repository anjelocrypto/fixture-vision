-- SAFER OPTION A: Lock down Winner (outcome_selections) only; keep Filterizer working

-- 1) Keep optimized_selections readable for authenticated users (NO CHANGE - stays as is)

-- 2) Restrict outcome_selections to admins (Winner becomes admin-only)
ALTER TABLE public.outcome_selections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read outcomes" ON public.outcome_selections;
DROP POLICY IF EXISTS "service role manage outcomes" ON public.outcome_selections;

CREATE POLICY "Admins can read outcome selections"
ON public.outcome_selections
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role manages outcome selections"
ON public.outcome_selections
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- 3) Tighten fixture_results (safe - historical match data)
ALTER TABLE public.fixture_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view results" ON public.fixture_results;
DROP POLICY IF EXISTS "Service role can manage results" ON public.fixture_results;

CREATE POLICY "Authenticated users can view results"
ON public.fixture_results
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role manages fixture results"
ON public.fixture_results
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');