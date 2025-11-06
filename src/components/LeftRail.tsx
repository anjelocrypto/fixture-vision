import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Country {
  id: number;
  name: string;
  flag: string;
  code: string;
}

// Helper to ensure flag emoji renders properly
const getFlagDisplay = (flag: string) => {
  return flag;
};

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
  leaguesLoading?: boolean;
  leaguesError?: boolean;
  onCountryHover?: (countryId: number) => void;
}

export function LeftRail({ 
  countries, 
  selectedCountry, 
  onSelectCountry,
  leagues,
  selectedLeague,
  onSelectLeague,
  leaguesLoading = false,
  leaguesError = false,
  onCountryHover
}: LeftRailProps) {
  const { t } = useTranslation(['filters']);
  const selectedCountryData = countries.find((c) => c.id === selectedCountry);

  // Helper function to translate country names
  const getCountryName = (countryName: string) => {
    const translationKey = `filters:countries.${countryName}`;
    const translated = t(translationKey);
    return translated !== translationKey ? translated : countryName;
  };

  // Helper function to translate league names
  const getLeagueName = (leagueName: string) => {
    const translationKey = `filters:leagues.${leagueName}`;
    const translated = t(translationKey);
    return translated !== translationKey ? translated : leagueName;
  };

  return (
    <div className="w-full sm:w-[280px] border-r border-border bg-card/30 backdrop-blur-sm flex flex-col h-full">
      <div className="p-3 sm:p-4 border-b border-border shrink-0">
        <h2 className="text-base sm:text-lg font-semibold mb-3">{t('filters:title')}</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder={t('filters:search_placeholder')}
            className="pl-9 bg-secondary/50 text-sm"
          />
        </div>
      </div>
      
      <div className="px-4 py-3 border-b border-border shrink-0">
        <h3 className="text-sm font-medium text-muted-foreground">{t('filters:region')}</h3>
      </div>

      {/* Countries Section - Fixed height with scroll */}
      <div className="shrink-0 max-h-[280px] overflow-y-auto">
        <div className="p-2 space-y-1">
          {countries.map((country) => (
            <button
              key={country.id}
              onClick={() => onSelectCountry(country.id)}
              onMouseEnter={() => onCountryHover?.(country.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                selectedCountry === country.id
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : "hover:bg-secondary/50 text-foreground"
              }`}
            >
              <span className="text-2xl" style={{ fontFamily: "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif" }}>
                {getFlagDisplay(country.flag)}
              </span>
              <span className="text-sm font-medium">{getCountryName(country.name)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Leagues Section - Takes remaining space with independent scroll */}
      {selectedCountry && selectedCountry !== 0 && (
        <div className="flex-1 flex flex-col min-h-0 border-t border-border">
          <div className="px-4 py-3 shrink-0 bg-card/50 backdrop-blur-sm">
            <h3 className="text-sm font-medium text-muted-foreground">
              {selectedCountryData ? getCountryName(selectedCountryData.name) : ''} {t('filters:leagues')}
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="p-2 space-y-1 pb-4">
              {leaguesError ? (
                <div className="px-3 py-2 text-xs text-destructive text-center">
                  Failed to load leagues
                </div>
              ) : leaguesLoading ? (
                // Skeleton loader
                <>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="px-3 py-2 rounded-md bg-accent/20 animate-pulse"
                      style={{ height: '32px' }}
                    />
                  ))}
                </>
              ) : leagues.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                  No leagues available
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
                    <span className="text-xs font-medium truncate">{getLeagueName(league.name)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
