/**
 * Odds value string normalization utilities
 * Handles bookmaker variations: "Over 2.5", "O 2.5", "Total Over (2.5)", "Over 2,5", etc.
 */

/**
 * Normalize a bookmaker odds string to canonical format: "{side} {line}"
 * Example: "Total Over (2.5)" → "over 2.5"
 */
export function normalizeOddsValue(rawValue: string): string {
  if (!rawValue) return "";
  
  // 1. Lowercase and trim
  let normalized = rawValue.toLowerCase().trim();
  
  // 2. Remove common prefixes/suffixes: "total", parens, extra punctuation
  normalized = normalized.replace(/\btotal\b/gi, "");
  normalized = normalized.replace(/[()]/g, "");
  
  // 3. Convert comma decimals to dots (e.g., "2,5" → "2.5")
  normalized = normalized.replace(/(\d),(\d)/g, "$1.$2");
  
  // 4. Collapse multiple spaces to single space
  normalized = normalized.replace(/\s+/g, " ").trim();
  
  // 5. Normalize shorthand: "O 2.5" → "over 2.5", "U 2.5" → "under 2.5"
  normalized = normalized.replace(/\bo\b/g, "over");
  normalized = normalized.replace(/\bu\b/g, "under");
  
  return normalized;
}

/**
 * Build the canonical target string for a pick
 * Example: { side: "over", line: 2.5 } → "over 2.5"
 */
export function buildTargetString(side: "over" | "under", line: number): string {
  return `${side.toLowerCase()} ${line}`;
}

/**
 * Check if a normalized odds value matches the target pick
 */
export function matchesTarget(
  normalizedValue: string,
  side: "over" | "under",
  line: number
): boolean {
  const target = buildTargetString(side, line);
  return normalizedValue === target;
}
