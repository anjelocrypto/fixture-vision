import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const useAccess = () => {
  const [hasAccess, setHasAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [entitlement, setEntitlement] = useState<any>(null);
  const [isWhitelisted, setIsWhitelisted] = useState(false);
  const [trialCredits, setTrialCredits] = useState<number | null>(null);

  const checkAccess = async () => {
    try {
      setLoading(true);
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setHasAccess(false);
        setEntitlement(null);
        setIsWhitelisted(false);
        setTrialCredits(null);
        return;
      }

      // Check whitelist status
      const { data: whitelistData, error: whitelistError } = await supabase.rpc('is_user_whitelisted');
      const whitelisted = whitelistError ? false : (whitelistData || false);
      setIsWhitelisted(whitelisted);

      // Get trial credits
      const { data: creditsData, error: creditsError } = await supabase.rpc('get_trial_credits');
      const credits = creditsError ? null : (creditsData ?? null);
      setTrialCredits(credits);

      // Query user_entitlements directly
      const { data, error } = await supabase
        .from("user_entitlements")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (error) {
        console.error("[useAccess] Error fetching entitlement:", error);
        setHasAccess(whitelisted); // Whitelist overrides
        setEntitlement(null);
        return;
      }

      if (data) {
        // Check if active and not expired
        const isActive = data.status === "active" && new Date(data.current_period_end) > new Date();
        setHasAccess(isActive || whitelisted);
        setEntitlement(data);
      } else {
        setHasAccess(whitelisted);
        setEntitlement(null);
      }
    } catch (error) {
      console.error("[useAccess] Error:", error);
      setHasAccess(false);
      setEntitlement(null);
      setIsWhitelisted(false);
      setTrialCredits(null);
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

  return { 
    hasAccess, 
    loading, 
    entitlement, 
    isWhitelisted, 
    trialCredits,
    refreshAccess: checkAccess 
  };
};
