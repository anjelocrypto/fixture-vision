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
  "England",      // 8 leagues: Premier League → National League divisions
  "Spain",        // 5 leagues: La Liga → Primera RFEF + Women's
  "Italy",        // 3 leagues: Serie A → Serie C
  "Germany",      // 3 leagues: Bundesliga → 3. Liga
  "France",       // 3 leagues: Ligue 1 → National 1
  "Netherlands",  // 2 leagues: Eredivisie + Eerste Divisie
  "Portugal",     // 2 leagues: Primeira Liga + Liga Portugal 2
  "Turkey",       // 2 leagues: Super Lig + 1. Lig
  "Belgium",      // 2 leagues: Pro League + Challenger Pro
  "Scotland",     // 2 leagues: Premiership + Championship
  "Austria",      // 2 leagues: Bundesliga + 2. Liga
  "Switzerland",  // 2 leagues: Super League + Challenge League
  "Greece",       // 2 leagues: Super League + Super League 2
  "Denmark",      // Superliga
  "Norway",       // Eliteserien
  "Sweden",       // 2 leagues: Allsvenskan + Superettan
  "Poland",       // 2 leagues: Ekstraklasa + I Liga
  "Czech-Republic", // First League
  "Romania",      // Liga I
  "Croatia",      // HNL
  "Serbia",       // Super Liga
  "Bulgaria",     // First League
  "Hungary",      // NB I
  "Ukraine",      // Premier League
  "Russia",       // Premier League
  "USA",          // 2 leagues: MLS + USL Championship
  "Mexico",       // 2 leagues: Liga MX + Liga de Expansion
  "Brazil",       // 2 leagues: Serie A + Serie B
  "Argentina",    // 2 leagues: Liga Profesional + Primera B
  "Colombia",     // Primera A
  "Chile",        // Primera Division
  "Uruguay",      // Primera Division
  "Paraguay",     // Division Profesional
  "Ecuador",      // Serie A
  "Japan",        // 2 leagues: J1 + J2 League
  "South-Korea",  // K League 1
  "Australia",    // A-League
  "China",        // Super League
  "Saudi-Arabia", // Pro League
  "UAE",          // Pro League
  "Qatar",        // Stars League
  "South-Africa", // Premier Division
  "Egypt",        // Premier League
  "Morocco",      // Botola Pro
  "Algeria",      // Ligue 1
  "Tunisia",      // Ligue Professionnelle 1
  "Israel",       // Ligat ha'Al
  "Iceland",      // Úrvalsdeild
  "Finland",      // Veikkausliiga
];
