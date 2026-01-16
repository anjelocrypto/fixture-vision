import { Input } from "@/components/ui/input";
import { Search, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useState, useMemo } from "react";

interface Country {
  id: number;
  name: string;
  flag: string;
  code: string;
}

// Build a reliable flag image URL from ISO code (uses flagcdn)
const getFlagSrc = (code?: string) => {
  if (!code || code === 'WORLD' || code === 'INTL') return null;
  if (code === 'UEFA') return '/images/uefa-logo.png';
  const normalized = code.toLowerCase();
  return `https://flagcdn.com/24x18/${normalized}.png`;
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
  const [searchQuery, setSearchQuery] = useState("");
  const selectedCountryData = countries.find((c) => c.id === selectedCountry);

  // Helper function to translate country names
  const getCountryName = (countryName: string) => {
    const translationKey = `filters:countries.${countryName}`;
    const translated = t(translationKey);
    return translated !== translationKey ? translated : countryName;
  };

  // Helper function to translate league names
  const getLeagueName = (leagueName: string) => {
    // Strip "league_names." prefix if present
    const cleanName = leagueName.replace(/^league_names\./, '');
    const translationKey = `filters:league_names.${cleanName}`;
    const translated = t(translationKey);
    return translated !== translationKey ? translated : cleanName;
  };

  // Filter countries and leagues based on search query
  const filteredCountries = useMemo(() => {
    if (!searchQuery.trim()) {
      // Debug logging when no search
      console.log(`[LeftRail] All countries count: ${countries.length}`);
      const uefaInList = countries.find((c) => c.id === 9998 || c.code === 'UEFA');
      console.log(`[LeftRail] UEFA in full list:`, uefaInList ? `YES (id=${uefaInList.id})` : 'NO');
      return countries;
    }
    
    const query = searchQuery.toLowerCase();
    const filtered = countries.filter((country) => 
      getCountryName(country.name).toLowerCase().includes(query)
    );
    console.log(`[LeftRail] Filtered countries (query="${query}"): ${filtered.length}`);
    return filtered;
  }, [countries, searchQuery]);

  // Check if selected country matches search query
  const selectedCountryMatchesSearch = useMemo(() => {
    if (!searchQuery.trim() || !selectedCountryData) return true;
    
    const query = searchQuery.toLowerCase();
    return getCountryName(selectedCountryData.name).toLowerCase().includes(query);
  }, [searchQuery, selectedCountryData]);

  const filteredLeagues = useMemo(() => {
    if (!searchQuery.trim()) return leagues;
    
    // If the selected country matches the search, show all its leagues
    if (selectedCountryMatchesSearch) return leagues;
    
    // Otherwise, filter leagues by name
    const query = searchQuery.toLowerCase();
    return leagues.filter((league) => 
      getLeagueName(league.name).toLowerCase().includes(query)
    );
  }, [leagues, searchQuery, selectedCountryMatchesSearch]);

  return (
    <div className="w-full sm:w-[280px] border-r border-border bg-card/30 backdrop-blur-sm flex flex-col h-full">
      {/* Header with safe area padding applied via sheet parent */}
      <div className="p-3 sm:p-4 border-b border-border shrink-0">
        <h2 className="text-base sm:text-lg font-semibold mb-3">{t('filters:title')}</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder={t('filters:search_placeholder')}
            className="pl-9 bg-secondary/50 text-sm h-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>
      
      <div className="px-4 py-3 border-b border-border shrink-0">
        <h3 className="text-sm font-medium text-muted-foreground">{t('filters:region')}</h3>
      </div>

      {/* Countries Section - Fixed height with scroll */}
      <div className="shrink-0 max-h-[240px] sm:max-h-[280px] overflow-y-auto">
        <div className="p-2 space-y-1">
          {filteredCountries.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground text-center">
              No countries found
            </div>
          ) : (
            filteredCountries.map((country) => {
              // Debug logging for each rendered country (first 5 only to avoid spam)
              if (filteredCountries.indexOf(country) < 5) {
                console.log(`[LeftRail] Rendering country: ${country.name} (id=${country.id}, code=${country.code})`);
              }
              return (
                <button
                  key={country.id}
                  onClick={() => onSelectCountry(country.id)}
                  onMouseEnter={() => onCountryHover?.(country.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors touch-manipulation ${
                    selectedCountry === country.id
                      ? "bg-primary/10 text-primary border border-primary/20"
                      : "hover:bg-secondary/50 text-foreground active:bg-secondary/70"
                  }`}
                >
                  {(() => {
                    const src = getFlagSrc(country.code);
                    if (src) {
                      return (
                        <img src={src} alt={`${country.name} flag`} className="w-5 h-5 rounded-sm object-cover shadow-sm" loading="lazy" />
                      );
                    }
                    return <Globe className="w-5 h-5 text-muted-foreground" aria-label="World" />;
                  })()}
                  <span className="text-sm font-medium">{getCountryName(country.name)}</span>
                </button>
              );
            })
          )}
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
              ) : filteredLeagues.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground text-center">
                  No leagues found
                </div>
              ) : (
                filteredLeagues.map((league) => (
                  <button
                    key={league.id}
                    onClick={() => onSelectLeague(league)}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg transition-colors text-left touch-manipulation ${
                      selectedLeague?.id === league.id
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "hover:bg-secondary/50 text-foreground active:bg-secondary/70"
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
