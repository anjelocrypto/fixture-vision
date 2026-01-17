import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Filter, RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMarketCountries, useMarketLeagues } from "@/hooks/useMarketsFiltered";
import { cn } from "@/lib/utils";

interface MarketsFilterBarProps {
  countryId: number | null;
  leagueId: number | null;
  search: string;
  sortBy: "kickoff" | "pool" | "newest";
  onCountryChange: (countryId: number | null) => void;
  onLeagueChange: (leagueId: number | null) => void;
  onSearchChange: (search: string) => void;
  onSortChange: (sort: "kickoff" | "pool" | "newest") => void;
  onReset: () => void;
}

export function MarketsFilterBar({
  countryId,
  leagueId,
  search,
  sortBy,
  onCountryChange,
  onLeagueChange,
  onSearchChange,
  onSortChange,
  onReset,
}: MarketsFilterBarProps) {
  const { t } = useTranslation("markets");
  const { data: countries } = useMarketCountries();
  const { data: leagues } = useMarketLeagues(countryId);
  const [searchOpen, setSearchOpen] = useState(false);

  const activeFilters = [countryId, leagueId, search].filter(Boolean).length;
  const selectedCountry = countries?.find((c) => c.id === countryId);
  const selectedLeague = leagues?.find((l) => l.id === leagueId);

  return (
    <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border pb-3 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="h-8 px-3 gap-1.5 bg-primary/10 text-primary border-0">
          ⚽ {t("filter.football")}
        </Badge>

        <Select
          value={countryId?.toString() || "all"}
          onValueChange={(v) => {
            const newCountryId = v === "all" ? null : parseInt(v);
            onCountryChange(newCountryId);
            if (newCountryId !== countryId) onLeagueChange(null);
          }}
        >
          <SelectTrigger className="w-auto min-w-[140px] h-8 text-sm bg-card border-border">
            <SelectValue placeholder={t("filter.all_countries")} />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">🌍 {t("filter.all_countries")}</SelectItem>
            {countries?.map((country) => (
              <SelectItem key={country.id} value={country.id.toString()}>
                <span className="flex items-center gap-2">
                  {country.flag && <img src={country.flag} alt="" className="w-4 h-3 object-cover rounded-sm" />}
                  {country.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={leagueId?.toString() || "all"}
          onValueChange={(v) => onLeagueChange(v === "all" ? null : parseInt(v))}
        >
          <SelectTrigger className="w-auto min-w-[160px] h-8 text-sm bg-card border-border">
            <SelectValue placeholder={t("filter.all_leagues")} />
          </SelectTrigger>
          <SelectContent className="bg-card border-border max-h-[300px]">
            <SelectItem value="all">{t("filter.all_leagues")}</SelectItem>
            {leagues?.map((league) => (
              <SelectItem key={league.id} value={league.id.toString()}>
                <span className="flex items-center gap-2">
                  {league.logo && <img src={league.logo} alt="" className="w-4 h-4 object-contain" />}
                  <span className="truncate max-w-[180px]">{league.name}</span>
                  <Badge variant="outline" className="ml-1 text-xs h-5 px-1.5">{league.marketCount}</Badge>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(v) => onSortChange(v as any)}>
          <SelectTrigger className="w-auto min-w-[120px] h-8 text-sm bg-card border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="kickoff">⏰ {t("filter.sort_soonest")}</SelectItem>
            <SelectItem value="pool">💰 {t("filter.sort_highest_pool")}</SelectItem>
            <SelectItem value="newest">🆕 {t("filter.sort_newest")}</SelectItem>
          </SelectContent>
        </Select>

        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <Button variant={search ? "default" : "outline"} size="sm" className={cn("h-8 gap-1.5", search && "bg-primary")}>
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("filter.search")}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2 bg-card border-border" align="end">
            <div className="flex gap-2">
              <Input
                placeholder={t("filter.search_teams")}
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                className="h-8 text-sm bg-background"
                autoFocus
              />
              {search && (
                <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => onSearchChange("")}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {activeFilters > 0 && (
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground hover:text-foreground" onClick={onReset}>
            <RotateCcw className="h-3.5 w-3.5" />
            {t("filter.reset")}
          </Button>
        )}
      </div>

      {(selectedCountry || selectedLeague || search) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <span className="text-xs text-muted-foreground mr-1">{t("filter.filters")}:</span>
          {selectedCountry && (
            <Badge variant="secondary" className="h-6 text-xs gap-1 cursor-pointer hover:bg-destructive/20" onClick={() => { onCountryChange(null); onLeagueChange(null); }}>
              {selectedCountry.flag && <img src={selectedCountry.flag} alt="" className="w-3 h-2 object-cover rounded-sm" />}
              {selectedCountry.name}
              <X className="h-3 w-3" />
            </Badge>
          )}
          {selectedLeague && (
            <Badge variant="secondary" className="h-6 text-xs gap-1 cursor-pointer hover:bg-destructive/20" onClick={() => onLeagueChange(null)}>
              {selectedLeague.logo && <img src={selectedLeague.logo} alt="" className="w-3 h-3 object-contain" />}
              {selectedLeague.name}
              <X className="h-3 w-3" />
            </Badge>
          )}
          {search && (
            <Badge variant="secondary" className="h-6 text-xs gap-1 cursor-pointer hover:bg-destructive/20" onClick={() => onSearchChange("")}>
              "{search}"
              <X className="h-3 w-3" />
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

export function QuickLeagueChips({
  leagues,
  selectedLeagueId,
  onSelect,
}: {
  leagues: Array<{ id: number; name: string; logo: string | null; marketCount: number }>;
  selectedLeagueId: number | null;
  onSelect: (leagueId: number | null) => void;
}) {
  const topLeagues = leagues.slice(0, 6);
  if (topLeagues.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
      {topLeagues.map((league) => (
        <Button
          key={league.id}
          variant={selectedLeagueId === league.id ? "default" : "outline"}
          size="sm"
          className={cn("h-7 px-3 text-xs whitespace-nowrap gap-1.5 shrink-0", selectedLeagueId === league.id && "bg-primary text-primary-foreground")}
          onClick={() => onSelect(selectedLeagueId === league.id ? null : league.id)}
        >
          {league.logo && <img src={league.logo} alt="" className="w-3.5 h-3.5 object-contain" />}
          {league.name}
        </Button>
      ))}
    </div>
  );
}
