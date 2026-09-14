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
  /** Whole historical backlog — reporting only, never an alert trigger. */
  pending_missing_fixture_results: number;
  /** Missing results for legs whose kickoff is within the last 30 days. */
  pending_missing_actionable_30d: number;
  /** Legs the scorer can actually claim right now. */
  pending_with_ft_results: number;
  /** Legs held by the settlement policy. */
  pending_held?: number;
  /** Legs that are unsafe under the policy but not yet held. */
  pending_unsafe_unheld?: number;
  /** Database-computed stall flag, derived from real scorer progress. */
  scorer_stalled?: boolean;
}

export const ACTIONABLE_BACKLOG_THRESHOLD = 50;

export function derivePipelineHealth(
  metrics: PipelineBacklogMetrics,
  alerts: readonly string[],
): "GREEN" | "YELLOW" | "RED" {
  if (alerts.length > 0) return "RED";
  if ((metrics.pending_unsafe_unheld ?? 0) > 0) return "RED";
  if (
    metrics.pending_with_ft_results > 0 ||
    metrics.pending_missing_actionable_30d > ACTIONABLE_BACKLOG_THRESHOLD
  ) {
    return "YELLOW";
  }
  return "GREEN";
}

export function shouldResolveScorerAlert(metrics: PipelineBacklogMetrics): boolean {
  return metrics.pending_with_ft_results === 0 && metrics.scorer_stalled !== true;
}

export function shouldResolveBackfillAlert(metrics: PipelineBacklogMetrics): boolean {
  return metrics.pending_missing_actionable_30d <= ACTIONABLE_BACKLOG_THRESHOLD;
}

/**
 * Strict, fail-closed batch size. There is no default: callers must state the
 * batch size explicitly, and anything outside 1..500 is rejected.
 */
export function requireScoreBatchSize(raw: unknown): number {
  const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error("limit_required_1_to_500");
  }
  return parsed;
}

