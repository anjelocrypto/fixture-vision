// Shared API client for API-Football (supports both RapidAPI and direct)

const key = Deno.env.get("API_FOOTBALL_KEY") ?? "";

// Simple heuristic: RapidAPI keys are typically longer
const isRapid = key.length > 40;

export function apiHeaders(): Record<string, string> {
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

export const API_BASE = isRapid 
  ? "https://api-football-v1.p.rapidapi.com/v3"
  : "https://v3.football.api-sports.io";
