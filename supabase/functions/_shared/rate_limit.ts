// ============================================================================
// Per-User Rate Limiting Helper
// ============================================================================
// Provides simple per-user, per-feature, per-minute rate limiting backed by DB.
// Uses user_rate_limits table with (user_id, feature, window_start) as PK.
// ============================================================================

export type RateLimitFeature = "filterizer" | "ticket_creator" | "analyzer";

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
    // Calculate current minute window (truncated to minute)
    const now = new Date();
    const windowStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      0,
      0
    );
    const windowStartISO = windowStart.toISOString();
    
    // Try to fetch existing rate limit record
    const { data: existing, error: fetchError } = await supabase
      .from("user_rate_limits")
      .select("count")
      .eq("user_id", userId)
      .eq("feature", feature)
      .eq("window_start", windowStartISO)
      .maybeSingle();
    
    if (fetchError) {
      console.error(`[rate-limit] Fetch error for ${feature}/${userId}:`, fetchError);
      // On fetch error, fail open (allow) to avoid blocking legitimate users
      return { allowed: true };
    }
    
    const currentCount = existing?.count || 0;
    
    if (currentCount >= maxPerMinute) {
      // Rate limit exceeded - calculate retry time
      const secondsIntoMinute = now.getSeconds();
      const retryAfterSeconds = 60 - secondsIntoMinute;
      
      console.warn(`[rate-limit] EXCEEDED: ${feature}/${userId} count=${currentCount}/${maxPerMinute}, retry in ${retryAfterSeconds}s`);
      
      return {
        allowed: false,
        retryAfterSeconds,
        currentCount,
      };
    }
    
    // Increment or insert rate limit record
    if (existing) {
      // Update existing record
      const { error: updateError } = await supabase
        .from("user_rate_limits")
        .update({ count: currentCount + 1 })
        .eq("user_id", userId)
        .eq("feature", feature)
        .eq("window_start", windowStartISO);
      
      if (updateError) {
        console.error(`[rate-limit] Update error for ${feature}/${userId}:`, updateError);
        // On update error, still allow (fail open)
        return { allowed: true };
      }
    } else {
      // Insert new record
      const { error: insertError } = await supabase
        .from("user_rate_limits")
        .insert({
          user_id: userId,
          feature,
          window_start: windowStartISO,
          count: 1,
        });
      
      if (insertError) {
        // Handle race condition (duplicate key) gracefully
        if (insertError.code === "23505") {
          // Another request beat us - try increment instead
          const { error: retryUpdateError } = await supabase
            .from("user_rate_limits")
            .update({ count: currentCount + 1 })
            .eq("user_id", userId)
            .eq("feature", feature)
            .eq("window_start", windowStartISO);
          
          if (retryUpdateError) {
            console.error(`[rate-limit] Retry update error:`, retryUpdateError);
          }
        } else {
          console.error(`[rate-limit] Insert error for ${feature}/${userId}:`, insertError);
        }
        // Still allow on error (fail open)
        return { allowed: true };
      }
    }
    
    console.log(`[rate-limit] OK: ${feature}/${userId} count=${currentCount + 1}/${maxPerMinute}`);
    
    return {
      allowed: true,
      currentCount: currentCount + 1,
    };
    
  } catch (error) {
    console.error(`[rate-limit] Unexpected error for ${feature}/${userId}:`, error);
    // Fail open on unexpected errors
    return { allowed: true };
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
