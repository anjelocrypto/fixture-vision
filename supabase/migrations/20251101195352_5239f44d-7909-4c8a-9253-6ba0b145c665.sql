-- Fix security definer view issue by explicitly setting SECURITY INVOKER
DROP VIEW IF EXISTS public.best_outcome_prices;

CREATE VIEW public.best_outcome_prices
WITH (security_invoker = true) AS
WITH ranked AS (
  SELECT
    os.*,
    ROW_NUMBER() OVER (
      PARTITION BY os.fixture_id, os.market_type, os.outcome
      ORDER BY os.odds DESC
    ) AS rk
  FROM public.outcome_selections os
)
SELECT * FROM ranked WHERE rk = 1;

GRANT SELECT ON public.best_outcome_prices TO authenticated;