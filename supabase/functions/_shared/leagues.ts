/**
 * League allowlist for fixture fetching
 * Only top divisions + selected 2nd tiers from allowed countries
 */

export const ALLOWED_LEAGUE_IDS = [
  // England (9 leagues)
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

export const LEAGUE_NAMES: Record<number, string> = {
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
export const COMMON_MARKETS = ["goals", "corners", "cards"] as const;
export const OPTIONAL_MARKETS = ["fouls", "offsides"] as const;
