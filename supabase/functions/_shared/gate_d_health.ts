export interface StatsCacheHealthRow {
  team_id: number;
  sample_size: number | null;
  computed_at: string | null;
}

export function calculateFreshCoverage(
  upcomingTeamIds: Iterable<number>,
  cacheRows: readonly StatsCacheHealthRow[],
  freshAfter: Date,
): { totalTeams: number; freshTeams: number; freshCoveragePct: number } {
  const upcoming = new Set([...upcomingTeamIds].map(Number).filter(Number.isFinite));
  const fresh = new Set<number>();

  for (const row of cacheRows) {
    const teamId = Number(row.team_id);
    const computedAt = row.computed_at ? new Date(row.computed_at).getTime() : Number.NaN;
    if (
      upcoming.has(teamId)
      && Number(row.sample_size ?? 0) >= 5
      && Number.isFinite(computedAt)
      && computedAt >= freshAfter.getTime()
    ) {
      fresh.add(teamId);
    }
  }

  const totalTeams = upcoming.size;
  const freshTeams = fresh.size;
  const freshCoveragePct = totalTeams === 0
    ? 0
    : Math.min(100, Math.round((freshTeams / totalTeams) * 1000) / 10);
  return { totalTeams, freshTeams, freshCoveragePct };
}

export interface PipelineBacklogMetrics {
  pending_missing_fixture_results: number;
  pending_with_ft_results: number;
}

export function derivePipelineHealth(
  metrics: PipelineBacklogMetrics,
  alerts: readonly string[],
): "GREEN" | "YELLOW" | "RED" {
  if (alerts.length > 0) return "RED";
  if (metrics.pending_with_ft_results > 0 || metrics.pending_missing_fixture_results > 50) {
    return "YELLOW";
  }
  return "GREEN";
}

export function shouldResolveScorerAlert(metrics: PipelineBacklogMetrics): boolean {
  return metrics.pending_with_ft_results === 0;
}

export function shouldResolveBackfillAlert(metrics: PipelineBacklogMetrics): boolean {
  return metrics.pending_missing_fixture_results <= 50;
}

export function normalizeScoreBatchSize(raw: string | null, fallback = 500): number {
  const parsed = raw == null ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 1000);
}
