import { useState, useEffect } from "react";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { MyTicketDrawer } from "@/components/MyTicketDrawer";
import { useAndroidBackButton } from "@/hooks/useAndroidBackButton";
import { supabase } from "@/integrations/supabase/client";

/**
 * App-level shell that provides:
 * - Mobile bottom navigation (authenticated routes only)
 * - Android hardware back button handling
 * - Global ticket drawer triggered from bottom nav
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<boolean>(false);
  const [ticketDrawerOpen, setTicketDrawerOpen] = useState(false);

  // Android back button handler
  useAndroidBackButton();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(!!session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <>
      {children}

      {/* Mobile bottom navigation - only for authenticated users */}
      {session && (
        <MobileBottomNav onTicketOpen={() => setTicketDrawerOpen(true)} />
      )}

      {/* Global ticket drawer triggered from bottom nav */}
      <MyTicketDrawer
        open={ticketDrawerOpen}
        onOpenChange={setTicketDrawerOpen}
      />
    </>
  );
}
