/**
 * League allowlist for fixture fetching
 * Only top divisions + selected 2nd tiers from allowed countries
 */

export const ALLOWED_LEAGUE_IDS = [
  // England
  39,   // Premier League
  40,   // Championship
  41,   // League One
  42,   // League Two
  43,   // National League
  
  // Spain
  140,  // La Liga
  141,  // La Liga 2
  435,  // Primera RFEF - Group 1
  436,  // Primera RFEF - Group 2
  
  // Italy
  135,  // Serie A
  136,  // Serie B
  
  // Germany
  78,   // Bundesliga
  79,   // 2. Bundesliga
  80,   // 3. Liga
  
  // France
  61,   // Ligue 1
  62,   // Ligue 2
  556,  // National 1
  
  // Netherlands
  88,   // Eredivisie
  89,   // Eerste Divisie
  
  // Portugal
  94,   // Primeira Liga
  95,   // Liga Portugal 2
  
  // Turkey
  203,  // Super Lig
  204,  // 1. Lig
  
  // Belgium
  144,  // Pro League
  145,  // Challenger Pro League
  
  // Scotland
  179,  // Premiership
  180,  // Championship
  
  // Austria
  218,  // Bundesliga
  219,  // 2. Liga
  
  // Switzerland
  207,  // Super League
  
  // Greece
  197,  // Super League
  
  // Denmark
  119,  // Superliga
  
  // Norway
  103,  // Eliteserien
  
  // Sweden
  113,  // Allsvenskan
  
  // USA
  253,  // MLS
  
  // Brazil
  71,   // Serie A
  
  // Argentina
  128,  // Liga Profesional
];

export const LEAGUE_NAMES: Record<number, string> = {
  // England
  39: "Premier League",
  40: "Championship",
  41: "League One",
  42: "League Two",
  43: "National League",
  
  // Spain
  140: "La Liga",
  141: "La Liga 2",
  435: "Primera RFEF - Group 1",
  436: "Primera RFEF - Group 2",
  
  // Italy
  135: "Serie A (Italy)",
  136: "Serie B",
  
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
  218: "Bundesliga (Austria)",
  219: "2. Liga",
  
  // Switzerland
  207: "Super League",
  
  // Greece
  197: "Super League",
  
  // Denmark
  119: "Superliga",
  
  // Norway
  103: "Eliteserien",
  
  // Sweden
  113: "Allsvenskan",
  
  // USA
  253: "MLS",
  
  // Brazil
  71: "Serie A (Brazil)",
  
  // Argentina
  128: "Liga Profesional",
};

// Markets that are commonly available across leagues
// Lower divisions may have fewer markets - we'll auto-detect and skip unavailable ones
export const COMMON_MARKETS = ["goals", "corners", "cards"] as const;
export const OPTIONAL_MARKETS = ["fouls", "offsides"] as const;
