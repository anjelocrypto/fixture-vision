/** Use the database-owned entitlement predicate everywhere. */
export async function userHasProductAccess(userClient: any): Promise<boolean> {
  const { data: entitled, error: entitlementError } = await userClient.rpc("user_has_access");
  if (entitlementError) {
    throw new Error(`Entitlement check failed: ${entitlementError.message}`);
  }
  if (entitled === true) return true;

  const { data: whitelisted, error: whitelistError } = await userClient.rpc("is_user_whitelisted");
  if (whitelistError) {
    throw new Error(`Admin access check failed: ${whitelistError.message}`);
  }
  return whitelisted === true;
}
