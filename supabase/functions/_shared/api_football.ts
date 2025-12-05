// ============================================================================
// Centralized API-Football Rate Limiter & Client
// ============================================================================
// Single source of truth for all API-Football requests with:
// - Configurable rate limiting (RPM via env)
// - Token bucket algorithm for request tracking
// - Exponential backoff on 429 errors
// - Structured logging for debugging
// ============================================================================

import { API_BASE, apiHeaders } from "./api.ts";

// Configuration via environment (tunable per plan)
const DEFAULT_MAX_RPM = 50;  // Safe default for most plans
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

// Token bucket state (in-memory, resets per invocation)
interface RateLimiterState {
  requests: number;
  windowStart: number;
  lastRequestTime: number;
}

const state: RateLimiterState = {
  requests: 0,
  windowStart: Date.now(),
  lastRequestTime: 0,
};

// Get configured max RPM from env
function getMaxRPM(): number {
  const envRPM = Deno.env.get("STATS_API_MAX_RPM");
  if (envRPM) {
    const parsed = parseInt(envRPM, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_MAX_RPM;
}

// Calculate minimum delay between requests based on RPM
function getMinDelayMs(): number {
  const maxRPM = getMaxRPM();
  return Math.ceil(60000 / maxRPM);  // e.g., 50 RPM = 1200ms delay
}

// Wait if we're hitting rate limit
async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const maxRPM = getMaxRPM();
  const minDelay = getMinDelayMs();
  
  // Reset window if minute has passed
  if (now - state.windowStart >= 60000) {
    state.requests = 0;
    state.windowStart = now;
  }
  
  // If we've hit the limit, wait for window reset
  if (state.requests >= maxRPM) {
    const waitTime = 60000 - (now - state.windowStart) + 100;
    console.log(`[api-football] Rate limit reached (${state.requests}/${maxRPM}), waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    state.requests = 0;
    state.windowStart = Date.now();
  }
  
  // Enforce minimum delay between requests
  const timeSinceLastRequest = now - state.lastRequestTime;
  if (timeSinceLastRequest < minDelay && state.lastRequestTime > 0) {
    const delay = minDelay - timeSinceLastRequest;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  state.lastRequestTime = Date.now();
  state.requests++;
}

// Structured logging for API requests
function logRequest(url: string, status: number, retryCount: number, durationMs: number): void {
  const level = status === 200 ? "info" : status === 429 ? "warn" : "error";
  const endpoint = url.replace(API_BASE, "").split("?")[0];
  console.log(`[api-football] ${level.toUpperCase()}: ${endpoint} status=${status} retry=${retryCount} duration=${durationMs}ms rpm=${state.requests}`);
}

// Main fetch function with rate limiting and retries
export async function fetchAPIFootball(
  endpoint: string,
  options: {
    maxRetries?: number;
    skipRateLimit?: boolean;
    logPrefix?: string;
  } = {}
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const prefix = options.logPrefix ?? "[api-football]";
  
  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Apply rate limiting unless skipped
      if (!options.skipRateLimit) {
        await waitForRateLimit();
      }
      
      const startTime = Date.now();
      const response = await fetch(url, { headers: apiHeaders() });
      const durationMs = Date.now() - startTime;
      
      logRequest(url, response.status, attempt, durationMs);
      
      // Handle rate limiting (429)
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("Retry-After") || "60", 10);
        const delay = Math.min(
          Math.max(retryAfter * 1000, BASE_DELAY_MS * Math.pow(2, attempt)),
          60000
        );
        console.warn(`${prefix} 429 Too Many Requests, waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Handle server errors (5xx)
      if (response.status >= 500) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
        console.warn(`${prefix} Server error ${response.status}, waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // Success or client error - parse response
      const data = await response.json().catch(() => null);
      
      return {
        ok: response.ok,
        status: response.status,
        data: data?.response ?? data,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`${prefix} Network error on attempt ${attempt + 1}/${maxRetries}: ${errorMsg}`);
      
      if (attempt < maxRetries) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      return {
        ok: false,
        status: 0,
        data: null,
        error: `Network error: ${errorMsg}`,
      };
    }
  }
  
  return {
    ok: false,
    status: 0,
    data: null,
    error: `Failed after ${maxRetries} retries`,
  };
}

// Convenience methods for common endpoints
export async function fetchFixtures(params: {
  league?: number;
  season?: number;
  team?: number;
  status?: string;
  last?: number;
  from?: string;
  to?: string;
}): Promise<any[]> {
  const queryParams = new URLSearchParams();
  if (params.league) queryParams.set("league", String(params.league));
  if (params.season) queryParams.set("season", String(params.season));
  if (params.team) queryParams.set("team", String(params.team));
  if (params.status) queryParams.set("status", params.status);
  if (params.last) queryParams.set("last", String(params.last));
  if (params.from) queryParams.set("from", params.from);
  if (params.to) queryParams.set("to", params.to);
  
  const result = await fetchAPIFootball(`/fixtures?${queryParams.toString()}`);
  return result.ok ? (result.data || []) : [];
}

export async function fetchFixtureById(fixtureId: number): Promise<any | null> {
  const result = await fetchAPIFootball(`/fixtures?id=${fixtureId}`);
  return result.ok && result.data?.length ? result.data[0] : null;
}

export async function fetchFixtureStatistics(fixtureId: number): Promise<any[]> {
  const result = await fetchAPIFootball(`/fixtures/statistics?fixture=${fixtureId}`);
  return result.ok ? (result.data || []) : [];
}

export async function fetchH2H(team1Id: number, team2Id: number, last = 5): Promise<any[]> {
  const result = await fetchAPIFootball(`/fixtures/headtohead?h2h=${team1Id}-${team2Id}&last=${last}`);
  return result.ok ? (result.data || []) : [];
}

// Get current rate limiter stats (for monitoring)
export function getRateLimiterStats(): {
  requestsThisMinute: number;
  maxRPM: number;
  windowStarted: Date;
} {
  return {
    requestsThisMinute: state.requests,
    maxRPM: getMaxRPM(),
    windowStarted: new Date(state.windowStart),
  };
}
