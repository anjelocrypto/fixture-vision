import { useState, useEffect, useCallback } from "react";
import { AppHeader } from "@/components/AppHeader";
import { LeftRail } from "@/components/LeftRail";
import { CenterRail } from "@/components/CenterRail";
import { RightRail } from "@/components/RightRail";
import { FilterizerPanel, FilterCriteria } from "@/components/FilterizerPanel";
import { SelectionsDisplay } from "@/components/SelectionsDisplay";
import { TicketDrawer } from "@/components/TicketDrawer";
import { TicketCreatorDialog } from "@/components/TicketCreatorDialog";
import { AdminRefreshButton } from "@/components/AdminRefreshButton";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Filter, Sparkles, Shield, Zap, Ticket, Menu, BarChart3 } from "lucide-react";
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [selectedLeague, setSelectedLeague] = useState<any>(null);
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [analysis, setAnalysis] = useState<any>(null);
  const [valueAnalysis, setValueAnalysis] = useState<any>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [showFilterizer, setShowFilterizer] = useState(false);
  const [filterCriteria, setFilterCriteria] = useState<FilterCriteria | null>(null);
  const [filteredFixtures, setFilteredFixtures] = useState<any[]>([]);
  const [ticketDrawerOpen, setTicketDrawerOpen] = useState(false);
  const [currentTicket, setCurrentTicket] = useState<any>(null);
  const [generatingTicket, setGeneratingTicket] = useState(false);
  const [leftSheetOpen, setLeftSheetOpen] = useState(false);
  const [rightSheetOpen, setRightSheetOpen] = useState(false);

  const SEASON = 2025;

  // Prefetch leagues for all major countries on initial load
  useEffect(() => {
    const prefetchAllCountries = async () => {
      // Skip World (id: 0) and prefetch all others
      const countriesToPrefetch = MOCK_COUNTRIES.filter(c => c.id !== 0);
      
      for (const country of countriesToPrefetch) {
        queryClient.prefetchQuery({
          queryKey: ['leagues', country.id, SEASON],
          queryFn: async () => {
            const { data } = await supabase.functions.invoke("fetch-leagues", {
              body: { country: country.name, season: SEASON },
            });
            return data;
          },
          staleTime: 5 * 60 * 1000,
        });
      }
    };

    // Start prefetching after a short delay to prioritize initial render
    const timer = setTimeout(() => {
      prefetchAllCountries();
    }, 500);

    return () => clearTimeout(timer);
  }, [queryClient]);

  // Reset league, date, and invalidate queries when country changes
  useEffect(() => {
    if (selectedCountry !== null) {
      console.log(`[Index] Country changed to: ${selectedCountry}`);
      setSelectedLeague(null);
      setSelectedDate(today); // Reset to today
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
  const { data: leaguesData, isError: leaguesError, isLoading: leaguesLoading } = useQuery({
    queryKey: ['leagues', selectedCountry, SEASON],
    queryFn: async () => {
      const country = MOCK_COUNTRIES.find((c) => c.id === selectedCountry);
      if (!country || country.id === 0) return { leagues: [] };

      console.log(`[Index] Fetching leagues for country: ${country.name}, season: ${SEASON}`);

      const { data, error } = await supabase.functions.invoke("fetch-leagues", {
        body: { country: country.name, season: SEASON },
      });

      if (error) {
        console.error(`[Index] Error fetching leagues for ${country.name}:`, error);
        throw error;
      }

      console.log(`[Index] Fetched ${data?.leagues?.length || 0} leagues for ${country.name}`);
      return data;
    },
    enabled: !!selectedCountry && selectedCountry !== 0,
    staleTime: 5 * 60 * 1000, // 5 minutes (shorter for faster updates)
    gcTime: 60 * 60 * 1000, // Keep in cache for 1 hour
    retry: 1,
    refetchOnWindowFocus: false, // Don't refetch on window focus for better performance
  });

  // Prefetch leagues for adjacent countries on hover
  const prefetchLeagues = useCallback((countryId: number) => {
    const country = MOCK_COUNTRIES.find((c) => c.id === countryId);
    if (!country || country.id === 0) return;

    queryClient.prefetchQuery({
      queryKey: ['leagues', countryId, SEASON],
      queryFn: async () => {
        const { data } = await supabase.functions.invoke("fetch-leagues", {
          body: { country: country.name, season: SEASON },
        });
        return data;
      },
      staleTime: 5 * 60 * 1000,
    });
  }, [queryClient]);

  // Show error toast when leagues fail to load
  useEffect(() => {
    if (leaguesError && selectedCountry) {
      const country = MOCK_COUNTRIES.find((c) => c.id === selectedCountry);
      toast({
        title: "Unable to load leagues",
        description: `Could not fetch leagues for ${country?.name}. The API might be rate limited or unavailable. Please try again later.`,
        variant: "destructive",
      });
    }
  }, [leaguesError, selectedCountry]);

  // Fetch upcoming fixtures (today + next 7 days) with React Query
  const { data: fixturesData, isLoading: loadingFixtures } = useQuery({
    queryKey: ['fixtures', selectedCountry, SEASON, selectedLeague?.id, 'upcoming', userTimezone],
    queryFn: async () => {
      if (!selectedLeague) return { fixtures: [] };

      console.log(`[Index] Fetching upcoming fixtures for league: ${selectedLeague.id}, season: ${SEASON}, tz: ${userTimezone}`);

      const { data, error } = await supabase.functions.invoke("fetch-fixtures", {
        body: {
          league: selectedLeague.id,
          season: SEASON,
          date: format(today, "yyyy-MM-dd"), // Still pass for compatibility
          tz: userTimezone,
        },
      });

      if (error) throw error;

      console.log(`[Index] Fetched ${data?.fixtures?.length || 0} upcoming fixtures`);
      return data;
    },
    enabled: !!selectedLeague,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const leagues = leaguesData?.leagues || [];
  
  // Filter fixtures for selected date and ensure only upcoming fixtures
  const nowSec = Math.floor(Date.now() / 1000);
  const allUpcomingFixtures = (fixturesData?.fixtures || []).filter(
    (fx: any) => fx.timestamp >= nowSec
  );
  
  const fixtures = allUpcomingFixtures.filter(
    (fx: any) => format(new Date(fx.timestamp * 1000), "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd")
  );

  // Auto-select next available date if current date has no fixtures
  useEffect(() => {
    if (!loadingFixtures && selectedLeague && allUpcomingFixtures.length > 0 && fixtures.length === 0) {
      // Find the first date with fixtures in the next 7 days
      const nextDateWithFixtures = allUpcomingFixtures[0];
      if (nextDateWithFixtures) {
        const nextDate = new Date(nextDateWithFixtures.timestamp * 1000);
        nextDate.setHours(0, 0, 0, 0);
        if (nextDate.getTime() !== selectedDate.getTime()) {
          console.log(`Auto-selecting next date with fixtures: ${format(nextDate, "MMM d")}`);
          setSelectedDate(nextDate);
        }
      }
    }
  }, [loadingFixtures, selectedLeague, allUpcomingFixtures.length, fixtures.length]);

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
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      
      const { data: analysisData, error: analysisError } = await supabase.functions.invoke("analyze-fixture", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
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
          headers: token ? { Authorization: `Bearer ${token}` } : {},
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
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      
      const { data, error } = await supabase.functions.invoke("generate-ticket", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
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

      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const { data, error } = await supabase.functions.invoke("generate-ticket", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
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
    setFilterCriteria(filters);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      
      // Get country code if country is selected
      const country = MOCK_COUNTRIES.find((c) => c.id === selectedCountry);
      const countryCode = country && country.id !== 0 ? country.code : undefined;
      
      const { data, error } = await supabase.functions.invoke("filterizer-query", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: {
          date: format(selectedDate, "yyyy-MM-dd"),
          market: filters.market,
          line: filters.line,
          minOdds: filters.minOdds,
          countryCode,
          leagueIds: selectedLeague ? [selectedLeague.id] : undefined,
        },
      });

      if (error) throw error;

      setFilteredFixtures(data.selections || []);

      toast({
        title: "Filters Applied",
        description: `Found ${data.count} selections matching your criteria (${filters.market} Over ${filters.line})`,
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

      <div className="flex flex-1 overflow-hidden relative">
        {/* Desktop Left Rail */}
        <div className="hidden lg:block">
          <LeftRail
            countries={MOCK_COUNTRIES}
            selectedCountry={selectedCountry}
            onSelectCountry={(id) => {
              setSelectedCountry(id);
              setLeftSheetOpen(false);
            }}
            leagues={leagues}
            selectedLeague={selectedLeague}
            onSelectLeague={(league) => {
              setSelectedLeague(league);
              setLeftSheetOpen(false);
            }}
            leaguesLoading={leaguesLoading}
            leaguesError={leaguesError}
            onCountryHover={prefetchLeagues}
          />
        </div>

        {/* Mobile Left Sheet */}
        <Sheet open={leftSheetOpen} onOpenChange={setLeftSheetOpen}>
          <SheetContent side="left" className="w-[280px] p-0 lg:hidden">
            <LeftRail
              countries={MOCK_COUNTRIES}
              selectedCountry={selectedCountry}
              onSelectCountry={(id) => {
                setSelectedCountry(id);
                setLeftSheetOpen(false);
              }}
              leagues={leagues}
              selectedLeague={selectedLeague}
              onSelectLeague={(league) => {
                setSelectedLeague(league);
                setLeftSheetOpen(false);
              }}
              leaguesLoading={leaguesLoading}
              leaguesError={leaguesError}
              onCountryHover={prefetchLeagues}
            />
          </SheetContent>
        </Sheet>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b border-border bg-card/30 backdrop-blur-sm p-3 sm:p-4 flex items-center justify-between shrink-0 gap-2">
            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden shrink-0"
              onClick={() => setLeftSheetOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            
            <h2 className="text-base sm:text-xl font-semibold truncate">
              {filterCriteria 
                ? `Optimized Selections: ${filterCriteria.market} Over ${filterCriteria.line}` 
                : "All Fixtures"}
            </h2>
            
            <div className="flex gap-2 shrink-0">
              <AdminRefreshButton />
              <Button
                variant={showFilterizer ? "default" : "outline"}
                size="sm"
                onClick={() => setShowFilterizer(!showFilterizer)}
                className="gap-2"
              >
                <Filter className="h-4 w-4" />
                <span className="hidden sm:inline">{showFilterizer ? "Hide" : "Show"}</span>
              </Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4">
            {showFilterizer && (
              <FilterizerPanel
                onApplyFilters={handleApplyFilters}
                onClearFilters={handleClearFilters}
                isActive={!!filterCriteria}
              />
            )}

            {filterCriteria ? (
              <SelectionsDisplay 
                selections={filteredFixtures}
                onSelectionClick={(selection) => {
                  console.log("Selection clicked:", selection);
                  toast({
                    title: "Selection Details",
                    description: `${selection.market} ${selection.side} ${selection.line} @ ${selection.odds}`,
                  });
                }}
              />
            ) : (
              <CenterRail
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                league={selectedLeague}
                fixtures={displayFixtures}
                loading={loadingFixtures}
                onAnalyze={handleAnalyze}
              />
            )}
          </div>
        </div>

        {/* Desktop Right Rail */}
        <div className="hidden lg:flex w-[360px] flex-col overflow-hidden border-l border-border">
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

        {/* Mobile Right Sheet */}
        <Sheet open={rightSheetOpen} onOpenChange={setRightSheetOpen}>
          <SheetContent side="right" className="w-full sm:w-[380px] p-0">
            <div className="flex flex-col h-full">
              {/* Bet Optimizer (Quick) */}
              <div className="p-4 border-b bg-card/30 backdrop-blur-sm space-y-2 shrink-0">
                <div className="text-sm font-semibold mb-2">Bet Optimizer</div>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      generateQuickTicket("safe");
                      setRightSheetOpen(false);
                    }}
                    disabled={generatingTicket}
                  >
                    <Shield className="h-3.5 w-3.5" />
                    Safe
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      generateQuickTicket("standard");
                      setRightSheetOpen(false);
                    }}
                    disabled={generatingTicket}
                  >
                    <Ticket className="h-3.5 w-3.5" />
                    Standard
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      generateQuickTicket("risky");
                      setRightSheetOpen(false);
                    }}
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
                  onClick={() => {
                    setTicketCreatorOpen(true);
                    setRightSheetOpen(false);
                  }}
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
                    setRightSheetOpen(false);
                  }}
                />
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {/* Mobile Floating Action Button */}
        <Button
          className="lg:hidden fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full shadow-lg"
          size="icon"
          onClick={() => setRightSheetOpen(true)}
        >
          <BarChart3 className="h-6 w-6" />
        </Button>

        {/* Mobile AI Ticket Creator FAB */}
        <Button
          className="lg:hidden fixed bottom-4 right-4 z-40 h-14 gap-2 rounded-full shadow-lg"
          onClick={() => setTicketCreatorOpen(true)}
          disabled={displayFixtures.length === 0}
        >
          <Sparkles className="h-5 w-5" />
          <span className="text-sm font-semibold">AI Ticket</span>
        </Button>
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
