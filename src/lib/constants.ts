// Feature access constants
export const FEATURE_GEMINI = 'gemini_analysis';
export const FEATURE_OPTIMIZER = 'bet_optimizer';
export const TRIAL_FEATURES = [FEATURE_GEMINI, FEATURE_OPTIMIZER] as const;
export const TRIAL_START_CREDITS = 5; // total shared across the two features
export const WHITELIST_EMAILS = ['lukaanjaparidzee99@gmail.com']; // case-insensitive
