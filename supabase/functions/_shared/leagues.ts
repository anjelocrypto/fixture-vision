/**
 * League allowlist for fixture fetching
 * Only top divisions + selected 2nd tiers from allowed countries
 */

export const ALLOWED_LEAGUE_IDS = [
  // International Competitions
  5,    // UEFA Nations League
  1,    // World Cup
  4,    // UEFA Euro Championship
  960,  // UEFA Euro Championship Qualification
  32,   // FIFA World Cup Qualification (Africa)
  34,   // FIFA World Cup Qualification (Asia)
  33,   // FIFA World Cup Qualification (Oceania)
  31,   // FIFA World Cup Qualification (South America)
  29,   // FIFA World Cup Qualification (CONCACAF)
  30,   // FIFA World Cup Qualification (Europe)
  9,    // Copa América
  36,   // Africa Cup of Nations Qualification
  964,  // CAF Africa Cup of Nations
  
  // UEFA Club Competitions
  2,    // UEFA Champions League
  3,    // UEFA Europa League
  848,  // UEFA Europa Conference League
  
  // ============= DOMESTIC CUP COMPETITIONS =============
  45,   // England FA Cup
  48,   // England EFL Cup (League Cup / Carabao Cup)
  143,  // Spain Copa del Rey
  137,  // Italy Coppa Italia
  81,   // Germany DFB-Pokal
  66,   // France Coupe de France
  
  // England (9 leagues + 2 cups)
  39,   // Premier League
  40,   // Championship
  41,   // League One
  42,   // League Two
  43,   // National League
  50,   // National League - North
  51,   // National League - South
  667,  // Premier League 2 Division One (U21)
  
  // Spain (7 leagues)
  140,  // La Liga
  141,  // La Liga 2
  435,  // Primera RFEF - Group 1
  436,  // Primera RFEF - Group 2
  663,  // Primera División Femenina
  
  // Italy (5 leagues)
  135,  // Serie A
  136,  // Serie B
  269,  // Serie C - Girone A
  
  // Germany (6 leagues)
  78,   // Bundesliga
  79,   // 2. Bundesliga
  80,   // 3. Liga
  
  // France (4 leagues)
  61,   // Ligue 1
  62,   // Ligue 2
  556,  // National 1
  
  // Netherlands (2 leagues)
  88,   // Eredivisie
  89,   // Eerste Divisie
  
  // Portugal (2 leagues)
  94,   // Primeira Liga
  95,   // Liga Portugal 2
  
  // Turkey (2 leagues)
  203,  // Super Lig
  204,  // 1. Lig
  
  // Belgium (2 leagues)
  144,  // Pro League
  145,  // Challenger Pro League
  
  // Scotland (2 leagues)
  179,  // Premiership
  180,  // Championship
  
  // Austria (2 leagues)
  218,  // Bundesliga
  219,  // 2. Liga
  
  // Switzerland (2 leagues)
  207,  // Super League
  208,  // Challenge League
  
  // Greece (2 leagues)
  197,  // Super League
  198,  // Super League 2
  
  // Denmark (1 league)
  119,  // Superliga
  
  // Norway (1 league)
  103,  // Eliteserien
  
  // Sweden (2 leagues)
  113,  // Allsvenskan
  114,  // Superettan
  
  // Poland (2 leagues)
  106,  // Ekstraklasa
  107,  // I Liga
  
  // Czech Republic (1 league)
  345,  // First League
  
  // Romania (1 league)
  283,  // Liga I
  
  // Croatia (1 league)
  210,  // HNL
  
  // Serbia (1 league)
  286,  // Super Liga
  
  // Bulgaria (1 league)
  172,  // First League
  
  // Hungary (1 league)
  271,  // NB I
  
  // Ukraine (1 league)
  333,  // Premier League
  
  // Russia (1 league)
  235,  // Premier League
  
  // USA (2 leagues)
  253,  // MLS
  254,  // USL Championship
  
  // Mexico (2 leagues)
  262,  // Liga MX
  263,  // Liga de Expansion
  
  // Brazil (2 leagues)
  71,   // Serie A
  72,   // Serie B
  
  // Argentina (2 leagues)
  128,  // Liga Profesional
  129,  // Primera B
  
  // Colombia (1 league)
  239,  // Primera A
  
  // Chile (1 league)
  265,  // Primera Division
  
  // Uruguay (1 league)
  274,  // Primera Division
  
  // Paraguay (1 league)
  250,  // Division Profesional
  
  // Ecuador (1 league)
  242,  // Serie A
  
  // Japan (2 leagues)
  98,   // J1 League
  99,   // J2 League
  
  // South Korea (1 league)
  292,  // K League 1
  
  // Australia (1 league)
  188,  // A-League
  
  // China (1 league)
  17,   // Super League
  
  // Saudi Arabia (1 league)
  307,  // Pro League
  
  // UAE (1 league)
  301,  // Pro League
  
  // Qatar (1 league)
  305,  // Stars League
  
  // South Africa (1 league)
  288,  // Premier Division
  
  // Egypt (1 league)
  233,  // Premier League
  
  // Morocco (1 league)
  200,  // Botola Pro
  
  // Algeria (1 league)
  185,  // Ligue 1
  
  // Tunisia (1 league)
  202,  // Ligue Professionnelle 1
  
  // Israel (1 league)
  383,  // Ligat ha'Al
  
  // Iceland (1 league)
  165,  // Úrvalsdeild
  
  // Finland (1 league)
  244,  // Veikkausliiga
];

/**
 * ⚠️ CRITICAL: Deterministic league→country mapping
 * 
 * This is the SINGLE SOURCE OF TRUTH for league-to-country assignments.
 * Used by ALL ingestion functions to prevent country_id from being overwritten to NULL.
 * 
 * INTERNATIONAL leagues (with null country_id) are identified by INTERNATIONAL_LEAGUE_IDS below.
 * All other leagues MUST be mapped here to prevent data corruption.
 */
export const LEAGUE_TO_COUNTRY_CODE: Record<number, string> = {
  // Domestic Cups
  45: 'GB-ENG',   // FA Cup
  48: 'GB-ENG',   // EFL Cup (Carabao Cup)
  143: 'ES',      // Copa del Rey
  137: 'IT',      // Coppa Italia
  81: 'DE',       // DFB-Pokal
  66: 'FR',       // Coupe de France
  
  // England
  39: 'GB-ENG', 40: 'GB-ENG', 41: 'GB-ENG', 42: 'GB-ENG',
  43: 'GB-ENG', 50: 'GB-ENG', 51: 'GB-ENG', 667: 'GB-ENG',
  
  // Spain
  140: 'ES', 141: 'ES', 435: 'ES', 436: 'ES', 663: 'ES',
  
  // Italy
  135: 'IT', 136: 'IT', 269: 'IT',
  
  // Germany
  78: 'DE', 79: 'DE', 80: 'DE',
  
  // France
  61: 'FR', 62: 'FR', 556: 'FR',
  
  // Netherlands
  88: 'NL', 89: 'NL',
  
  // Portugal
  94: 'PT', 95: 'PT',
  
  // Turkey
  203: 'TR', 204: 'TR',
  
  // Belgium
  144: 'BE', 145: 'BE',
  
  // Scotland
  179: 'GB-SCT', 180: 'GB-SCT',
  
  // Austria
  218: 'AT', 219: 'AT',
  
  // Switzerland
  207: 'CH', 208: 'CH',
  
  // Greece
  197: 'GR', 198: 'GR',
  
  // Denmark
  119: 'DK',
  
  // Norway
  103: 'NO',
  
  // Sweden
  113: 'SE', 114: 'SE',
  
  // Poland
  106: 'PL', 107: 'PL',
  
  // Czech Republic
  345: 'CZ',
  
  // Romania
  283: 'RO',
  
  // Croatia
  210: 'HR',
  
  // Serbia
  286: 'RS',
  
  // Bulgaria
  172: 'BG',
  
  // Hungary
  271: 'HU',
  
  // Ukraine
  333: 'UA',
  
  // Russia
  235: 'RU',
  
  // USA
  253: 'US', 254: 'US',
  
  // Mexico
  262: 'MX', 263: 'MX',
  
  // Brazil
  71: 'BR', 72: 'BR',
  
  // Argentina
  128: 'AR', 129: 'AR',
  
  // Colombia
  239: 'CO',
  
  // Chile
  265: 'CL',
  
  // Uruguay
  274: 'UY',
  
  // Paraguay
  250: 'PY',
  
  // Ecuador
  242: 'EC',
  
  // Japan
  98: 'JP', 99: 'JP',
  
  // South Korea
  292: 'KR',
  
  // Australia
  188: 'AU',
  
  // China
  17: 'CN',
  
  // Saudi Arabia
  307: 'SA',
  
  // UAE
  301: 'AE',
  
  // Qatar
  305: 'QA',
  
  // South Africa
  288: 'ZA',
  
  // Egypt
  233: 'EG',
  
  // Morocco
  200: 'MA',
  
  // Algeria
  185: 'DZ',
  
  // Tunisia
  202: 'TN',
  
  // Israel
  383: 'IL',
  
  // Iceland
  165: 'IS',
  
  // Finland
  244: 'FI',
};

/**
 * International competitions that should have country_id = NULL
 */
export const INTERNATIONAL_LEAGUE_IDS = [5, 1, 4, 960, 32, 34, 33, 31, 29, 30, 9, 36, 964, 2, 3, 848];

/**
 * Domestic cup competition IDs
 * These are fully supported like regular leagues in all pipelines
 */
export const CUP_LEAGUE_IDS = [
  45,   // England FA Cup
  48,   // England EFL Cup (League Cup / Carabao Cup)
  143,  // Spain Copa del Rey
  137,  // Italy Coppa Italia
  81,   // Germany DFB-Pokal
  66,   // France Coupe de France
] as const;

export const LEAGUE_NAMES: Record<number, string> = {
  // International
  5: "UEFA Nations League",
  1: "World Cup",
  4: "UEFA Euro Championship",
  960: "UEFA Euro Championship Qualification",
  32: "World Cup Qualification (Africa)",
  34: "World Cup Qualification (Asia)",
  33: "World Cup Qualification (Oceania)",
  31: "World Cup Qualification (South America)",
  29: "World Cup Qualification (CONCACAF)",
  30: "World Cup Qualification (Europe)",
  9: "Copa América",
  36: "AFCON Qualification",
  964: "Africa Cup of Nations",
  
  // UEFA Club Competitions
  2: "UEFA Champions League",
  3: "UEFA Europa League",
  848: "UEFA Europa Conference League",
  
  // Domestic Cups
  45: "FA Cup",
  48: "EFL Cup (Carabao Cup)",
  143: "Copa del Rey",
  137: "Coppa Italia",
  81: "DFB-Pokal",
  66: "Coupe de France",
  
  // England
  39: "Premier League",
  40: "Championship",
  41: "League One",
  42: "League Two",
  43: "National League",
  50: "National League - North",
  51: "National League - South",
  667: "Premier League 2 Division One",
  
  // Spain
  140: "La Liga",
  141: "La Liga 2",
  435: "Primera RFEF - Group 1",
  436: "Primera RFEF - Group 2",
  663: "Primera División Femenina",
  
  // Italy
  135: "Serie A",
  136: "Serie B",
  269: "Serie C - Girone A",
  
  // Germany
  78: "Bundesliga",
  79: "2. Bundesliga",
  80: "3. Liga",
  
  // France
  61: "Ligue 1",
  62: "Ligue 2",
  556: "National 1",
  
  // Netherlands
  88: "Eredivisie",
  89: "Eerste Divisie",
  
  // Portugal
  94: "Primeira Liga",
  95: "Liga Portugal 2",
  
  // Turkey
  203: "Super Lig",
  204: "1. Lig",
  
  // Belgium
  144: "Pro League",
  145: "Challenger Pro League",
  
  // Scotland
  179: "Premiership",
  180: "Championship",
  
  // Austria
  218: "Bundesliga",
  219: "2. Liga",
  
  // Switzerland
  207: "Super League",
  208: "Challenge League",
  
  // Greece
  197: "Super League",
  198: "Super League 2",
  
  // Denmark
  119: "Superliga",
  
  // Norway
  103: "Eliteserien",
  
  // Sweden
  113: "Allsvenskan",
  114: "Superettan",
  
  // Poland
  106: "Ekstraklasa",
  107: "I Liga",
  
  // Czech Republic
  345: "First League",
  
  // Romania
  283: "Liga I",
  
  // Croatia
  210: "HNL",
  
  // Serbia
  286: "Super Liga",
  
  // Bulgaria
  172: "First League",
  
  // Hungary
  271: "NB I",
  
  // Ukraine
  333: "Premier League",
  
  // Russia
  235: "Premier League",
  
  // USA
  253: "MLS",
  254: "USL Championship",
  
  // Mexico
  262: "Liga MX",
  263: "Liga de Expansion",
  
  // Brazil
  71: "Serie A",
  72: "Serie B",
  
  // Argentina
  128: "Liga Profesional",
  129: "Primera B",
  
  // Colombia
  239: "Primera A",
  
  // Chile
  265: "Primera Division",
  
  // Uruguay
  274: "Primera Division",
  
  // Paraguay
  250: "Division Profesional",
  
  // Ecuador
  242: "Serie A",
  
  // Japan
  98: "J1 League",
  99: "J2 League",
  
  // South Korea
  292: "K League 1",
  
  // Australia
  188: "A-League",
  
  // China
  17: "Super League",
  
  // Saudi Arabia
  307: "Pro League",
  
  // UAE
  301: "Pro League",
  
  // Qatar
  305: "Stars League",
  
  // South Africa
  288: "Premier Division",
  
  // Egypt
  233: "Premier League",
  
  // Morocco
  200: "Botola Pro",
  
  // Algeria
  185: "Ligue 1",
  
  // Tunisia
  202: "Ligue Professionnelle 1",
  
  // Israel
  383: "Ligat ha'Al",
  
  // Iceland
  165: "Úrvalsdeild",
  
  // Finland
  244: "Veikkausliiga",
};

// Markets that are commonly available across leagues
// Lower divisions may have fewer markets - we'll auto-detect and skip unavailable ones
/**
 * Helper function to get country_id for a league from Supabase
 * Uses the deterministic LEAGUE_TO_COUNTRY_CODE mapping
 * 
 * @param leagueId - The API league ID
 * @param supabaseClient - Supabase client instance
 * @returns country_id (number) or null for international leagues
 */
export async function getCountryIdForLeague(
  leagueId: number, 
  supabaseClient: any
): Promise<number | null> {
  // International leagues always return null
  if (INTERNATIONAL_LEAGUE_IDS.includes(leagueId)) {
    return null;
  }
  
  // Get country code from mapping
  const countryCode = LEAGUE_TO_COUNTRY_CODE[leagueId];
  if (!countryCode) {
    console.warn(`[getCountryIdForLeague] No country mapping for league ${leagueId}`);
    return null;
  }
  
  // Look up country_id from database
  const { data: country, error } = await supabaseClient
    .from('countries')
    .select('id')
    .eq('code', countryCode)
    .single();
  
  if (error || !country) {
    console.error(`[getCountryIdForLeague] Failed to find country with code ${countryCode}:`, error);
    return null;
  }
  
  return country.id;
}

export const COMMON_MARKETS = ["goals", "corners", "cards"] as const;
export const OPTIONAL_MARKETS = ["fouls", "offsides"] as const;
