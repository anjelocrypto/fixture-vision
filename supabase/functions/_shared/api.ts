// Shared API client for API-Football (supports both RapidAPI and direct)

export function apiHeaders(): Record<string, string> {
  const key = Deno.env.get("API_FOOTBALL_KEY") ?? "";
  
  // Simple heuristic: RapidAPI keys are typically longer
  const isRapid = key.length > 40;
  
  if (isRapid) {
    return {
      "x-rapidapi-key": key,
      "x-rapidapi-host": "api-football-v1.p.rapidapi.com"
    };
  } else {
    return {
      "x-apisports-key": key
    };
  }
}

export const API_BASE = "https://api-football-v1.p.rapidapi.com/v3";
