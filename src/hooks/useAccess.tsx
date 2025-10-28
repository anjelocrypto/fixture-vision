import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useAccess = () => {
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [entitlement, setEntitlement] = useState<any>(null);

  const checkAccess = async () => {
    try {
      setLoading(true);
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setHasAccess(false);
        setEntitlement(null);
        return;
      }

      // Query user_entitlements directly
      const { data, error } = await supabase
        .from("user_entitlements")
        .select("*")
        .eq("user_id", session.user.id)
        .single();

      if (error && error.code !== "PGRST116") {
        console.error("[useAccess] Error fetching entitlement:", error);
        setHasAccess(false);
        setEntitlement(null);
        return;
      }

      if (data) {
        // Check if active and not expired
        const isActive = data.status === "active" && new Date(data.current_period_end) > new Date();
        setHasAccess(isActive);
        setEntitlement(data);
      } else {
        setHasAccess(false);
        setEntitlement(null);
      }
    } catch (error) {
      console.error("[useAccess] Error:", error);
      setHasAccess(false);
      setEntitlement(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAccess();

    // Poll every 5 minutes
    const interval = setInterval(checkAccess, 5 * 60 * 1000);

    // Re-check on visibility change
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkAccess();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return { hasAccess, loading, entitlement, refreshAccess: checkAccess };
};
