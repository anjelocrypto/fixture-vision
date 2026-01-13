import { useState, useMemo } from "react";
import { format } from "date-fns";
import { Search, ChevronRight, Loader2, Calendar, Target, Trophy, X } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

import {
  useCountries,
  useLeaguesByCountry,
  useFixturesNext,
  useLeagueFixtureCounts,
  useCreateMarketFromFixture,
  MARKET_TEMPLATES,
  type Fixture,
  type League,
} from "@/hooks/useAdminFixtures";

type TimeWindow = "24" | "48";

export function AdminFixturesDashboard() {
  const [selectedCountryId, setSelectedCountryId] = useState<number | null>(null);
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null);
  const [selectedFixture, setSelectedFixture] = useState<Fixture | null>(null);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("48");
  const [countrySearch, setCountrySearch] = useState("");
  const [leagueSearch, setLeagueSearch] = useState("");

  const { data: countries, isLoading: countriesLoading } = useCountries();
  const { data: leagues, isLoading: leaguesLoading } = useLeaguesByCountry(selectedCountryId);
  const { data: fixtureCounts } = useLeagueFixtureCounts(parseInt(timeWindow));
  const { data: fixtures, isLoading: fixturesLoading } = useFixturesNext(
    selectedLeague?.id ?? null,
    parseInt(timeWindow)
  );

  // Filter countries by search
  const filteredCountries = useMemo(() => {
    if (!countries) return [];
    if (!countrySearch.trim()) return countries;
    const search = countrySearch.toLowerCase();
    return countries.filter((c) =>
      c.name.toLowerCase().includes(search) || c.code?.toLowerCase().includes(search)
    );
  }, [countries, countrySearch]);

  // Filter leagues by search
  const filteredLeagues = useMemo(() => {
    if (!leagues) return [];
    if (!leagueSearch.trim()) return leagues;
    const search = leagueSearch.toLowerCase();
    return leagues.filter((l) => l.name.toLowerCase().includes(search));
  }, [leagues, leagueSearch]);

  const handleSelectCountry = (countryId: number) => {
    setSelectedCountryId(countryId);
    setSelectedLeague(null);
    setLeagueSearch("");
  };

  const handleSelectLeague = (league: League) => {
    setSelectedLeague(league);
  };

  const handleSelectFixture = (fixture: Fixture) => {
    setSelectedFixture(fixture);
  };

  const handleBack = () => {
    if (selectedLeague) {
      setSelectedLeague(null);
    } else if (selectedCountryId) {
      setSelectedCountryId(null);
      setCountrySearch("");
    }
  };

  return (
    <>
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-blue-600 text-base">
            <Calendar className="h-4 w-4" />
            Fixtures Dashboard (Next {timeWindow}h)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Time window selector */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Window:</Label>
            <Select value={timeWindow} onValueChange={(v) => setTimeWindow(v as TimeWindow)}>
              <SelectTrigger className="h-8 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24 hours</SelectItem>
                <SelectItem value="48">48 hours</SelectItem>
              </SelectContent>
            </Select>
            {(selectedCountryId || selectedLeague) && (
              <Button variant="ghost" size="sm" className="h-8 text-xs ml-auto" onClick={handleBack}>
                ← Back
              </Button>
            )}
          </div>

          {/* Breadcrumb */}
          {(selectedCountryId || selectedLeague) && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span
                className="hover:text-foreground cursor-pointer"
                onClick={() => {
                  setSelectedCountryId(null);
                  setSelectedLeague(null);
                }}
              >
                Countries
              </span>
              {selectedCountryId && (
                <>
                  <ChevronRight className="h-3 w-3" />
                  <span
                    className={selectedLeague ? "hover:text-foreground cursor-pointer" : "text-foreground"}
                    onClick={() => selectedLeague && setSelectedLeague(null)}
                  >
                    {countries?.find((c) => c.id === selectedCountryId)?.name || "Country"}
                  </span>
                </>
              )}
              {selectedLeague && (
                <>
                  <ChevronRight className="h-3 w-3" />
                  <span className="text-foreground">{selectedLeague.name}</span>
                </>
              )}
            </div>
          )}

          {/* Content based on state */}
          {!selectedCountryId && (
            <CountryList
              countries={filteredCountries}
              isLoading={countriesLoading}
              search={countrySearch}
              onSearchChange={setCountrySearch}
              onSelect={handleSelectCountry}
            />
          )}

          {selectedCountryId && !selectedLeague && (
            <LeagueList
              leagues={filteredLeagues}
              isLoading={leaguesLoading}
              search={leagueSearch}
              onSearchChange={setLeagueSearch}
              onSelect={handleSelectLeague}
              fixtureCounts={fixtureCounts || {}}
            />
          )}

          {selectedLeague && (
            <FixtureList
              fixtures={fixtures || []}
              isLoading={fixturesLoading}
              onSelect={handleSelectFixture}
            />
          )}
        </CardContent>
      </Card>

      {/* Market Builder Dialog */}
      {selectedFixture && (
        <MarketBuilderDialog
          fixture={selectedFixture}
          league={selectedLeague}
          open={!!selectedFixture}
          onClose={() => setSelectedFixture(null)}
        />
      )}
    </>
  );
}

// Country List
function CountryList({
  countries,
  isLoading,
  search,
  onSearchChange,
  onSelect,
}: {
  countries: { id: number; name: string; code: string | null; flag: string | null }[];
  isLoading: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  onSelect: (id: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search countries..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-9 pl-8 text-sm"
        />
      </div>
      <ScrollArea className="h-48">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : countries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No countries found</p>
        ) : (
          <div className="space-y-1">
            {countries.map((country) => (
              <button
                key={country.id}
                className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-muted text-left text-sm transition-colors"
                onClick={() => onSelect(country.id)}
              >
                {country.flag && <span className="text-base">{country.flag}</span>}
                <span className="flex-1 truncate">{country.name}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// League List
function LeagueList({
  leagues,
  isLoading,
  search,
  onSearchChange,
  onSelect,
  fixtureCounts,
}: {
  leagues: League[];
  isLoading: boolean;
  search: string;
  onSearchChange: (s: string) => void;
  onSelect: (league: League) => void;
  fixtureCounts: Record<number, number>;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search leagues..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-9 pl-8 text-sm"
        />
      </div>
      <ScrollArea className="h-48">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : leagues.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No leagues found</p>
        ) : (
          <div className="space-y-1">
            {leagues.map((league) => {
              const count = fixtureCounts[league.id] || 0;
              return (
                <button
                  key={league.id}
                  className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-muted text-left text-sm transition-colors"
                  onClick={() => onSelect(league)}
                >
                  {league.logo && (
                    <img src={league.logo} alt="" className="h-5 w-5 object-contain" />
                  )}
                  <span className="flex-1 truncate">{league.name}</span>
                  {count > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {count}
                    </Badge>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// Fixture List
function FixtureList({
  fixtures,
  isLoading,
  onSelect,
}: {
  fixtures: Fixture[];
  isLoading: boolean;
  onSelect: (fixture: Fixture) => void;
}) {
  return (
    <ScrollArea className="h-48">
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : fixtures.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No fixtures in this window
        </p>
      ) : (
        <div className="space-y-1">
          {fixtures.map((fixture) => {
            const kickoff = fixture.timestamp
              ? new Date(fixture.timestamp * 1000)
              : new Date(fixture.date);
            return (
              <button
                key={fixture.id}
                className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-muted text-left text-sm transition-colors"
                onClick={() => onSelect(fixture)}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {fixture.teams_home.name} vs {fixture.teams_away.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(kickoff, "EEE d MMM, HH:mm")}
                  </div>
                </div>
                <Target className="h-4 w-4 text-blue-500" />
              </button>
            );
          })}
        </div>
      )}
    </ScrollArea>
  );
}

// Market Builder Dialog
function MarketBuilderDialog({
  fixture,
  league,
  open,
  onClose,
}: {
  fixture: Fixture;
  league: League | null;
  open: boolean;
  onClose: () => void;
}) {
  const [selectedRule, setSelectedRule] = useState<string | null>(null);
  const [oddsYes, setOddsYes] = useState(1.8);
  const [oddsNo, setOddsNo] = useState(2.0);
  const [closeMinutes, setCloseMinutes] = useState(5);
  const [createdMarkets, setCreatedMarkets] = useState<string[]>([]);

  const createMarket = useCreateMarketFromFixture();

  const kickoff = fixture.timestamp
    ? new Date(fixture.timestamp * 1000)
    : new Date(fixture.date);

  const handleCreate = async () => {
    if (!selectedRule) {
      toast.error("Select a market template");
      return;
    }

    try {
      const result = await createMarket.mutateAsync({
        fixture_id: fixture.id,
        resolution_rule: selectedRule,
        odds_yes: oddsYes,
        odds_no: oddsNo,
        close_minutes_before_kickoff: closeMinutes,
      });

      toast.success(`Market created: ${result.title}`);
      setCreatedMarkets((prev) => [...prev, selectedRule]);
      setSelectedRule(null);
    } catch (error: any) {
      toast.error(error.message || "Failed to create market");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            Create Market
          </DialogTitle>
        </DialogHeader>

        {/* Fixture Info */}
        <div className="p-3 rounded-lg bg-muted/50 border space-y-1">
          <div className="font-semibold">
            {fixture.teams_home.name} vs {fixture.teams_away.name}
          </div>
          <div className="text-sm text-muted-foreground">
            {league?.name || "Unknown League"} · {format(kickoff, "EEE d MMM, HH:mm")}
          </div>
        </div>

        {/* Market Templates */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Market Template</Label>
          <div className="grid grid-cols-2 gap-2">
            {MARKET_TEMPLATES.map((template) => {
              const alreadyCreated = createdMarkets.includes(template.rule);
              return (
                <button
                  key={template.rule}
                  className={`p-2 rounded-md border text-sm text-left transition-colors ${
                    selectedRule === template.rule
                      ? "bg-primary text-primary-foreground border-primary"
                      : alreadyCreated
                      ? "bg-green-500/10 border-green-500/30 text-green-600"
                      : "hover:bg-muted border-border"
                  }`}
                  onClick={() => !alreadyCreated && setSelectedRule(template.rule)}
                  disabled={alreadyCreated}
                >
                  {alreadyCreated ? "✓ " : ""}
                  {template.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Odds Inputs */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Odds YES</Label>
            <Input
              type="number"
              step="0.01"
              min="1.01"
              value={oddsYes}
              onChange={(e) => setOddsYes(parseFloat(e.target.value) || 1.8)}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Odds NO</Label>
            <Input
              type="number"
              step="0.01"
              min="1.01"
              value={oddsNo}
              onChange={(e) => setOddsNo(parseFloat(e.target.value) || 2.0)}
              className="h-9"
            />
          </div>
        </div>

        {/* Close Minutes */}
        <div className="space-y-1">
          <Label className="text-xs">Close minutes before kickoff</Label>
          <Input
            type="number"
            min="0"
            value={closeMinutes}
            onChange={(e) => setCloseMinutes(parseInt(e.target.value) || 5)}
            className="h-9"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            <X className="h-4 w-4 mr-1" />
            Close
          </Button>
          <Button
            className="flex-1"
            onClick={handleCreate}
            disabled={!selectedRule || createMarket.isPending}
          >
            {createMarket.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Create Market
          </Button>
        </div>

        {/* Created Markets */}
        {createdMarkets.length > 0 && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              Created {createdMarkets.length} market(s) for this fixture
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
