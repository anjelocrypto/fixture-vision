import { Search, Twitter, User, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

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
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast({
      title: "Signed out",
      description: "You've been successfully signed out.",
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
        <div className="hidden md:flex items-center gap-2 bg-secondary/50 rounded-full p-1">
          {sports.map((sport) => (
            <Button
              key={sport.name}
              variant={sport.active ? "default" : "ghost"}
              size="sm"
              disabled={!sport.active}
              className={sport.active ? "rounded-full" : "rounded-full text-muted-foreground relative"}
            >
              <span className={!sport.active ? "opacity-50" : ""}>{sport.name}</span>
              {!sport.active && (
                <Badge 
                  variant="secondary" 
                  className="ml-2 text-[10px] px-1.5 py-0 h-4 bg-muted text-muted-foreground"
                >
                  Soon
                </Badge>
              )}
            </Button>
          ))}
        </div>

        {/* Right Utils - Simplified on mobile */}
        <div className="flex items-center gap-1 sm:gap-3">
          <Button variant="ghost" size="icon" className="hidden sm:flex">
            <Search className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="hidden sm:flex">
            <Twitter className="h-5 w-5" />
          </Button>
          
          {session ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <User className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  {session.user.email}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button variant="default" size="sm" onClick={() => navigate("/auth")}>
              Sign In
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
