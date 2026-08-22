import { describe, expect, it } from "vitest";
import {
  calculateFreshCoverage,
  derivePipelineHealth,
  normalizeScoreBatchSize,
  shouldResolveBackfillAlert,
  shouldResolveScorerAlert,
} from "../../supabase/functions/_shared/gate_d_health.ts";
import {
  boundedRotatingSelection,
  clampProviderCallLimit,
  ProviderCallBudget,
  ProviderControlError,
} from "../../supabase/functions/_shared/provider_budget.ts";

describe("Gate D health remediation", () => {
  it("scopes fresh coverage to the same upcoming-team denominator", () => {
    const freshAfter = new Date("2026-08-22T00:00:00Z");
    const coverage = calculateFreshCoverage(
      [1, 2],
      [
        { team_id: 1, sample_size: 5, computed_at: "2026-08-22T01:00:00Z" },
        { team_id: 2, sample_size: 4, computed_at: "2026-08-22T01:00:00Z" },
        { team_id: 999, sample_size: 5, computed_at: "2026-08-22T01:00:00Z" },
      ],
      freshAfter,
    );

    expect(coverage).toEqual({ totalTeams: 2, freshTeams: 1, freshCoveragePct: 50 });
  });

  it("does not report green or resolve alerts while confirmed backlog remains", () => {
    const metrics = { pending_missing_fixture_results: 51, pending_with_ft_results: 1 };
    expect(derivePipelineHealth(metrics, [])).toBe("YELLOW");
    expect(shouldResolveScorerAlert(metrics)).toBe(false);
    expect(shouldResolveBackfillAlert(metrics)).toBe(false);
    expect(derivePipelineHealth(metrics, ["stalled"])).toBe("RED");
  });

  it("normalizes invalid scorer batch sizes", () => {
    expect(normalizeScoreBatchSize("not-a-number")).toBe(500);
    expect(normalizeScoreBatchSize("0")).toBe(1);
    expect(normalizeScoreBatchSize("5000")).toBe(1000);
  });
});

describe("Gate D provider controls", () => {
  it("enforces a hard call cap", () => {
    const budget = new ProviderCallBudget(2);
    budget.reserve();
    budget.reserve();
    expect(() => budget.reserve()).toThrowError(ProviderControlError);
    expect(budget.snapshot()).toMatchObject({
      provider_calls: 2,
      provider_call_limit: 2,
      provider_stop_reason: "provider_call_budget_exhausted",
    });
  });

  it("stops immediately on a provider 429", () => {
    const budget = new ProviderCallBudget(4);
    budget.reserve();
    expect(() => budget.observeResponse(429)).toThrowError(ProviderControlError);
    expect(budget.remaining).toBe(3);
    expect(budget.stoppedReason).toBe("provider_rate_limited");
  });

  it("rotates bounded work and clamps caller-requested limits", () => {
    expect(boundedRotatingSelection([1, 2, 3, 4], 2, 1)).toEqual([2, 3]);
    expect(boundedRotatingSelection([1, 2, 3, 4], 2, 3)).toEqual([4, 1]);
    expect(clampProviderCallLimit(99, 12)).toBe(12);
    expect(clampProviderCallLimit(0, 12)).toBe(1);
  });
});
