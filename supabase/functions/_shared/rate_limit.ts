// ============================================================================
// Per-User Rate Limiting Helper
// ============================================================================
// Provides atomic per-user, per-feature, per-minute rate limiting backed by DB.
// ============================================================================

export type RateLimitFeature = "filterizer" | "ticket_creator" | "analyzer" | "shuffle_ticket" | "calculate_value" | "safe_zone" | "safe_zone_chat" | "card_war" | "who_concedes" | "btts_index";

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  currentCount?: number;
}

/**
 * Check and enforce rate limiting for a user/feature combination.
 * 
 * @param supabase - Service role Supabase client
 * @param userId - The authenticated user's ID
 * @param feature - Feature key (filterizer, ticket_creator, analyzer)
 * @param maxPerMinute - Maximum requests allowed per minute
 * @returns RateLimitResult with allowed status and retry info
 */
export async function checkUserRateLimit(options: {
  supabase: any;
  userId: string;
  feature: RateLimitFeature;
  maxPerMinute: number;
}): Promise<RateLimitResult> {
  const { supabase, userId, feature, maxPerMinute } = options;
  
  try {
    const { data, error } = await supabase.rpc("consume_rate_limit", {
      p_user_id: userId,
      p_feature: feature,
      p_max_per_minute: maxPerMinute,
    });

    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== "boolean") {
      throw new Error("Invalid rate-limit response");
    }

    return {
      allowed: row.allowed,
      currentCount: Number(row.current_count ?? 0),
      retryAfterSeconds: row.allowed ? undefined : Number(row.retry_after_seconds ?? 60),
    };
  } catch (error) {
    // Expensive endpoints fail closed when the limiter is unavailable. This
    // prevents an outage or contention event from becoming an unbounded cost.
    console.error(`[rate-limit] Atomic limiter failed for ${feature}:`, error);
    return { allowed: false, retryAfterSeconds: 60 };
  }
}

/**
 * Build a standardized 429 rate limit response.
 */
export function buildRateLimitResponse(
  feature: RateLimitFeature,
  retryAfterSeconds: number,
  corsHeaders: Record<string, string>
): Response {
  return new Response(
    JSON.stringify({
      code: "RATE_LIMITED",
      feature,
      message: "Too many requests. Please wait a bit and try again.",
      retry_after_seconds: retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    }
  );
}
