import { Search, Send, User, LogOut, Ticket, CreditCard, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { LastFetchBadge } from "./LastFetchBadge";
import { useTicket } from "@/stores/useTicket";
import { MyTicketDrawer } from "./MyTicketDrawer";
import { useAccess } from "@/hooks/useAccess";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useTranslation } from "react-i18next";

const sports = [
  { name: "Football", active: true },
  { name: "UFC", active: false },
  { name: "Basketball", active: false },
  { name: "Tennis", active: false },
  { name: "NFL", active: false },
];

export function AppHeader() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation(['common']);
  const [session, setSession] = useState<Session | null>(null);
  const [ticketDrawerOpen, setTicketDrawerOpen] = useState(false);
  const { legs, loadFromStorage, loadFromServer } = useTicket();
  const { hasAccess, entitlement } = useAccess();

  useEffect(() => {
    // Load ticket from localStorage on mount
    loadFromStorage();

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user?.id) {
        loadFromServer(session.user.id);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user?.id) {
        loadFromServer(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast({
      title: t('common:sign_out'),
      description: t('common:success_signed_out'),
    });
    navigate("/auth");
  };

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="flex items-center justify-between px-3 sm:px-6 h-14 sm:h-16">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="text-lg sm:text-2xl font-bold text-primary animate-glow">
            TICKET AI
          </div>
        </div>

        {/* Sport Tabs - Hidden on mobile */}
        <div className="hidden md:flex items-center gap-4">
          <div className="flex items-center gap-2 bg-secondary/50 rounded-full p-1">
            {sports.map((sport) => (
              <Button
                key={sport.name}
                variant={sport.active ? "default" : "ghost"}
                size="sm"
                onClick={() => {
                  if (!sport.active) {
                    toast({
                      title: "Coming Soon",
                      description: `${sport.name} predictions will be available soon!`,
                    });
                  }
                }}
                className={sport.active ? "rounded-full" : "rounded-full text-muted-foreground/60 hover:text-muted-foreground cursor-pointer"}
              >
                {sport.name}
              </Button>
            ))}
          </div>
          <LastFetchBadge />
        </div>

        {/* Right Utils - Simplified on mobile */}
        <div className="flex items-center gap-1 sm:gap-3">
          {/* Language Switcher */}
          <LanguageSwitcher />
          
          {/* My Ticket Button */}
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setTicketDrawerOpen(true)}
            className="relative"
          >
            <Ticket className="h-5 w-5" />
            {legs.length > 0 && (
              <Badge 
                variant="destructive" 
                className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
              >
                {legs.length}
              </Badge>
            )}
          </Button>
          
          <Button variant="ghost" size="icon" className="hidden sm:flex">
            <Search className="h-5 w-5" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            className="hidden sm:flex"
            asChild
          >
            <a href="https://t.me/TICKETAIBET" target="_blank" rel="noopener noreferrer">
              <Send className="h-5 w-5" />
            </a>
          </Button>
          
          {session ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                  <User className="h-5 w-5" />
                  {hasAccess && (
                    <Badge 
                      variant="default" 
                      className="absolute -top-1 -right-1 h-3 w-3 flex items-center justify-center p-0"
                    >
                      <Sparkles className="h-2 w-2" />
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  {session.user.email}
                </DropdownMenuItem>
                {hasAccess && entitlement && (
                  <DropdownMenuItem disabled className="text-xs font-medium">
                    <Sparkles className="mr-2 h-3 w-3" />
                    {entitlement.plan === "day_pass" ? t('common:premium_badge_day_pass') : 
                     entitlement.plan === "premium_monthly" ? t('common:premium_badge_monthly') : t('common:premium_badge_annual')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/account")}>
                  <CreditCard className="mr-2 h-4 w-4" />
                  {t('common:account_billing')}
                </DropdownMenuItem>
                {!hasAccess && (
                  <DropdownMenuItem onClick={() => navigate("/pricing")}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    {t('common:upgrade_to_premium')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  {t('common:sign_out')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button variant="default" size="sm" onClick={() => navigate("/auth")}>
              {t('common:sign_in')}
            </Button>
          )}
        </div>
      </div>

      {/* My Ticket Drawer */}
      <MyTicketDrawer open={ticketDrawerOpen} onOpenChange={setTicketDrawerOpen} />
    </header>
  );
}
