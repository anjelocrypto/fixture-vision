import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Search, Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface Competition {
  key: string;
  name: string;
  country: string;
  logo?: string;
}

interface BasketballLeftRailProps {
  selectedCompetition: string | null;
  onSelectCompetition: (key: string) => void;
}

// Hardcoded basketball competitions for v1
const COMPETITIONS: { country: string; leagues: Competition[] }[] = [
  {
    country: "USA",
    leagues: [
      { key: "nba", name: "NBA", country: "USA", logo: "🏀" },
      { key: "nba_gleague", name: "G-League", country: "USA", logo: "🏀" },
    ],
  },
  {
    country: "Europe",
    leagues: [
      { key: "euroleague", name: "EuroLeague", country: "Europe", logo: "🇪🇺" },
      { key: "eurocup", name: "EuroCup", country: "Europe", logo: "🇪🇺" },
    ],
  },
  {
    country: "Spain",
    leagues: [
      { key: "spain_acb", name: "Liga ACB", country: "Spain", logo: "🇪🇸" },
    ],
  },
  {
    country: "Germany",
    leagues: [
      { key: "germany_bbl", name: "BBL", country: "Germany", logo: "🇩🇪" },
    ],
  },
  {
    country: "Italy",
    leagues: [
      { key: "italy_lba", name: "Lega A", country: "Italy", logo: "🇮🇹" },
    ],
  },
];

export function BasketballLeftRail({ 
  selectedCompetition, 
  onSelectCompetition 
}: BasketballLeftRailProps) {
  const { t } = useTranslation(['common', 'filters']);
  const [searchQuery, setSearchQuery] = useState("");

  // Filter competitions based on search
  const filteredCompetitions = COMPETITIONS.map(group => ({
    ...group,
    leagues: group.leagues.filter(league =>
      league.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      group.country.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter(group => group.leagues.length > 0);

  return (
    <div className="w-full sm:w-[280px] border-r border-border bg-card/30 backdrop-blur-sm flex flex-col h-full">
      <div className="p-3 sm:p-4 border-b border-border shrink-0">
        <h2 className="text-base sm:text-lg font-semibold mb-3 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-orange-500" />
          Basketball
        </h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search competitions..."
            className="pl-9 bg-secondary/50 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        <div className="p-2 space-y-4">
          {filteredCompetitions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground text-center">
              No competitions found
            </div>
          ) : (
            filteredCompetitions.map((group) => (
              <div key={group.country}>
                <div className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {group.country}
                </div>
                <div className="space-y-1">
                  {group.leagues.map((league) => (
                    <button
                      key={league.key}
                      onClick={() => onSelectCompetition(league.key)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left",
                        selectedCompetition === league.key
                          ? "bg-primary/10 text-primary border border-primary/20"
                          : "hover:bg-secondary/50 text-foreground"
                      )}
                    >
                      <span className="text-xl">{league.logo}</span>
                      <span className="text-sm font-medium">{league.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
