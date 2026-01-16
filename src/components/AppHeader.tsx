import { Send, User, LogOut, Ticket, CreditCard, Sparkles, Activity, BookOpen, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, useLocation } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { LastFetchBadge } from "./LastFetchBadge";
import { useTicket } from "@/stores/useTicket";
import { MyTicketDrawer } from "./MyTicketDrawer";
import { useAccess } from "@/hooks/useAccess";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useTranslation } from "react-i18next";
import { useTutorial } from "@/contexts/TutorialContext";

// Sports configuration with routes
const sports = [
  { name: "Football", route: "/", active: true },
  { name: "Basketball", route: "/basketball", active: true },
  { name: "UFC", route: null, active: false },
  { name: "Tennis", route: null, active: false },
  { name: "NFL", route: null, active: false },
];

export function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation(['common']);
  const [session, setSession] = useState<Session | null>(null);
  const [ticketDrawerOpen, setTicketDrawerOpen] = useState(false);
  const { legs, loadFromStorage, loadFromServer } = useTicket();
  const { hasAccess, entitlement, isAdmin } = useAccess();
  const { startTutorial } = useTutorial();

  // Determine current sport from route
  const currentSport = location.pathname === "/basketball" ? "Basketball" : "Football";

  useEffect(() => {
    loadFromStorage();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user?.id) {
        loadFromServer(session.user.id);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
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
    navigate("/landing", { replace: true });
  };

  return (
    <header 
      className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50"
      style={{ paddingTop: 'var(--safe-area-top)' }}
    >
      <div className="flex items-center justify-between px-2 sm:px-6 h-12 sm:h-16">
        {/* Logo + Mobile Sport Toggle */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="text-sm sm:text-2xl font-bold text-primary animate-glow whitespace-nowrap">
            TICKET AI
          </div>
          
          {/* Mobile Sport Toggle */}
          <div className="flex md:hidden items-center bg-secondary/50 rounded-full p-0.5">
            <Button
              variant={currentSport === "Football" ? "default" : "ghost"}
              size="sm"
              onClick={() => navigate("/")}
              className={`rounded-full h-7 px-2.5 text-xs ${currentSport === "Football" ? "" : "text-muted-foreground/60"}`}
            >
              ⚽
            </Button>
            <Button
              variant={currentSport === "Basketball" ? "default" : "ghost"}
              size="sm"
              onClick={() => navigate("/basketball")}
              className={`rounded-full h-7 px-2.5 text-xs ${currentSport === "Basketball" ? "" : "text-muted-foreground/60"}`}
            >
              🏀
            </Button>
          </div>
        </div>

        {/* Sport Tabs + Markets - Hidden on mobile */}
        <div className="hidden md:flex items-center gap-3">
          {/* Markets Button - Prominent white button */}
          <Button
            onClick={() => navigate("/markets")}
            size="sm"
            className={`rounded-full font-semibold px-5 ${
              location.pathname === "/markets" 
                ? "bg-white text-black hover:bg-white/90" 
                : "bg-white text-black hover:bg-white/90"
            }`}
          >
            <TrendingUp className="h-4 w-4 mr-1.5" />
            Markets
          </Button>

          <div className="flex items-center gap-2 bg-secondary/50 rounded-full p-1">
            {sports.map((sport) => {
              const isSelected = sport.name === currentSport;
              return (
                <Button
                  key={sport.name}
                  variant={isSelected ? "default" : "ghost"}
                  size="sm"
                  onClick={() => {
                    if (sport.active && sport.route) {
                      navigate(sport.route);
                    } else if (!sport.active) {
                      toast({
                        title: "Coming Soon",
                        description: `${sport.name} predictions will be available soon!`,
                      });
                    }
                  }}
                  className={isSelected ? "rounded-full" : "rounded-full text-muted-foreground/60 hover:text-muted-foreground cursor-pointer"}
                >
                  {sport.name}
                </Button>
              );
            })}
          </div>
          <LastFetchBadge />
        </div>

        {/* Right Utils - Simplified on mobile */}
        <div className="flex items-center gap-0.5 sm:gap-3">
          {/* Markets Button - Mobile only */}
          <Button
            onClick={() => navigate("/markets")}
            size="sm"
            className="md:hidden rounded-full font-semibold bg-white text-black hover:bg-white/90 h-8 w-8 p-0"
          >
            <TrendingUp className="h-4 w-4" />
          </Button>

          {/* Guide Button - Only for paid users, hidden on mobile */}
          {hasAccess && (
            <Button
              variant="ghost"
              size="sm"
              onClick={startTutorial}
              className="hidden sm:flex gap-1.5 text-primary hover:text-primary/80"
              data-tutorial="guide-button"
            >
              <BookOpen className="h-4 w-4" />
              <span>{t('tutorial:guide_button', 'Guide')}</span>
            </Button>
          )}
          
          {/* Language Switcher - Compact on mobile */}
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>
          
          {/* My Ticket Button */}
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setTicketDrawerOpen(true)}
            className="relative h-8 w-8 sm:h-10 sm:w-10"
            data-tutorial="my-ticket"
          >
            <Ticket className="h-4 w-4 sm:h-5 sm:w-5" />
            {legs.length > 0 && (
              <Badge 
                variant="destructive" 
                className="absolute -top-1 -right-1 h-4 w-4 sm:h-5 sm:w-5 flex items-center justify-center p-0 text-[10px] sm:text-xs"
              >
                {legs.length}
              </Badge>
            )}
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
                <Button variant="ghost" size="icon" className="relative h-8 w-8 sm:h-10 sm:w-10">
                  <User className="h-4 w-4 sm:h-5 sm:w-5" />
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
                {isAdmin && (
                  <DropdownMenuItem onClick={() => navigate("/admin/health")}>
                    <Activity className="mr-2 h-4 w-4" />
                    System Health
                  </DropdownMenuItem>
                )}
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
            <Button variant="default" size="sm" className="h-8 text-xs sm:text-sm px-2 sm:px-3" onClick={() => navigate("/auth")}>
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
