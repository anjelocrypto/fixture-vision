// Rules module that maps combined averages to recommended betting lines
// Based on the Google Sheet statistical analysis

export type Market = "goals" | "corners" | "offsides" | "fouls" | "cards";
export type Line = {
  label: string; // e.g., "Over 1.5"
  kind: "over" | "under" | "none";
  threshold?: number;
};

type Range = { min: number; max: number }; // inclusive lower, exclusive upper
type Rule = { range: Range; line: Line };

// Encode the spreadsheet mapping as deterministic ranges → recommended lines
export const RULES: Record<Market, Rule[]> = {
  goals: [
    // IF 1–2 → THEN "Over 0.5"
    { range: { min: 1.0, max: 2.0 }, line: { label: "Over 0.5", kind: "over", threshold: 0.5 } },
    // IF 2–2.7 → THEN "Over 1.5"
    { range: { min: 2.0, max: 2.7 }, line: { label: "Over 1.5", kind: "over", threshold: 1.5 } },
    // IF 2.7–4 → THEN "Over 2.5"
    { range: { min: 2.7, max: 4.0 }, line: { label: "Over 2.5", kind: "over", threshold: 2.5 } },
    // IF 4–5 → THEN "Over 3.5"
    { range: { min: 4.0, max: 5.0 }, line: { label: "Over 3.5", kind: "over", threshold: 3.5 } },
    // IF 5+ → THEN "Over 4.5"
    { range: { min: 5.0, max: 999 }, line: { label: "Over 4.5", kind: "over", threshold: 4.5 } },
  ],
  corners: [
    // IF 7–8 → Over 7.5
    { range: { min: 7.0, max: 8.0 }, line: { label: "Over 7.5", kind: "over", threshold: 7.5 } },
    // IF 8–9 → Over 8.5
    { range: { min: 8.0, max: 9.0 }, line: { label: "Over 8.5", kind: "over", threshold: 8.5 } },
    // IF 9–10 → Over 9.5
    { range: { min: 9.0, max: 10.0 }, line: { label: "Over 9.5", kind: "over", threshold: 9.5 } },
    // IF 10–11 → Over 10.5
    { range: { min: 10.0, max: 11.0 }, line: { label: "Over 10.5", kind: "over", threshold: 10.5 } },
    // IF 11–12 → Over 11.5
    { range: { min: 11.0, max: 12.0 }, line: { label: "Over 11.5", kind: "over", threshold: 11.5 } },
    // IF 12+ → Over 12.5
    { range: { min: 12.0, max: 999 }, line: { label: "Over 12.5", kind: "over", threshold: 12.5 } },
  ],
  cards: [
    // IF <2 → nothing (skip)
    { range: { min: 0, max: 2.0 }, line: { label: "Skip", kind: "none" } },
    // IF 2–3 → Over 1.5
    { range: { min: 2.0, max: 3.0 }, line: { label: "Over 1.5", kind: "over", threshold: 1.5 } },
    // IF 3–4 → Over 2.5
    { range: { min: 3.0, max: 4.0 }, line: { label: "Over 2.5", kind: "over", threshold: 2.5 } },
    // IF 4–5 → Over 3.5
    { range: { min: 4.0, max: 5.0 }, line: { label: "Over 3.5", kind: "over", threshold: 3.5 } },
    // IF 5–6 → Over 4.5
    { range: { min: 5.0, max: 6.0 }, line: { label: "Over 4.5", kind: "over", threshold: 4.5 } },
    // IF 6+ → Over 5.5
    { range: { min: 6.0, max: 999 }, line: { label: "Over 5.5", kind: "over", threshold: 5.5 } },
  ],
  fouls: [
    // IF <20 → nothing (skip)
    { range: { min: 0, max: 20.0 }, line: { label: "Skip", kind: "none" } },
    // IF 20–24 → Over 23.5
    { range: { min: 20.0, max: 24.0 }, line: { label: "Over 23.5", kind: "over", threshold: 23.5 } },
    // IF 24–28 → Over 27.5
    { range: { min: 24.0, max: 28.0 }, line: { label: "Over 27.5", kind: "over", threshold: 27.5 } },
    // IF 28+ → Over 31.5
    { range: { min: 28.0, max: 999 }, line: { label: "Over 31.5", kind: "over", threshold: 31.5 } },
  ],
  offsides: [
    // IF <2 → nothing (skip)
    { range: { min: 0, max: 2.0 }, line: { label: "Skip", kind: "none" } },
    // IF 2–3 → Over 2.5
    { range: { min: 2.0, max: 3.0 }, line: { label: "Over 2.5", kind: "over", threshold: 2.5 } },
    // IF 3–4 → Over 3.5
    { range: { min: 3.0, max: 4.0 }, line: { label: "Over 3.5", kind: "over", threshold: 3.5 } },
    // IF 4–5 → Over 4.5
    { range: { min: 4.0, max: 5.0 }, line: { label: "Over 4.5", kind: "over", threshold: 4.5 } },
    // IF 5+ → Over 5.5
    { range: { min: 5.0, max: 999 }, line: { label: "Over 5.5", kind: "over", threshold: 5.5 } },
  ],
};

/**
 * Pick the recommended betting line for a given market and combined average
 * Returns null if no bet should be placed (e.g., "nothing" rules)
 */
export function pickLine(market: Market, combinedAvg: number): Line | null {
  const rules = RULES[market];
  if (!rules) return null;
  
  const rule = rules.find(r => combinedAvg >= r.range.min && combinedAvg < r.range.max);
  if (!rule || rule.line.kind === "none") return null;
  
  return rule.line;
}
