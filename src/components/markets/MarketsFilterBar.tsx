import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div className="space-y-2">
      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-primary bg-primary/10 px-2.5 py-1.5 rounded-lg border border-primary/20">
          ⚽ {t("filter.football")}
        </span>

        <Select
          value={countryId?.toString() || "all"}
          onValueChange={(v) => {
            const newCountryId = v === "all" ? null : parseInt(v);
            onCountryChange(newCountryId);
            if (newCountryId !== countryId) onLeagueChange(null);
          }}
        >
          <SelectTrigger className="w-auto min-w-[130px] h-8 text-xs bg-card border-border/50 rounded-lg">
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
          <SelectTrigger className="w-auto min-w-[140px] h-8 text-xs bg-card border-border/50 rounded-lg">
            <SelectValue placeholder={t("filter.all_leagues")} />
          </SelectTrigger>
          <SelectContent className="bg-card border-border max-h-[300px]">
            <SelectItem value="all">{t("filter.all_leagues")}</SelectItem>
            {leagues?.map((league) => (
              <SelectItem key={league.id} value={league.id.toString()}>
                <span className="flex items-center gap-2">
                  {league.logo && <img src={league.logo} alt="" className="w-4 h-4 object-contain" />}
                  <span className="truncate max-w-[160px]">{league.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-1">({league.marketCount})</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(v) => onSortChange(v as "kickoff" | "pool" | "newest")}>
          <SelectTrigger className="w-auto min-w-[110px] h-8 text-xs bg-card border-border/50 rounded-lg">
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
            <button
              className={cn(
                "h-8 w-8 flex items-center justify-center rounded-lg border transition-all active:scale-[0.95]",
                search
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border/50 text-muted-foreground hover:text-foreground"
              )}
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2 bg-card border-border" align="end">
            <div className="flex gap-2">
              <Input
                placeholder={t("filter.search_teams")}
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                className="h-8 text-sm bg-background rounded-lg"
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
          <button
            onClick={onReset}
            className="h-8 flex items-center gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-lg active:scale-[0.95]"
          >
            <RotateCcw className="h-3 w-3" />
            {t("filter.reset")}
          </button>
        )}
      </div>

      {/* Active filter chips */}
      {(selectedCountry || selectedLeague || search) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedCountry && (
            <button
              onClick={() => { onCountryChange(null); onLeagueChange(null); }}
              className="flex items-center gap-1 h-6 px-2 text-[11px] rounded-lg bg-muted/40 border border-border/30 text-foreground hover:bg-destructive/15 hover:border-destructive/30 transition-colors active:scale-[0.95]"
            >
              {selectedCountry.flag && <img src={selectedCountry.flag} alt="" className="w-3 h-2 object-cover rounded-sm" />}
              {selectedCountry.name}
              <X className="h-2.5 w-2.5 ml-0.5" />
            </button>
          )}
          {selectedLeague && (
            <button
              onClick={() => onLeagueChange(null)}
              className="flex items-center gap-1 h-6 px-2 text-[11px] rounded-lg bg-muted/40 border border-border/30 text-foreground hover:bg-destructive/15 hover:border-destructive/30 transition-colors active:scale-[0.95]"
            >
              {selectedLeague.logo && <img src={selectedLeague.logo} alt="" className="w-3 h-3 object-contain" />}
              {selectedLeague.name}
              <X className="h-2.5 w-2.5 ml-0.5" />
            </button>
          )}
          {search && (
            <button
              onClick={() => onSearchChange("")}
              className="flex items-center gap-1 h-6 px-2 text-[11px] rounded-lg bg-muted/40 border border-border/30 text-foreground hover:bg-destructive/15 hover:border-destructive/30 transition-colors active:scale-[0.95]"
            >
              "{search}"
              <X className="h-2.5 w-2.5 ml-0.5" />
            </button>
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
        <button
          key={league.id}
          className={cn(
            "flex items-center gap-1.5 h-7 px-3 text-xs whitespace-nowrap shrink-0 rounded-lg border font-medium transition-all active:scale-[0.95]",
            selectedLeagueId === league.id
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
          )}
          onClick={() => onSelect(selectedLeagueId === league.id ? null : league.id)}
        >
          {league.logo && <img src={league.logo} alt="" className="w-3.5 h-3.5 object-contain" />}
          {league.name}
        </button>
      ))}
    </div>
  );
}
