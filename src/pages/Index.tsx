import { useState, useEffect } from "react";
import { AppHeader } from "@/components/AppHeader";
import { LeftRail } from "@/components/LeftRail";
import { CenterRail } from "@/components/CenterRail";
import { RightRail } from "@/components/RightRail";
import { FilterizerPanel, FilterCriteria } from "@/components/FilterizerPanel";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Filter } from "lucide-react";

// Mock countries data (will be populated from API)
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
  const [selectedCountry, setSelectedCountry] = useState<number | null>(140); // Spain default
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [league, setLeague] = useState<any>(null);
  const [fixtures, setFixtures] = useState<any[]>([]);
  const [analysis, setAnalysis] = useState<any>(null);
  const [loadingFixtures, setLoadingFixtures] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [showFilterizer, setShowFilterizer] = useState(false);
  const [filterCriteria, setFilterCriteria] = useState<FilterCriteria | null>(null);
  const [filteredFixtures, setFilteredFixtures] = useState<any[]>([]);

  // Fetch leagues when country changes
  useEffect(() => {
    if (selectedCountry && selectedCountry !== 0) {
      fetchLeagues();
    }
  }, [selectedCountry]);

  // Fetch fixtures when league or date changes
  useEffect(() => {
    if (league) {
      fetchFixtures();
    }
  }, [league, selectedDate]);

  const fetchLeagues = async () => {
    try {
      const country = MOCK_COUNTRIES.find((c) => c.id === selectedCountry);
      if (!country) return;

      const { data, error } = await supabase.functions.invoke("fetch-leagues", {
        body: { country: country.name, season: 2025 },
      });

      if (error) throw error;

      if (data?.leagues && data.leagues.length > 0) {
        // Set first league as default (e.g., La Liga for Spain)
        setLeague(data.leagues[0]);
      }
    } catch (error: any) {
      console.error("Error fetching leagues:", error);
      toast({
        title: "Error",
        description: "Failed to load leagues. Please try again.",
        variant: "destructive",
      });
    }
  };

  const fetchFixtures = async () => {
    if (!league) return;

    setLoadingFixtures(true);
    try {
      const { data, error } = await supabase.functions.invoke("fetch-fixtures", {
        body: {
          league: league.id,
          season: 2025,
          date: format(selectedDate, "yyyy-MM-dd"),
        },
      });

      if (error) throw error;

      setFixtures(data?.fixtures || []);
    } catch (error: any) {
      console.error("Error fetching fixtures:", error);
      toast({
        title: "Error",
        description: "Failed to load fixtures. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoadingFixtures(false);
    }
  };

  const handleAnalyze = async (fixture: any) => {
    setLoadingAnalysis(true);
    setAnalysis(null);

    try {
      // Fetch analysis
      const { data: analysisData, error: analysisError } = await supabase.functions.invoke("analyze-fixture", {
        body: { fixtureId: fixture.id },
      });

      if (analysisError) throw analysisError;

      // Check if odds are available
      const { data: oddsData } = await supabase
        .from("odds_cache")
        .select("fixture_id")
        .eq("fixture_id", fixture.id)
        .single();

      setAnalysis({
        ...analysisData,
        odds_available: !!oddsData,
      });
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

  const handleApplyFilters = async (filters: FilterCriteria) => {
    if (!league) return;

    setLoadingFixtures(true);
    setFilterCriteria(filters);

    try {
      const { data, error } = await supabase.functions.invoke("filterizer-query", {
        body: {
          leagueIds: [league.id],
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
    } finally {
      setLoadingFixtures(false);
    }
  };

  const handleClearFilters = () => {
    setFilterCriteria(null);
    setFilteredFixtures([]);
    setShowFilterizer(false);
  };

  const displayFixtures = filterCriteria ? filteredFixtures : fixtures;

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      
      <div className="flex flex-1 overflow-hidden">
        <LeftRail
          countries={MOCK_COUNTRIES}
          selectedCountry={selectedCountry}
          onSelectCountry={setSelectedCountry}
        />
        
        <div className="flex-1 flex flex-col">
          <div className="border-b border-border bg-card/30 backdrop-blur-sm p-4 flex items-center justify-between">
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
              league={league}
              fixtures={displayFixtures}
              loading={loadingFixtures}
              onAnalyze={handleAnalyze}
            />
          </div>
        </div>
        
        <RightRail analysis={analysis} loading={loadingAnalysis} />
      </div>

      <footer className="border-t border-border bg-card/30 backdrop-blur-sm py-4 text-center text-sm text-muted-foreground">
        Made with ❤️ — BETAI
      </footer>
    </div>
  );
};

export default Index;
