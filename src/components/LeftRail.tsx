import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

interface Country {
  id: number;
  name: string;
  flag: string;
  code: string;
}

interface League {
  id: number;
  name: string;
  logo?: string;
  country_name?: string;
}

interface LeftRailProps {
  countries: Country[];
  selectedCountry: number | null;
  onSelectCountry: (id: number) => void;
  leagues: League[];
  selectedLeague: League | null;
  onSelectLeague: (league: League) => void;
}

export function LeftRail({ 
  countries, 
  selectedCountry, 
  onSelectCountry,
  leagues,
  selectedLeague,
  onSelectLeague 
}: LeftRailProps) {
  const selectedCountryData = countries.find((c) => c.id === selectedCountry);

  return (
    <div className="w-full sm:w-[280px] border-r border-border bg-card/30 backdrop-blur-sm flex flex-col overflow-hidden">
      <div className="p-3 sm:p-4 border-b border-border shrink-0">
        <h2 className="text-base sm:text-lg font-semibold mb-3">Filters</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search countries/leagues..." 
            className="pl-9 bg-secondary/50 text-sm"
          />
        </div>
      </div>
      
      <div className="px-4 py-3 border-b border-border shrink-0">
        <h3 className="text-sm font-medium text-muted-foreground">Region</h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-2 space-y-1">
          {countries.map((country) => (
            <button
              key={country.id}
              onClick={() => onSelectCountry(country.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                selectedCountry === country.id
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "hover:bg-secondary/50 text-foreground"
              }`}
            >
              <span className="text-2xl">{country.flag}</span>
              <span className="text-sm font-medium">{country.name}</span>
            </button>
          ))}
        </div>

        {selectedCountry && selectedCountry !== 0 && (
          <>
            <div className="px-4 py-3 border-t border-border mt-2 sticky top-0 bg-card/30 backdrop-blur-sm">
              <h3 className="text-sm font-medium text-muted-foreground">
                {selectedCountryData?.name} Leagues
              </h3>
            </div>
            <div className="p-2 space-y-1 pb-4">
              {leagues.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                  Loading leagues...
                </div>
              ) : (
                leagues.map((league) => (
                  <button
                    key={league.id}
                    onClick={() => onSelectLeague(league)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-left ${
                      selectedLeague?.id === league.id
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "hover:bg-secondary/50 text-foreground"
                    }`}
                  >
                    {league.logo && (
                      <img src={league.logo} alt="" className="w-5 h-5 object-contain shrink-0" />
                    )}
                    <span className="text-xs font-medium truncate">{league.name}</span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
