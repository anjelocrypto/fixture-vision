export type StatMarket = "goals"|"corners"|"offsides"|"fouls"|"cards";
export type Rule = { range: [number, number] | "gte"; pick: { side: "over"|"under", line: number } | null };
export type Ruleset = Record<StatMarket, Rule[]>;

// QUALIFICATION MATRIX v2_updated_ranges
// ============================================
// Ranges are INCLUSIVE on both ends (CLOSED intervals: lo ≤ x ≤ hi)
// "none" (pick: null) means market is NOT ELIGIBLE in that range
// Combined value = ((home_avg + away_avg) / 2) × multiplier (last 5 FT matches)
export const RULES: Ruleset = {
  goals: [
    { range: [2.3, 3.2],  pick: { side: "over", line: 1.5 } },   // [2.3, 3.2] → Over 1.5
    { range: [3.3, 4.2],  pick: { side: "over", line: 2.5 } },   // [3.3, 4.2] → Over 2.5
    { range: [4.3, 5.2],  pick: { side: "over", line: 3.5 } },   // [4.3, 5.2] → Over 3.5
    { range: [5.3, 6.3],  pick: { side: "over", line: 4.5 } },   // [5.3, 6.3] → Over 4.5
  ],
  corners: [
    { range: [10, 12],    pick: { side: "over", line: 8.5 } },   // [10, 12] → Over 8.5
    { range: [13, 15],    pick: { side: "over", line: 9.5 } },   // [13, 15] → Over 9.5
    { range: [16, 18],    pick: { side: "over", line: 10.5 } },  // [16, 18] → Over 10.5
  ],
  offsides: [
    { range: [1.0, 2.0],  pick: null },                          // [1.0, 2.0] → none (not eligible)
    { range: [2.0, 3.0],  pick: { side: "over", line: 1.5 } },   // [2.0, 3.0] → Over 1.5
    { range: [3.0, 4.0],  pick: { side: "over", line: 2.5 } },   // [3.0, 4.0] → Over 2.5
    { range: [4.0, 5.0],  pick: { side: "over", line: 3.5 } },   // [4.0, 5.0] → Over 3.5
    { range: [5.0, 6.0],  pick: { side: "over", line: 4.5 } },   // [5.0, 6.0] → Over 4.5
    { range: [6.0, 7.0],  pick: { side: "over", line: 5.5 } },   // [6.0, 7.0] → Over 5.5
    { range: [7.0, 8.0],  pick: { side: "over", line: 5.5 } },   // [7.0, 8.0] → Over 5.5
    { range: "gte",       pick: { side: "over", line: 5.5 } },   // ≥8.0 → Over 5.5
  ],
  fouls: [
    { range: [19.0, 20.0],pick: { side: "over", line: 16.5 } },  // [19.0, 20.0] → Over 16.5
    { range: [20.0, 21.0],pick: { side: "over", line: 17.5 } },  // [20.0, 21.0] → Over 17.5
    { range: [21.0, 22.0],pick: { side: "over", line: 18.5 } },  // [21.0, 22.0] → Over 18.5
    { range: [22.0, 23.0],pick: { side: "over", line: 19.5 } },  // [22.0, 23.0] → Over 19.5
    { range: [23.0, 24.0],pick: { side: "over", line: 20.5 } },  // [23.0, 24.0] → Over 20.5
    { range: [24.0, 25.0],pick: { side: "over", line: 21.5 } },  // [24.0, 25.0] → Over 21.5
    { range: [25.0, 26.0],pick: { side: "over", line: 22.5 } },  // [25.0, 26.0] → Over 22.5
    { range: [26.0, 27.0],pick: { side: "over", line: 23.5 } },  // [26.0, 27.0] → Over 23.5
    { range: [27.0, 28.0],pick: { side: "over", line: 24.5 } },  // [27.0, 28.0] → Over 24.5
    { range: [28.0, 29.0],pick: { side: "over", line: 24.5 } },  // [28.0, 29.0] → Over 24.5
    { range: [29.0, 30.0],pick: { side: "over", line: 24.5 } },  // [29.0, 30.0] → Over 24.5
    { range: "gte",       pick: { side: "over", line: 24.5 } },  // ≥30.0 → Over 24.5
  ],
  cards: [
    { range: [1.0, 2.0],  pick: null },                          // [1.0, 2.0] → none (not eligible)
    { range: [2.0, 3.0],  pick: { side: "over", line: 1.5 } },   // [2.0, 3.0] → Over 1.5
    { range: [3.0, 4.0],  pick: { side: "over", line: 2.5 } },   // [3.0, 4.0] → Over 2.5
    { range: [4.0, 5.0],  pick: { side: "over", line: 3.5 } },   // [4.0, 5.0] → Over 3.5
    { range: [5.0, 6.0],  pick: { side: "over", line: 4.5 } },   // [5.0, 6.0] → Over 4.5
    { range: [6.0, 7.0],  pick: { side: "over", line: 5.5 } },   // [6.0, 7.0] → Over 5.5
    { range: [7.0, 8.0],  pick: { side: "over", line: 5.5 } },   // [7.0, 8.0] → Over 5.5
    { range: "gte",       pick: { side: "over", line: 5.5 } },   // ≥8.0 → Over 5.5
  ],
};

// Current rules version identifier for data versioning
// Updated to matrix-v3 to reflect new last-5 stats logic (partial data per metric, season=2025, status=FT)
export const RULES_VERSION = "matrix-v3";

export function pickFromCombined(stat: StatMarket, combinedValue: number) {
  const rules = RULES[stat];
  // Determine threshold for the final "gte" rule (max upper bound among finite ranges)
  let gteThreshold = -Infinity;
  for (const r of rules) {
    if (r.range !== "gte") {
      const [, hi] = r.range;
      if (hi > gteThreshold) gteThreshold = hi;
    }
  }

  // Iterate from the end so that shared boundaries prefer the upper bucket
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i];
    if (r.range === "gte") {
      if (combinedValue >= gteThreshold) return r.pick;
      continue;
    }
    const [lo, hi] = r.range;
    // Ranges are INCLUSIVE on both ends (lo ≤ x ≤ hi)
    if (combinedValue >= lo && combinedValue <= hi) {
      return r.pick; // May be null for "none" ranges
    }
  }
  return null; // No matching range found
}
