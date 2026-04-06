-- ============================================================================
-- FIX: optimized_selections RLS leak (premium data accessible to all auth users)
-- ============================================================================

-- Drop the leaking policy that grants all authenticated users read access
DROP POLICY IF EXISTS "Authenticated users can read optimized selections" ON public.optimized_selections;

-- Replace with admin-only read (edge functions use service_role, not affected)
CREATE POLICY "Only admins can read optimized selections"
  ON public.optimized_selections
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ============================================================================
-- FIX: safe_zone_picks RLS leak (premium picks accessible to all auth users)
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated users can read safe zone picks" ON public.safe_zone_picks;

CREATE POLICY "Only admins can read safe zone picks"
  ON public.safe_zone_picks
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ============================================================================
-- FIX: team_totals_candidates RLS leak (premium data accessible to all auth users)
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated users can read team totals" ON public.team_totals_candidates;

CREATE POLICY "Only admins can read team totals candidates"
  ON public.team_totals_candidates
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ============================================================================
-- FIX: performance_weights RLS leak (model weights accessible to all auth users)
-- ============================================================================
DROP POLICY IF EXISTS "Anyone can read performance weights" ON public.performance_weights;

CREATE POLICY "Only admins can read performance weights"
  ON public.performance_weights
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ============================================================================
-- NOTE: green_buckets stays readable by authenticated users intentionally.
-- It contains aggregate hit-rate metadata (not premium picks), and is used
-- by the client to show "this market has X% hit rate" labels. No odds, no 
-- specific fixture data. This is acceptable public metadata.
-- ============================================================================