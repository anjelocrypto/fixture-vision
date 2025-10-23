import { useState, useEffect } from "react";
import { AppHeader } from "@/components/AppHeader";
import { LeftRail } from "@/components/LeftRail";
import { CenterRail } from "@/components/CenterRail";
import { RightRail } from "@/components/RightRail";
import { FilterizerPanel, FilterCriteria } from "@/components/FilterizerPanel";
import { TicketDrawer } from "@/components/TicketDrawer";
import { TicketCreatorDialog } from "@/components/TicketCreatorDialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Filter, Sparkles, Shield, Zap, Ticket } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// Mock countries data
const MOCK_COUNTRIES = [
  { id: 0, name: "World", flag: "🌍", code: "WORLD" },
  { id: 39, name: "England", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", code: "GB" },
  { id: 140, name: "Spain", flag: "🇪🇸", code: "ES" },
  { id: 135, name: "Italy", flag: "🇮🇹", code: "IT" },
  { id: 78, name: "Germany", flag: "🇩🇪", code: "DE" },
  { id: 61, name: "France", flag: "🇫🇷", code: "FR" },
  { id: 2, name: "Portugal", flag: "🇵🇹", code: "PT" },
  { id: 1, name: "Brazil", flag: "🇧🇷", code: "BR" },
];

const Index = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCountry, setSelectedCountry] = useState<number | null>(140); // Spain default
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedLeague, setSelectedLeague] = useState<any>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [valueAnalysis, setValueAnalysis] = useState<any>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [showFilterizer, setShowFilterizer] = useState(false);
  const [filterCriteria, setFilterCriteria] = useState<FilterCriteria | null>(null);
  const [filteredFixtures, setFilteredFixtures] = useState<any[]>([]);
  const [ticketDrawerOpen, setTicketDrawerOpen] = useState(false);
  const [currentTicket, setCurrentTicket] = useState<any>(null);
  const [generatingTicket, setGeneratingTicket] = useState(false);

  const SEASON = 2025;

  // Reset league and invalidate queries when country changes
  useEffect(() => {
    if (selectedCountry !== null) {
      console.log(`[Index] Country changed to: ${selectedCountry}`);
      setSelectedLeague(null);
      setAnalysis(null);
      setValueAnalysis(null);
      setFilterCriteria(null);
      setFilteredFixtures([]);
      
      // Invalidate all related queries
      queryClient.removeQueries({ queryKey: ['leagues'] });
      queryClient.removeQueries({ queryKey: ['fixtures'] });
      queryClient.invalidateQueries({ queryKey: ['leagues', selectedCountry, SEASON] });
    }
  }, [selectedCountry]);

  // Fetch leagues with React Query - properly keyed by country and season
  const { data: leaguesData } = useQuery({
    queryKey: ['leagues', selectedCountry, SEASON],
    queryFn: async () => {
      const country = MOCK_COUNTRIES.find((c) => c.id === selectedCountry);
      if (!country || country.id === 0) return { leagues: [] };

      console.log(`[Index] Fetching leagues for country: ${country.name}, season: ${SEASON}`);

      const { data, error } = await supabase.functions.invoke("fetch-leagues", {
        body: { country: country.name, season: SEASON },
      });

      if (error) throw error;

      console.log(`[Index] Fetched ${data?.leagues?.length || 0} leagues for ${country.name}`);
      return data;
    },
    enabled: !!selectedCountry && selectedCountry !== 0,
    staleTime: 60 * 60 * 1000, // 1 hour
  });

  // Fetch fixtures with React Query - properly keyed by country, season, league, and date
  const { data: fixturesData, isLoading: loadingFixtures } = useQuery({
    queryKey: ['fixtures', selectedCountry, SEASON, selectedLeague?.id, format(selectedDate, "yyyy-MM-dd")],
    queryFn: async () => {
      if (!selectedLeague) return { fixtures: [] };

      console.log(`[Index] Fetching fixtures for league: ${selectedLeague.id}, date: ${format(selectedDate, "yyyy-MM-dd")}, season: ${SEASON}`);

      const { data, error } = await supabase.functions.invoke("fetch-fixtures", {
        body: {
          league: selectedLeague.id,
          season: SEASON,
          date: format(selectedDate, "yyyy-MM-dd"),
        },
      });

      if (error) throw error;

      console.log(`[Index] Fetched ${data?.fixtures?.length || 0} fixtures`);
      return data;
    },
    enabled: !!selectedLeague && !!selectedDate,
    staleTime: 10 * 60 * 1000, // 10 min
  });

  const leagues = leaguesData?.leagues || [];
  const fixtures = fixturesData?.fixtures || [];

  const handleAnalyze = async (fixture: any) => {
    setLoadingAnalysis(true);
    setAnalysis(null);
    setValueAnalysis(null);

    try {
      const homeTeamId = fixture.teams_home?.id;
      const awayTeamId = fixture.teams_away?.id;

      if (!homeTeamId || !awayTeamId) {
        throw new Error("Missing team IDs in fixture data");
      }

      // Fetch analysis with team IDs
      const { data: analysisData, error: analysisError } = await supabase.functions.invoke("analyze-fixture", {
        body: { 
          fixtureId: fixture.id,
          homeTeamId,
          awayTeamId
        },
      });

      if (analysisError) throw analysisError;

      // Check if odds are available
      const { data: oddsData } = await supabase
        .from("odds_cache")
        .select("fixture_id, captured_at")
        .eq("fixture_id", fixture.id)
        .single();

      // Enrich analysis with fixture data and odds info
      setAnalysis({
        ...analysisData,
        home: {
          ...analysisData.home,
          name: fixture.teams_home?.name,
          logo: fixture.teams_home?.logo,
        },
        away: {
          ...analysisData.away,
          name: fixture.teams_away?.name,
          logo: fixture.teams_away?.logo,
        },
        odds_available: !!oddsData,
      });

      // If odds available, fetch value analysis
      if (oddsData) {
        const { data: valueData, error: valueError } = await supabase.functions.invoke("calculate-value", {
          body: { fixtureId: fixture.id },
        });

        if (!valueError && valueData) {
          // Add computed_at to each edge
          const edgesWithTimestamp = valueData.edges?.map((edge: any) => ({
            ...edge,
            computed_at: oddsData.captured_at,
          }));
          setValueAnalysis({ ...valueData, edges: edgesWithTimestamp });
        }
      }
    } catch (error: any) {
      console.error("Error analyzing fixture:", error);
      toast({
        title: "Error",
        description: "Failed to analyze fixture. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const [ticketCreatorOpen, setTicketCreatorOpen] = useState(false);

  // OLD Bet Optimizer (Safe/Standard/Risky)
  const generateQuickTicket = async (mode: "safe" | "standard" | "risky") => {
    setGeneratingTicket(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-ticket", {
        body: {
          mode,
          date: format(selectedDate, "yyyy-MM-dd"),
          leagueIds: selectedLeague ? [selectedLeague.id] : [],
        },
      });

      if (error) throw error;

      setCurrentTicket(data);
      setTicketDrawerOpen(true);

      toast({
        title: "Ticket generated!",
        description: `${data.legs.length} selections with ${data.total_odds.toFixed(2)}x total odds`,
      });
    } catch (error: any) {
      console.error("Error generating ticket:", error);
      toast({
        title: "Error",
        description: "Failed to generate ticket. Please try again.",
        variant: "destructive",
      });
    } finally {
      setGeneratingTicket(false);
    }
  };

  // NEW AI Ticket Creator (with custom parameters)
  const generateAITicket = async (params: any) => {
    setGeneratingTicket(true);
    try {
      const fixtureIds = displayFixtures.map((f: any) => f.id);

      if (fixtureIds.length === 0) {
        toast({
          title: "No Fixtures",
          description: "No fixtures available to create a ticket.",
          variant: "destructive",
        });
        return;
      }

      // Build includeMarkets object from array
      const includeMarketsObj = params.includeMarkets.reduce((acc: any, market: string) => {
        acc[market] = true;
        return acc;
      }, {});

      const { data, error } = await supabase.functions.invoke("generate-ticket", {
        body: {
          fixtureIds,
          minOdds: params.targetMin,
          maxOdds: params.targetMax,
          risk: params.risk,
          includeMarkets: includeMarketsObj,
          legsMin: params.minLegs,
          legsMax: params.maxLegs,
          useLiveOdds: params.useLiveOdds,
        },
      });

      if (error) {
        const errorMsg = error.message || "Failed to generate ticket";
        throw new Error(errorMsg);
      }

      // Check for error response
      if (data.code) {
        throw new Error(data.message || "Failed to generate ticket");
      }

      const ticketData = {
        mode: params.risk,
        legs: data.ticket.legs.map((leg: any) => ({
          fixture_id: leg.fixtureId,
          home_team: leg.homeTeam,
          away_team: leg.awayTeam,
          pick: leg.selection,
          market: leg.market,
          odds: leg.odds,
          bookmaker: leg.bookmaker,
        })),
        total_odds: data.ticket.total_odds,
        used_live: data.used_live,
        fallback_to_prematch: data.fallback_to_prematch,
      };

      setCurrentTicket(ticketData);
      setTicketDrawerOpen(true);
      setTicketCreatorOpen(false);

      const oddsSource = data.used_live ? "Live" : "Pre-match";
      const fallbackNote = data.fallback_to_prematch ? " (fallback from live)" : "";

      toast({
        title: "AI Ticket created!",
        description: `${data.ticket.legs.length} selections with ${data.ticket.total_odds.toFixed(2)}x total odds • ${oddsSource}${fallbackNote}`,
      });
    } catch (error: any) {
      console.error("Error generating AI ticket:", error);
      throw error; // Re-throw so dialog can catch it
    } finally {
      setGeneratingTicket(false);
    }
  };

  const handleApplyFilters = async (filters: FilterCriteria) => {
    if (!selectedLeague) return;

    setFilterCriteria(filters);

    try {
      const { data, error } = await supabase.functions.invoke("filterizer-query", {
        body: {
          leagueIds: [selectedLeague.id],
          date: format(selectedDate, "yyyy-MM-dd"),
          markets: filters.markets,
          thresholds: filters.thresholds,
        },
      });

      if (error) throw error;

      setFilteredFixtures(data.fixtures || []);

      toast({
        title: "Filters Applied",
        description: `Found ${data.filtered_count} fixtures matching your criteria`,
      });
    } catch (error: any) {
      console.error("Error applying filters:", error);
      toast({
        title: "Error",
        description: "Failed to apply filters. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleClearFilters = () => {
    setFilterCriteria(null);
    setFilteredFixtures([]);
    setShowFilterizer(false);
  };

  const displayFixtures = filterCriteria ? filteredFixtures : fixtures;

  return (
    <div className="h-screen flex flex-col">
      <AppHeader />

      <div className="flex flex-1 overflow-hidden">
        <LeftRail
          countries={MOCK_COUNTRIES}
          selectedCountry={selectedCountry}
          onSelectCountry={setSelectedCountry}
          leagues={leagues}
          selectedLeague={selectedLeague}
          onSelectLeague={setSelectedLeague}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b border-border bg-card/30 backdrop-blur-sm p-4 flex items-center justify-between shrink-0">
            <h2 className="text-xl font-semibold">
              {filterCriteria ? "Filtered Fixtures" : "All Fixtures"}
            </h2>
            <Button
              variant={showFilterizer ? "default" : "outline"}
              size="sm"
              onClick={() => setShowFilterizer(!showFilterizer)}
              className="gap-2"
            >
              <Filter className="h-4 w-4" />
              {showFilterizer ? "Hide Filters" : "Show Filters"}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {showFilterizer && (
              <FilterizerPanel
                onApplyFilters={handleApplyFilters}
                onClearFilters={handleClearFilters}
                isActive={!!filterCriteria}
              />
            )}

            <CenterRail
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              league={selectedLeague}
              fixtures={displayFixtures}
              loading={loadingFixtures}
              onAnalyze={handleAnalyze}
            />
          </div>
        </div>

        <div className="w-[360px] flex flex-col overflow-hidden border-l border-border">
          {/* Bet Optimizer (Quick) */}
          <div className="p-4 border-b bg-card/30 backdrop-blur-sm space-y-2 shrink-0">
            <div className="text-sm font-semibold mb-2">Bet Optimizer</div>
            <div className="grid grid-cols-3 gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => generateQuickTicket("safe")}
                disabled={generatingTicket}
              >
                <Shield className="h-3.5 w-3.5" />
                Safe
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => generateQuickTicket("standard")}
                disabled={generatingTicket}
              >
                <Ticket className="h-3.5 w-3.5" />
                Standard
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => generateQuickTicket("risky")}
                disabled={generatingTicket}
              >
                <Zap className="h-3.5 w-3.5" />
                Risky
              </Button>
            </div>
          </div>

          {/* AI Ticket Creator (Advanced) */}
          <div className="p-4 border-b bg-card/30 backdrop-blur-sm shrink-0">
            <Button
              className="w-full gap-2"
              variant="default"
              onClick={() => setTicketCreatorOpen(true)}
              disabled={displayFixtures.length === 0}
            >
              <Sparkles className="h-4 w-4" />
              AI Ticket Creator
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            <RightRail
              analysis={analysis}
              loading={loadingAnalysis}
              suggested_markets={valueAnalysis?.edges?.slice(0, 4) || []}
              onAddToTicket={(market) => {
                toast({
                  title: "Market added",
                  description: `${market.market} ${market.side} ${market.line} added to considerations`,
                });
              }}
            />
          </div>
        </div>
      </div>

      <TicketCreatorDialog
        open={ticketCreatorOpen}
        onOpenChange={setTicketCreatorOpen}
        onGenerate={generateAITicket}
        fixturesCount={displayFixtures.length}
      />

      <TicketDrawer
        open={ticketDrawerOpen}
        onOpenChange={setTicketDrawerOpen}
        ticket={currentTicket}
        loading={generatingTicket}
      />
    </div>
  );
};

export default Index;
