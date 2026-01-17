import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface UsernameState {
  username: string;
  isValid: boolean;
  isAvailable: boolean | null;
  isChecking: boolean;
  error: string | null;
  canChange: boolean;
  hoursUntilChange: number | null;
}

export function useUsername() {
  const { toast } = useToast();
  const [state, setState] = useState<UsernameState>({
    username: "",
    isValid: false,
    isAvailable: null,
    isChecking: false,
    error: null,
    canChange: true,
    hoursUntilChange: null,
  });

  // Validate format: 3-20 chars, alphanumeric + underscore
  const validateFormat = useCallback((value: string): { valid: boolean; error: string | null } => {
    const trimmed = value.trim().toLowerCase();
    
    if (trimmed.length === 0) {
      return { valid: false, error: null };
    }
    
    if (trimmed.length < 3) {
      return { valid: false, error: "Username must be at least 3 characters" };
    }
    
    if (trimmed.length > 20) {
      return { valid: false, error: "Username must be at most 20 characters" };
    }
    
    if (!/^[a-z0-9_]+$/.test(trimmed)) {
      return { valid: false, error: "Only letters, numbers, and underscores allowed" };
    }
    
    return { valid: true, error: null };
  }, []);

  // Check availability via RPC
  const checkAvailability = useCallback(async (username: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.rpc("check_username_available", {
        p_username: username,
      });
      
      if (error) {
        console.error("Username availability check error:", error);
        return false;
      }
      
      return data === true;
    } catch (err) {
      console.error("Username availability check failed:", err);
      return false;
    }
  }, []);

  // Update username via RPC
  const updateUsername = useCallback(async (newUsername: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase.rpc("update_username", {
        p_new_username: newUsername,
      });
      
      if (error) {
        return { success: false, error: error.message };
      }
      
      const result = data as { success: boolean; error?: string; hours_remaining?: number };
      
      if (!result.success) {
        if (result.error === "Cooldown active" && result.hours_remaining) {
          setState(prev => ({
            ...prev,
            canChange: false,
            hoursUntilChange: result.hours_remaining ?? null,
          }));
        }
        return { success: false, error: result.error || "Failed to update username" };
      }
      
      toast({
        title: "Username Updated!",
        description: `Your username is now @${newUsername}`,
      });
      
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to update username" };
    }
  }, [toast]);

  // Create profile with username (for signup)
  const createProfileWithUsername = useCallback(async (username: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase.rpc("create_profile_with_username", {
        p_username: username,
      });
      
      if (error) {
        return { success: false, error: error.message };
      }
      
      const result = data as { success: boolean; error?: string };
      
      if (!result.success) {
        return { success: false, error: result.error || "Failed to create profile" };
      }
      
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || "Failed to create profile" };
    }
  }, []);

  // Debounced availability check
  const setUsername = useCallback((value: string) => {
    const { valid, error } = validateFormat(value);
    
    setState(prev => ({
      ...prev,
      username: value,
      isValid: valid,
      isAvailable: null,
      error,
      isChecking: valid,
    }));
    
    // Don't check availability if format is invalid
    if (!valid) return;
    
    // Debounce availability check
    const timeoutId = setTimeout(async () => {
      const available = await checkAvailability(value);
      setState(prev => ({
        ...prev,
        isAvailable: available,
        isChecking: false,
        error: available ? null : "Username already taken",
      }));
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [validateFormat, checkAvailability]);

  // Get current user's username
  const fetchCurrentUsername = useCallback(async (): Promise<string | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      
      const { data, error } = await supabase
        .from("profiles")
        .select("username, username_updated_at")
        .eq("user_id", user.id)
        .single();
      
      if (error || !data) return null;
      
      // Check if cooldown is active
      if (data.username_updated_at) {
        const lastUpdate = new Date(data.username_updated_at);
        const cooldownEnd = new Date(lastUpdate.getTime() + 24 * 60 * 60 * 1000);
        const now = new Date();
        
        if (cooldownEnd > now) {
          const hoursRemaining = Math.ceil((cooldownEnd.getTime() - now.getTime()) / (1000 * 60 * 60));
          setState(prev => ({
            ...prev,
            canChange: false,
            hoursUntilChange: hoursRemaining,
          }));
        }
      }
      
      return data.username;
    } catch (err) {
      console.error("Failed to fetch username:", err);
      return null;
    }
  }, []);

  return {
    ...state,
    setUsername,
    updateUsername,
    createProfileWithUsername,
    fetchCurrentUsername,
    validateFormat,
  };
}
