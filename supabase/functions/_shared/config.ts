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

// Top bookmakers to keep (1 = best only, 3 = top 3)
export const KEEP_TOP_BOOKMAKERS = 1;

// Sample size threshold
export const MIN_SAMPLE_SIZE = 3;
