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
      <div className="flex items-center justify-between px-6 h-16">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="text-2xl font-bold text-primary animate-glow">
            TICKET AI
          </div>
        </div>

        {/* Sport Tabs */}
        <div className="flex items-center gap-2 bg-secondary/50 rounded-full p-1">
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

        {/* Right Utils */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon">
            <Search className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon">
            <Twitter className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary rounded-full text-sm">
            <span className="text-primary font-semibold">EN</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-muted-foreground">KA</span>
          </div>
        </div>
      </div>
    </header>
  );
}
