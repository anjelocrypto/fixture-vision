export type StatMarket = "goals"|"corners"|"offsides"|"fouls"|"cards";
export type Rule = { range: [number, number] | "gte"; pick: { side: "over"|"under", line: number } };
export type Ruleset = Record<StatMarket, Rule[]>;

// Seeded from the shared sheet v1
// RULE GRID - Confirmed 1:1 with spreadsheet (boundaries are inclusive lower, exclusive upper)
// Combined value = home_team_avg + away_team_avg (last 5 FT matches, simple average, no weighting)
export const RULES: Ruleset = {
  goals: [
    { range: [1.0, 2.0], pick: { side: "over", line: 0.5 } },   // [1.0, 2.0) → Over 0.5
    { range: [2.0, 2.7], pick: { side: "over", line: 1.5 } },   // [2.0, 2.7) → Over 1.5
    { range: [2.7, 4.0], pick: { side: "over", line: 2.5 } },   // [2.7, 4.0) → Over 2.5
    { range: [4.0, 5.0], pick: { side: "over", line: 3.5 } },   // [4.0, 5.0) → Over 3.5
    { range: [5.0, 6.0], pick: { side: "over", line: 4.5 } },   // [5.0, 6.0) → Over 4.5
    { range: [6.0, 7.0], pick: { side: "over", line: 5.5 } },   // [6.0, 7.0) → Over 5.5
    { range: "gte",      pick: { side: "over", line: 5.5 } }    // ≥7.0 → Over 5.5
  ],
  corners: [
    { range: [7.8, 8.9],  pick: { side: "over", line: 7.5 } },  // [7.8, 8.9) → Over 7.5
    { range: [9.0, 10.0], pick: { side: "over", line: 8.5 } },  // [9.0, 10.0) → Over 8.5
    { range: [10.1, 11.0],pick: { side: "over", line: 9.5 } },  // [10.1, 11.0) → Over 9.5
    { range: [11.1, 12.0],pick: { side: "over", line: 10.5 } }, // [11.1, 12.0) → Over 10.5
    { range: [12.0, 13.0],pick: { side: "over", line: 11.5 } }, // [12.0, 13.0) → Over 11.5 (FIXED from 12.0)
    { range: [13.0, 15.0],pick: { side: "over", line: 12.5 } }, // [13.0, 15.0) → Over 12.5
    { range: "gte",       pick: { side: "over", line: 13.5 } }, // ≥15.0 → Over 13.5
  ],
  offsides: [
    { range: [1.5, 3.0],  pick: { side: "over", line: 1.5 } },  // [1.5, 3.0) → Over 1.5
    { range: [3.1, 4.0],  pick: { side: "over", line: 2.5 } },  // [3.1, 4.0) → Over 2.5
    { range: [4.1, 5.5],  pick: { side: "over", line: 3.5 } },  // [4.1, 5.5) → Over 3.5
    { range: "gte",       pick: { side: "over", line: 4.5 } },  // ≥5.5 → Over 4.5
  ],
  fouls: [
    { range: [16.5, 19.5], pick: { side: "over", line: 16.5 } }, // [16.5, 19.5) → Over 16.5
    { range: [19.6, 22.5], pick: { side: "over", line: 19.5 } }, // [19.6, 22.5) → Over 19.5
    { range: [22.6, 24.5], pick: { side: "over", line: 20.5 } }, // [22.6, 24.5) → Over 20.5
    { range: [24.6, 26.9], pick: { side: "over", line: 23.5 } }, // [24.6, 26.9) → Over 23.5
    { range: [27.0, 28.9], pick: { side: "over", line: 24.5 } }, // [27.0, 28.9) → Over 24.5
    { range: "gte",        pick: { side: "over", line: 24.5 } }, // ≥29.0 → Over 24.5
  ],
  cards: [
    { range: [1.0, 2.0],  pick: { side: "over", line: 1.5 } },  // [1.0, 2.0) → Over 1.5
    { range: [2.1, 3.0],  pick: { side: "over", line: 2.5 } },  // [2.1, 3.0) → Over 2.5
    { range: [3.1, 4.0],  pick: { side: "over", line: 3.5 } },  // [3.1, 4.0) → Over 3.5
    { range: [4.1, 5.0],  pick: { side: "over", line: 4.5 } },  // [4.1, 5.0) → Over 4.5
    { range: [5.1, 6.9],  pick: { side: "over", line: 5.5 } },  // [5.1, 6.9) → Over 5.5
    { range: "gte",       pick: { side: "over", line: 5.5 } },  // ≥7.0 → Over 5.5
  ],
};

export function pickFromCombined(stat: StatMarket, combinedValue: number) {
  const rules = RULES[stat];
  for (const r of rules) {
    if (r.range === "gte") return r.pick;
    const [lo, hi] = r.range;
    if (combinedValue >= lo && combinedValue <= hi) return r.pick;
  }
  return null;
}
