export type StatMarket = "goals"|"corners"|"offsides"|"fouls"|"cards";
export type Rule = { range: [number, number] | "gte"; pick: { side: "over"|"under", line: number } | null };
export type Ruleset = Record<StatMarket, Rule[]>;

// QUALIFICATION MATRIX v2_combined_matrix_v1
// ============================================
// Ranges are INCLUSIVE on both ends (e.g., 2.7 ≤ x ≤ 4.0)
// "none" (pick: null) means market is NOT ELIGIBLE in that range
// Combined value = home_team_avg + away_team_avg (last 5 FT matches, simple average, no weighting)
export const RULES: Ruleset = {
  goals: [
    { range: [1.0, 2.0],  pick: { side: "over", line: 0.5 } },   // [1.0, 2.0] → Over 0.5
    { range: [2.0, 2.7],  pick: { side: "over", line: 1.5 } },   // [2.0, 2.7] → Over 1.5
    { range: [2.7, 4.0],  pick: { side: "over", line: 2.5 } },   // [2.7, 4.0] → Over 2.5
    { range: [4.0, 5.0],  pick: { side: "over", line: 3.5 } },   // [4.0, 5.0] → Over 3.5
    { range: [5.0, 6.0],  pick: { side: "over", line: 4.5 } },   // [5.0, 6.0] → Over 4.5
    { range: "gte",       pick: { side: "over", line: 4.5 } },   // ≥6.0 → Over 4.5
  ],
  corners: [
    { range: [7.0, 8.0],  pick: { side: "over", line: 7.5 } },   // [7.0, 8.0] → Over 7.5
    { range: [8.0, 9.0],  pick: { side: "over", line: 7.5 } },   // [8.0, 9.0] → Over 7.5
    { range: [9.0, 10.0], pick: { side: "over", line: 8.5 } },   // [9.0, 10.0] → Over 8.5
    { range: [10.0, 11.0],pick: { side: "over", line: 8.5 } },   // [10.0, 11.0] → Over 8.5
    { range: [11.0, 12.0],pick: { side: "over", line: 9.5 } },   // [11.0, 12.0] → Over 9.5
    { range: [12.0, 13.0],pick: { side: "over", line: 9.5 } },   // [12.0, 13.0] → Over 9.5
    { range: [14.0, 15.0],pick: { side: "over", line: 9.5 } },   // [14.0, 15.0] → Over 9.5
    { range: [15.0, 16.0],pick: { side: "over", line: 10.5 } },  // [15.0, 16.0] → Over 10.5
    { range: "gte",       pick: { side: "over", line: 10.5 } },  // ≥16.0 → Over 10.5
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
export const RULES_VERSION = "v2_combined_matrix_v1";

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
