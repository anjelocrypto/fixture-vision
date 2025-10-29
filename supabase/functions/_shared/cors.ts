/**
 * Robust CORS handling for admin edge functions
 * Returns origin-specific headers to avoid wildcard issues
 */

const ALLOWED_ORIGINS = [
  'https://ticketai.bet',
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
function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  
  // Check exact matches
  if (ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }
  
  // Check pattern matches
  return ALLOWED_ORIGIN_PATTERNS.some(pattern => pattern.test(origin));
}

/**
 * Get CORS headers for the given request origin
 * Returns the specific origin if allowed, otherwise uses default
 */
export function getCorsHeaders(origin: string | null): HeadersInit {
  const allowedOrigin = isOriginAllowed(origin) ? origin : 'https://ticketai.bet';
  
  return {
    'Access-Control-Allow-Origin': allowedOrigin!,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400', // 24 hours
    'Vary': 'Origin',
  };
}

/**
 * Handle preflight OPTIONS request
 */
export function handlePreflight(origin: string | null): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/**
 * Create a JSON response with CORS headers
 */
export function jsonResponse(
  data: unknown,
  origin: string | null,
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...getCorsHeaders(origin),
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
  status = 500
): Response {
  return jsonResponse({ success: false, error: message }, origin, status);
}
