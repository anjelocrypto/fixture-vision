// ============================================================================
// Shared Auth Helper for Edge Functions
// ============================================================================
// CRITICAL: Do NOT use .single() on scalar-returning RPC functions!
// - get_cron_internal_key returns TEXT (scalar), not a row
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
 * 3. Admin user JWT with an explicit admin role
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
  if (serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`) {
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
      
      if (providedKey && expectedKey && constantTimeEqual(providedKey, expectedKey)) {
        console.log(`${logPrefix} Authorized via X-CRON-KEY`);
        return { authorized: true, method: "cron_key" };
      } else {
        console.warn(`${logPrefix} X-CRON-KEY provided but did not match`);
      }
    }
  }

  // Method 3: Admin user via JWT and the database-backed role table.
  if (authHeader) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    
    if (supabaseUrl && anonKey) {
      try {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } }
        });
        
        const { data: { user }, error: userError } = await userClient.auth.getUser();
        if (userError || !user) {
          console.error(`${logPrefix} Admin JWT validation failed:`, userError);
          return { authorized: false, method: "none", error: "invalid_admin_jwt" };
        }

        const { data: hasAdminRole, error: roleError } = await userClient.rpc("has_role", {
          _user_id: user.id,
          _role: "admin",
        });

        if (roleError) {
          console.error(`${logPrefix} has_role error:`, roleError);
        } else if (hasAdminRole === true) {
          console.log(`${logPrefix} Authorized via admin role`);
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

function constantTimeEqual(provided: string, expected: string): boolean {
  const maxLength = Math.max(provided.length, expected.length);
  let mismatch = provided.length ^ expected.length;

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (provided.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }

  return mismatch === 0;
}
