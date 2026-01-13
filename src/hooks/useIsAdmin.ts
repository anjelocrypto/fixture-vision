import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WHITELIST_EMAILS } from "@/lib/constants";

export function useIsAdmin() {
  return useQuery({
    queryKey: ["is-admin"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) return false;

      // Check whitelist first (case-insensitive)
      const isWhitelisted = WHITELIST_EMAILS.some(
        (email) => email.toLowerCase() === user.email?.toLowerCase()
      );
      if (isWhitelisted) return true;

      // Fall back to DB role check
      const { data: isAdmin, error } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });

      if (error) {
        console.error("[useIsAdmin] Error checking admin role:", error);
        return false;
      }

      return !!isAdmin;
    },
    staleTime: 5 * 60 * 1000,
  });
}
