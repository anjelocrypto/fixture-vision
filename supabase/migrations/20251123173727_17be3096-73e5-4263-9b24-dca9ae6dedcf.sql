-- Rebuild caches with new matrix-v3 stats logic
-- This forces a full recomputation using the updated per-metric fixture selection

-- Clear stats cache to recompute with new logic
DELETE FROM stats_cache;

-- Clear optimized selections to regenerate with new stats
DELETE FROM optimized_selections WHERE rules_version = 'matrix-v3';

-- Add comment to track migration
COMMENT ON TABLE stats_cache IS 'Last rebuilt: 2025-01-23 - matrix-v3 per-metric fixture selection';