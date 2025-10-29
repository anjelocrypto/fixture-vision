/**
 * Market availability detection for leagues
 * Lower divisions may not have all markets - this helps gracefully handle missing data
 */

import { NormalizedMarket, normalizeMarketById, normalizeMarketByName } from "./market_map.ts";

export interface MarketAvailability {
  goals: boolean;
  corners: boolean;
  cards: boolean;
  fouls: boolean;
  offsides: boolean;
}

/**
 * Detect which markets are available in an odds payload
 * Returns a set of normalized market names that have valid odds
 */
export function detectAvailableMarkets(oddsPayload: any): Set<NormalizedMarket> {
  const availableMarkets = new Set<NormalizedMarket>();
  
  if (!oddsPayload?.bookmakers || !Array.isArray(oddsPayload.bookmakers)) {
    return availableMarkets;
  }

  for (const bookmaker of oddsPayload.bookmakers) {
    if (!bookmaker.markets || !Array.isArray(bookmaker.markets)) continue;

    for (const market of bookmaker.markets) {
      // Try to normalize by ID first, then by name
      const normalized = market.id 
        ? normalizeMarketById(market.id)
        : normalizeMarketByName(market.name || "");

      if (normalized.normalized !== "other") {
        availableMarkets.add(normalized.normalized);
      }
    }
  }

  return availableMarkets;
}

/**
 * Check if a specific market is available in the odds data
 */
export function isMarketAvailable(
  oddsPayload: any, 
  targetMarket: NormalizedMarket
): boolean {
  const available = detectAvailableMarkets(oddsPayload);
  return available.has(targetMarket);
}

/**
 * Get a human-readable list of available markets
 */
export function getAvailableMarketsList(oddsPayload: any): string[] {
  const markets = detectAvailableMarkets(oddsPayload);
  return Array.from(markets).sort();
}

/**
 * Filter selections to only include those with available markets
 */
export function filterSelectionsWithAvailableMarkets(
  selections: any[],
  availableMarkets: Set<NormalizedMarket>
): any[] {
  return selections.filter(sel => {
    const market = sel.market as NormalizedMarket;
    return availableMarkets.has(market);
  });
}
