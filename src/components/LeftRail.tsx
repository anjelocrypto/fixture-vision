import { Input } from "@/components/ui/input";
import { Search, Globe, ChevronRight, Trophy, MapPin, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useState, useMemo } from "react";

interface Country {
  id: number;
  name: string;
  flag: string;
  code: string;
}

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

  const getCountryName = (countryName: string) => {
    const translationKey = `filters:countries.${countryName}`;
    const translated = t(translationKey);
    return translated !== translationKey ? translated : countryName;
  };

  const getLeagueName = (leagueName: string) => {
    const cleanName = leagueName.replace(/^league_names\./, '');
    const translationKey = `filters:league_names.${cleanName}`;
    const translated = t(translationKey);
    return translated !== translationKey ? translated : cleanName;
  };

  const filteredCountries = useMemo(() => {
    if (!searchQuery.trim()) return countries;
    const query = searchQuery.toLowerCase();
    return countries.filter((country) => 
      getCountryName(country.name).toLowerCase().includes(query)
    );
  }, [countries, searchQuery]);

  const selectedCountryMatchesSearch = useMemo(() => {
    if (!searchQuery.trim() || !selectedCountryData) return true;
    const query = searchQuery.toLowerCase();
    return getCountryName(selectedCountryData.name).toLowerCase().includes(query);
  }, [searchQuery, selectedCountryData]);

  const filteredLeagues = useMemo(() => {
    if (!searchQuery.trim()) return leagues;
    if (selectedCountryMatchesSearch) return leagues;
    const query = searchQuery.toLowerCase();
    return leagues.filter((league) => 
      getLeagueName(league.name).toLowerCase().includes(query)
    );
  }, [leagues, searchQuery, selectedCountryMatchesSearch]);

  return (
    <div className="w-full sm:w-[280px] border-r border-border/50 bg-card/30 backdrop-blur-sm flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border/40 shrink-0">
        <h2 className="text-base font-bold mb-3 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-primary" />
          {t('filters:title')}
        </h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder={t('filters:search_placeholder')}
            className="pl-9 bg-muted/30 text-sm h-10 rounded-xl border-border/40 focus:bg-background transition-colors"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>
      
      {/* Region label */}
      <div className="px-4 py-2.5 border-b border-border/30 shrink-0">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('filters:region')}
        </h3>
      </div>

      {/* Countries */}
      <div className="shrink-0 max-h-[260px] sm:max-h-[280px] overflow-y-auto">
        <div className="p-2 space-y-0.5">
          {filteredCountries.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <Globe className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No countries found</p>
            </div>
          ) : (
            filteredCountries.map((country) => (
              <button
                key={country.id}
                onClick={() => onSelectCountry(country.id)}
                onMouseEnter={() => onCountryHover?.(country.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all touch-manipulation active:scale-[0.98] ${
                  selectedCountry === country.id
                    ? "bg-primary/10 text-primary border border-primary/20 shadow-sm"
                    : "hover:bg-muted/40 text-foreground active:bg-muted/60"
                }`}
              >
                <div className="w-7 h-7 rounded-lg bg-muted/30 flex items-center justify-center shrink-0 overflow-hidden">
                  {(() => {
                    const src = getFlagSrc(country.code);
                    if (src) {
                      return (
                        <img src={src} alt={`${country.name} flag`} className="w-5 h-[14px] rounded-[2px] object-cover" loading="lazy" />
                      );
                    }
                    return <Globe className="w-4 h-4 text-muted-foreground" aria-label="World" />;
                  })()}
                </div>
                <span className="text-sm font-medium flex-1 text-left">{getCountryName(country.name)}</span>
                {selectedCountry === country.id && (
                  <ChevronRight className="w-3.5 h-3.5 text-primary shrink-0" />
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Leagues */}
      {selectedCountry && selectedCountry !== 0 && (
        <div className="flex-1 flex flex-col min-h-0 border-t border-border/30">
          <div className="px-4 py-2.5 shrink-0 bg-muted/10">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Trophy className="w-3 h-3" />
              {selectedCountryData ? getCountryName(selectedCountryData.name) : ''} {t('filters:leagues')}
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="p-2 space-y-0.5 pb-4">
              {leaguesError ? (
                <div className="px-3 py-6 text-center">
                  <p className="text-xs text-destructive">Failed to load leagues</p>
                </div>
              ) : leaguesLoading ? (
                <div className="px-3 py-6 flex flex-col items-center gap-2">
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                  <p className="text-xs text-muted-foreground">Loading...</p>
                </div>
              ) : filteredLeagues.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <Trophy className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground">No leagues found</p>
                </div>
              ) : (
                filteredLeagues.map((league) => (
                  <button
                    key={league.id}
                    onClick={() => onSelectLeague(league)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-all text-left touch-manipulation active:scale-[0.98] ${
                      selectedLeague?.id === league.id
                        ? "bg-primary/10 text-primary border border-primary/20 shadow-sm"
                        : "hover:bg-muted/40 text-foreground active:bg-muted/60"
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-muted/20 flex items-center justify-center shrink-0 overflow-hidden">
                      {league.logo ? (
                        <img src={league.logo} alt="" className="w-5 h-5 object-contain" />
                      ) : (
                        <Trophy className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <span className="text-xs font-medium truncate flex-1">{getLeagueName(league.name)}</span>
                    {selectedLeague?.id === league.id && (
                      <ChevronRight className="w-3.5 h-3.5 text-primary shrink-0" />
                    )}
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
