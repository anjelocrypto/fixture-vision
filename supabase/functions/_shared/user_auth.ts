import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export interface UserAuthResult {
  authorized: boolean;
  user?: User;
  client?: SupabaseClient;
  error?: string;
}

export async function authenticateUser(
  req: Request,
  logPrefix = "[user-auth]",
): Promise<UserAuthResult> {
  const authHeader = req.headers.get("authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!authHeader?.startsWith("Bearer ")) {
    return { authorized: false, error: "missing_authorization" };
  }

  if (!supabaseUrl || !anonKey) {
    console.error(`${logPrefix} Missing Supabase user-auth configuration`);
    return { authorized: false, error: "server_auth_not_configured" };
  }

  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) {
    console.warn(`${logPrefix} Invalid user token`, error);
    return { authorized: false, error: "invalid_authorization" };
  }

  return { authorized: true, user, client };
}

export async function authenticateEntitledUser(
  req: Request,
  logPrefix = "[user-auth]",
): Promise<UserAuthResult> {
  const auth = await authenticateUser(req, logPrefix);
  if (!auth.authorized || !auth.client) {
    return auth;
  }

  const { data: hasAccess, error } = await auth.client.rpc("user_has_access");
  if (error) {
    console.error(`${logPrefix} Entitlement check failed`, error);
    return { authorized: false, error: "entitlement_check_failed" };
  }

  if (hasAccess !== true) {
    return { authorized: false, error: "premium_access_required" };
  }

  return auth;
}
