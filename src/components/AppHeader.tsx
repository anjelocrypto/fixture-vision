import { Search, Twitter } from "lucide-react";
import { Button } from "@/components/ui/button";

const sports = [
  { name: "Football", active: true },
  { name: "UFC", active: false },
  { name: "Basketball", active: false },
  { name: "Tennis", active: false },
  { name: "NFL", active: false },
];

export function AppHeader() {
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
              className={sport.active ? "rounded-full" : "rounded-full text-muted-foreground"}
            >
              {sport.name}
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
          <div className="flex items-center gap-2 px-2 sm:px-3 py-1 sm:py-1.5 bg-secondary rounded-full text-xs sm:text-sm">
            <span className="text-primary font-semibold">EN</span>
            <span className="text-muted-foreground hidden sm:inline">/</span>
            <span className="text-muted-foreground hidden sm:inline">KA</span>
          </div>
        </div>
      </div>
    </header>
  );
}
