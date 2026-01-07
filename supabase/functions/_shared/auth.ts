// ============================================================================
// Shared Auth Helper for Edge Functions
// ============================================================================
// CRITICAL: Do NOT use .single() on scalar-returning RPC functions!
// - get_cron_internal_key returns TEXT (scalar), not a row
// - is_user_whitelisted returns BOOLEAN (scalar), not a row
// Using .single() on scalar RPCs causes auth to SILENTLY FAIL.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

export interface AuthResult {
  authorized: boolean;
  method: "service_role" | "cron_key" | "admin_user" | "none";
  error?: string;
}

/**
 * Checks authorization for admin/cron edge functions.
 * Supports three auth methods:
 * 1. Service role bearer token
 * 2. X-CRON-KEY header matching app_settings value
 * 3. Admin user JWT with is_user_whitelisted = true
 * 
 * @param req - The incoming request
 * @param supabase - Service role Supabase client
 * @param serviceRoleKey - Service role key from env
 * @param logPrefix - Prefix for log messages (e.g., "[results-refresh]")
 * @returns AuthResult with authorized status and method used
 */
export async function checkCronOrAdminAuth(
  req: Request,
  supabase: any,
  serviceRoleKey: string,
  logPrefix: string = "[auth]"
): Promise<AuthResult> {
  // Case-insensitive header handling
  const cronKeyHeader = req.headers.get("x-cron-key") ?? req.headers.get("X-CRON-KEY");
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");

  // Method 1: Service role bearer token
  if (authHeader === `Bearer ${serviceRoleKey}`) {
    console.log(`${logPrefix} Authorized via service role bearer`);
    return { authorized: true, method: "service_role" };
  }

  // Method 2: X-CRON-KEY header (NO .single()!)
  if (cronKeyHeader) {
    const { data: dbKey, error: keyError } = await supabase.rpc("get_cron_internal_key");
    
    if (keyError) {
      console.error(`${logPrefix} get_cron_internal_key error:`, keyError);
      // Don't fail entirely - allow fallback to other auth methods
    } else {
      // Ensure both are strings and trimmed for safe comparison
      const expectedKey = String(dbKey || "").trim();
      const providedKey = String(cronKeyHeader || "").trim();
      
      if (providedKey && expectedKey && providedKey === expectedKey) {
        console.log(`${logPrefix} Authorized via X-CRON-KEY`);
        return { authorized: true, method: "cron_key" };
      } else {
        console.warn(`${logPrefix} X-CRON-KEY provided but did not match`);
      }
    }
  }

  // Method 3: Admin user via JWT (NO .single()!)
  if (authHeader) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    
    if (supabaseUrl && anonKey) {
      try {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } }
        });
        
        const { data: isWhitelisted, error: wlError } = await userClient.rpc("is_user_whitelisted");
        
        if (wlError) {
          console.error(`${logPrefix} is_user_whitelisted error:`, wlError);
        } else if (isWhitelisted === true) {
          console.log(`${logPrefix} Authorized via admin user whitelist`);
          return { authorized: true, method: "admin_user" };
        }
      } catch (e) {
        console.error(`${logPrefix} Admin user auth check failed:`, e);
      }
    }
  }

  console.error(`${logPrefix} Authorization failed - no valid auth method matched`);
  return { authorized: false, method: "none" };
}
