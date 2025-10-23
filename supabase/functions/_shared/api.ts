// Shared API client for API-Football Direct API
// Uses the direct API-Football endpoint (https://v3.football.api-sports.io)

export function apiHeaders(): Record<string, string> {
  const key = Deno.env.get("API_FOOTBALL_KEY") ?? "";
  if (!key) {
    throw new Error("[api] Missing API_FOOTBALL_KEY environment variable");
  }
  console.log("[api] Using API-Sports direct endpoint with x-apisports-key");
  return {
    "x-apisports-key": key
  };
}

export const API_BASE = "https://v3.football.api-sports.io";
