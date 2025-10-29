/**
 * Global configuration for odds constraints and system behavior
 */

// Per-leg odds band: reject tiny insurance legs and crazy longshots
export const ODDS_MIN = 1.25;
export const ODDS_MAX = 5.00;

// API-Football budget management (ULTRA plan)
export const DAILY_CALL_BUDGET = 65000; // 86% of 75k for safety margin
export const RPM_LIMIT = 50;

// Odds cache TTL
export const PREMATCH_TTL_MINUTES = 45;
export const LIVE_TTL_MINUTES = 3;

// Top bookmakers to keep per (fixture, market, side, line) for variety
export const KEEP_TOP_BOOKMAKERS = 3;

// Sample size threshold
export const MIN_SAMPLE_SIZE = 3;

// League allowlist for expanded variety (country codes)
export const ALLOWED_LEAGUES = [
  "England",      // Premier League + Championship + League One + League Two + National
  "Spain",        // La Liga + La Liga 2 + Primera RFEF
  "Italy",        // Serie A + Serie B
  "Germany",      // Bundesliga + 2. Bundesliga + 3. Liga
  "France",       // Ligue 1 + Ligue 2 + National 1
  "Netherlands",  // Eredivisie + Eerste Divisie
  "Portugal",     // Primeira Liga + Liga Portugal 2
  "Turkey",       // Super Lig + 1. Lig
  "Belgium",      // Pro League + Challenger Pro League
  "Scotland",     // Premiership + Championship
  "Austria",      // Bundesliga + 2. Liga
  "Switzerland",  // Super League
  "Greece",       // Super League
  "Denmark",      // Superliga
  "Norway",       // Eliteserien
  "Sweden",       // Allsvenskan
  "USA",          // MLS
  "Brazil",       // Serie A
  "Argentina",    // Liga Profesional
];
