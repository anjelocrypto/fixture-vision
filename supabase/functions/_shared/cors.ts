/**
 * Robust CORS handling for admin edge functions
 * Returns origin-specific headers to avoid wildcard issues
 */

const ALLOWED_ORIGINS = [
  'https://ticketai.bet',
  'https://www.ticketai.bet',
  'https://fixtozirispt.net',
  'https://www.fixtozirispt.net',
  'https://fixture-vision.lovable.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8080',
];

// Patterns for dynamic origins (Lovable preview URLs)
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/.*\.lovableproject\.com$/,
  /^https:\/\/preview--.*\.lovable\.app$/,
  /^https:\/\/.*--.*\.lovable\.app$/,
];

/**
 * Check if an origin is allowed
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  
  // Check exact matches
  if (ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }
  
  // Check pattern matches
  return ALLOWED_ORIGIN_PATTERNS.some(pattern => pattern.test(origin));
}

/**
 * Get CORS headers for the given request origin.
 * - Echoes known allowed origins (ticketai.bet, preview envs)
 * - Allows "*" only when there is no browser Origin header
 * - Omits Access-Control-Allow-Origin for disallowed browser origins
 */
export function getCorsHeaders(origin: string | null, _request?: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-cron-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Max-Age": "86400", // 24 hours
    Vary: "Origin",
  };

  if (!origin) {
    headers["Access-Control-Allow-Origin"] = "*";
  } else if (isOriginAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

/**
 * Handle preflight OPTIONS request
 */
export function handlePreflight(origin: string | null, request?: Request): Response {
  if (origin && !isOriginAllowed(origin)) {
    return new Response(null, {
      status: 403,
      headers: { Vary: "Origin" },
    });
  }

  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin, request),
  });
}

/**
 * Create a JSON response with CORS headers
 */
export function jsonResponse(
  data: unknown,
  origin: string | null,
  status = 200,
  request?: Request
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...getCorsHeaders(origin, request),
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Create an error response with CORS headers
 */
export function errorResponse(
  message: string,
  origin: string | null,
  status = 500,
  request?: Request
): Response {
  return jsonResponse({ ok: false, success: false, error: message }, origin, status, request);
}
