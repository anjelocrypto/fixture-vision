// Market normalization mapping for API-Football odds bets
// Maps provider bet IDs/names to our normalized market types

export type NormalizedMarket = "goals" | "corners" | "cards" | "fouls" | "offsides" | "other";
export type MarketType = "ou" | "1x2" | "btts" | "handicap" | "exact" | "other";

export interface MarketMapping {
  normalized: NormalizedMarket;
  type: MarketType;
}

// API-Football market IDs (common ones, expand as needed)
export const MARKET_MAP: Record<number, MarketMapping> = {
  // Goals
  1: { normalized: "goals", type: "1x2" },           // Match Winner
  5: { normalized: "goals", type: "ou" },            // Goals Over/Under
  8: { normalized: "goals", type: "btts" },          // Both Teams Score
  9: { normalized: "goals", type: "exact" },         // Correct Score
  26: { normalized: "goals", type: "ou" },           // Exact Goals Number
  
  // Corners
  12: { normalized: "corners", type: "ou" },         // Corners Over/Under
  97: { normalized: "corners", type: "1x2" },        // Corner 1X2
  
  // Cards
  14: { normalized: "cards", type: "ou" },           // Cards Over/Under
  15: { normalized: "cards", type: "ou" },           // Player Cards
  
  // Offsides (not commonly available, mark as other if found)
  // Fouls (not commonly available, mark as other if found)
};

// Market name patterns for text-based matching (fallback)
export const MARKET_NAME_PATTERNS: Record<string, MarketMapping> = {
  "goals over/under": { normalized: "goals", type: "ou" },
  "total goals": { normalized: "goals", type: "ou" },
  "match goals": { normalized: "goals", type: "ou" },
  "corners over/under": { normalized: "corners", type: "ou" },
  "total corners": { normalized: "corners", type: "ou" },
  "cards over/under": { normalized: "cards", type: "ou" },
  "total cards": { normalized: "cards", type: "ou" },
  "bookings": { normalized: "cards", type: "ou" },
  "offsides": { normalized: "offsides", type: "ou" },
  "fouls": { normalized: "fouls", type: "ou" },
};

export function normalizeMarketById(id: number): MarketMapping {
  return MARKET_MAP[id] || { normalized: "other", type: "other" };
}

export function normalizeMarketByName(name: string): MarketMapping {
  const lowerName = name.toLowerCase();
  for (const [pattern, mapping] of Object.entries(MARKET_NAME_PATTERNS)) {
    if (lowerName.includes(pattern)) {
      return mapping;
    }
  }
  return { normalized: "other", type: "other" };
}
