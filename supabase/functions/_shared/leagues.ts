/**
 * League allowlist for fixture fetching
 * Only top divisions + selected 2nd tiers from allowed countries
 */

export const ALLOWED_LEAGUE_IDS = [
  // England
  39,   // Premier League
  40,   // Championship
  
  // Spain
  140,  // La Liga
  141,  // La Liga 2
  
  // Italy
  135,  // Serie A
  136,  // Serie B
  
  // Germany
  78,   // Bundesliga
  79,   // 2. Bundesliga
  
  // France
  61,   // Ligue 1
  62,   // Ligue 2
  
  // Netherlands
  88,   // Eredivisie
  
  // Portugal
  94,   // Primeira Liga
  
  // Turkey
  203,  // Super Lig
  
  // Belgium
  144,  // Pro League
  
  // Scotland
  179,  // Premiership
  
  // USA
  253,  // MLS
  
  // Brazil
  71,   // Serie A
  
  // Argentina
  128,  // Liga Profesional
];

export const LEAGUE_NAMES: Record<number, string> = {
  39: "Premier League",
  40: "Championship",
  140: "La Liga",
  141: "La Liga 2",
  135: "Serie A",
  136: "Serie B",
  78: "Bundesliga",
  79: "2. Bundesliga",
  61: "Ligue 1",
  62: "Ligue 2",
  88: "Eredivisie",
  94: "Primeira Liga",
  203: "Super Lig",
  144: "Pro League",
  179: "Premiership",
  253: "MLS",
  71: "Serie A",
  128: "Liga Profesional",
};
