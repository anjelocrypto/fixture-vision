/**
 * RC3.3 — backfill watchdog correctness.
 *
 * A stall means the three MOST RECENT runs, in real chronological order, were
 * each successful, failure-free and inserted nothing. Zero / nonzero / zero is
 * progress, and a failed run breaks the streak instead of being filtered out.
 */
import { describe, it, expect } from "vitest";
import {
  isBackfillStalled,
  type BackfillRunRow,
} from "../../supabase/functions/_shared/gate_d_health.ts";
import healthSnapshotSrc from "../../supabase/functions/pipeline-health-snapshot/index.ts?raw";

const run = (inserted: number | null, over: Partial<BackfillRunRow> = {}): BackfillRunRow => ({
  success: true,
  failed: 0,
  details: { inserted },
  ...over,
});

describe("backfill stall watchdog", () => {
  it("flags three consecutive successful zero-insert runs", () => {
    expect(isBackfillStalled([run(0), run(0), run(0)])).toBe(true);
  });

  it("does NOT treat zero / nonzero / zero as three consecutive zero-result runs", () => {
    expect(isBackfillStalled([run(0), run(12), run(0)])).toBe(false);
    expect(isBackfillStalled([run(0), run(0), run(12), run(0), run(0)])).toBe(false);
  });

  it("lets a failed run break the streak instead of skipping it", () => {
    expect(isBackfillStalled([run(0), run(0, { failed: 3 }), run(0)])).toBe(false);
    expect(isBackfillStalled([run(0), run(0, { success: false }), run(0)])).toBe(false);
  });

  it("needs three real runs before it can conclude anything", () => {
    expect(isBackfillStalled([])).toBe(false);
    expect(isBackfillStalled([run(0), run(0)])).toBe(false);
  });

  it("treats a missing insert count as zero progress", () => {
    expect(isBackfillStalled([run(null), run(null), { success: true, failed: 0, details: null }])).toBe(true);
  });

  it("only considers the three most recent runs", () => {
    expect(isBackfillStalled([run(0), run(0), run(0), run(50)])).toBe(true);
  });

  it("the health snapshot reads unfiltered chronological runs", () => {
    expect(healthSnapshotSrc).toContain("isBackfillStalled");
    // No success/failed pre-filtering may hide an intervening run.
    expect(healthSnapshotSrc).not.toContain('.eq("success", true)');
    expect(healthSnapshotSrc).not.toContain('.eq("failed", 0)');
  });
});
