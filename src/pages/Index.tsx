import { useState, useEffect, useCallback, useMemo } from "react";
import { AppHeader } from "@/components/AppHeader";
import { LeftRail } from "@/components/LeftRail";
import { CenterRail } from "@/components/CenterRail";
import { RightRail } from "@/components/RightRail";
import { FilterizerPanel, FilterCriteria } from "@/components/FilterizerPanel";
import { WinnerPanel } from "@/components/WinnerPanel";
import { TeamTotalsPanel } from "@/components/TeamTotalsPanel";
import { WhoConcedesPanel } from "@/components/WhoConcedesPanel";
import { CardWarPanel } from "@/components/CardWarPanel";
import { BTTSIndexPanel } from "@/components/BTTSIndexPanel";
import { SafeZonePanel } from "@/components/SafeZonePanel";
import { SelectionsDisplay } from "@/components/SelectionsDisplay";
import { TicketDrawer } from "@/components/TicketDrawer";
import { TicketCreatorDialog } from "@/components/TicketCreatorDialog";
import { AdminRefreshButton } from "@/components/AdminRefreshButton";
import { PremiumUpgradeHero } from "@/components/PremiumUpgradeHero";

import { useAccess } from "@/hooks/useAccess";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Filter, Sparkles, Shield, Zap, Ticket, Menu, BarChart3, Trophy, Target, ShieldAlert, Swords, Users, ShieldCheck } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { formatMarketLabel } from "@/lib/i18nFormatters";
import { useIsMobile } from "@/hooks/use-mobile";
import { getEmptyStateMessage } from "@/lib/holidayMessages";

// Helper function to convert country code to flag emoji
const getCountryFlag = (code: string): string => {
  if (code === "GB") return "🏴󠁧󠁢󠁥󠁮󠁧󠁿"; // England
  if (code === "GB-SCT") return "🏴󠁧󠁢󠁳󠁣󠁴󠁿"; // Scotland
  
  // Convert ISO country code to regional indicator symbols
  const codePoints = code
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
};

// Mock countries data - comprehensive coverage
const MOCK_COUNTRIES = [
  { id: 9999, name: "International", code: "INTL" }, // International competitions
  // Western Europe
  { id: 39, name: "England", code: "GB-ENG" },
  { id: 140, name: "Spain", code: "ES" },
  { id: 135, name: "Italy", code: "IT" },
  { id: 78, name: "Germany", code: "DE" },
  { id: 61, name: "France", code: "FR" },
  { id: 88, name: "Netherlands", code: "NL" },
  { id: 94, name: "Portugal", code: "PT" },
  { id: 144, name: "Belgium", code: "BE" },
  { id: 179, name: "Scotland", code: "GB-SCT" },
  { id: 218, name: "Austria", code: "AT" },
  { id: 207, name: "Switzerland", code: "CH" },
  { id: 197, name: "Greece", code: "GR" },
  { id: 119, name: "Denmark", code: "DK" },
  { id: 103, name: "Norway", code: "NO" },
  { id: 113, name: "Sweden", code: "SE" },
  // Eastern Europe
  { id: 203, name: "Turkey", code: "TR" },
  { id: 106, name: "Poland", code: "PL" },
  { id: 345, name: "Czech Republic", code: "CZ" },
  { id: 283, name: "Romania", code: "RO" },
  { id: 210, name: "Croatia", code: "HR" },
  { id: 286, name: "Serbia", code: "RS" },
  { id: 172, name: "Bulgaria", code: "BG" },
  { id: 271, name: "Hungary", code: "HU" },
  { id: 333, name: "Ukraine", code: "UA" },
  { id: 235, name: "Russia", code: "RU" },
  // Americas
  { id: 253, name: "USA", code: "US" },
  { id: 262, name: "Mexico", code: "MX" },
  { id: 71, name: "Brazil", code: "BR" },
  { id: 128, name: "Argentina", code: "AR" },
  { id: 239, name: "Colombia", code: "CO" },
  { id: 265, name: "Chile", code: "CL" },
  { id: 274, name: "Uruguay", code: "UY" },
  { id: 250, name: "Paraguay", code: "PY" },
  { id: 242, name: "Ecuador", code: "EC" },
  // Asia & Oceania
  { id: 98, name: "Japan", code: "JP" },
  { id: 292, name: "South Korea", code: "KR" },
  { id: 188, name: "Australia", code: "AU" },
  { id: 17, name: "China", code: "CN" },
  { id: 307, name: "Saudi Arabia", code: "SA" },
  { id: 301, name: "UAE", code: "AE" },
  { id: 305, name: "Qatar", code: "QA" },
  // Africa
  { id: 288, name: "South Africa", code: "ZA" },
  { id: 233, name: "Egypt", code: "EG" },
  { id: 200, name: "Morocco", code: "MA" },
  { id: 185, name: "Algeria", code: "DZ" },
  { id: 202, name: "Tunisia", code: "TN" },
  // Other
  { id: 383, name: "Israel", code: "IL" },
  { id: 165, name: "Iceland", code: "IS" },
  { id: 244, name: "Finland", code: "FI" },
].map(country => ({ ...country, flag: getCountryFlag(country.code) }));

const Index = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(['common', 'fixtures', 'filterizer', 'optimizer']);
  const queryClient = useQueryClient();
  const { hasAccess, isWhitelisted, isAdmin, trialCredits, refreshAccess } = useAccess();
  const hasPaidAccess = hasAccess || isWhitelisted;
  const isMobile = useIsMobile();
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
  const [showWinner, setShowWinner] = useState(false);
  const [showTeamTotals, setShowTeamTotals] = useState(false);
  const [showWhoConcedes, setShowWhoConcedes] = useState(false);
  const [showCardWar, setShowCardWar] = useState(false);
  const [showBTTSIndex, setShowBTTSIndex] = useState(false);
  const [showSafeZone, setShowSafeZone] = useState(false);
  const [filterCriteria, setFilterCriteria] = useState<FilterCriteria | null>(null);
  const [filteredFixtures, setFilteredFixtures] = useState<any[]>([]);
  const [filterizerOffset, setFilterizerOffset] = useState(0);
  const [filterizerTotalQualified, setFilterizerTotalQualified] = useState(0);
  const [filterizerHasMore, setFilterizerHasMore] = useState(false);
  const [loadingMoreFilterizer, setLoadingMoreFilterizer] = useState(false);
  const [ticketDrawerOpen, setTicketDrawerOpen] = useState(false);
  const [currentTicket, setCurrentTicket] = useState<any>(null);
  const [generatingTicket, setGeneratingTicket] = useState(false);
  const [leftSheetOpen, setLeftSheetOpen] = useState(false);
  const [rightSheetOpen, setRightSheetOpen] = useState(false);
  const [lastTicketParams, setLastTicketParams] = useState<any>(null);
  const [ticketCreatorOpen, setTicketCreatorOpen] = useState(false);

  const SEASON = 2025;

  // Preload ALL leagues once on mount (grouped by country)
  const { data: allLeaguesData } = useQuery({
    queryKey: ['leagues-grouped', SEASON, 'v2'], // Version bump to bust cache
    queryFn: async () => {
      console.log(`[Index] Preloading all leagues for season ${SEASON}...`);
      const start = performance.now();
      
      const { data, error } = await supabase.functions.invoke("list-leagues-grouped", {
        body: { season: SEASON },
      });

      if (error) throw error;

      const elapsed = Math.round(performance.now() - start);
      console.log(`[Index] Preloaded ${data?.countries?.length || 0} countries in ${elapsed}ms`);
      
      // Store in localStorage for offline support with version
      try {
        localStorage.setItem(`leagues-grouped-${SEASON}-v2`, JSON.stringify(data));
        // Clear old cache
        localStorage.removeItem(`leagues-grouped-${SEASON}`);
      } catch (e) {
        console.warn("Failed to cache leagues in localStorage:", e);
      }

      return data;
    },
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 24 * 60 * 60 * 1000, // 24 hours
    retry: 2,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    // On initial load, try to restore from localStorage immediately
    initialData: () => {
      try {
        const cached = localStorage.getItem(`leagues-grouped-${SEASON}-v2`);
        return cached ? JSON.parse(cached) : undefined;
      } catch {
        return undefined;
      }
    },
  });

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

  // Extract actual countries from preloaded grouped data
  const actualCountries = useMemo(() => {
    if (!allLeaguesData?.countries) return []; // Empty array while loading
    
    // Build country list from real backend data
    const countries = allLeaguesData.countries.map((c: any) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      flag: c.flag,
    }));
    
    // Debug logging - check if UEFA is present
    console.log(`[Index] actualCountries count: ${countries.length}`);
    const uefaGroup = countries.find((c: any) => c.id === 9998 || c.code === 'UEFA');
    console.log(`[Index] UEFA group present:`, uefaGroup ? `YES (id=${uefaGroup.id}, name=${uefaGroup.name})` : 'NO - MISSING!');
    
    return countries;
  }, [allLeaguesData]);

  // Debug: Log when mobile left sheet opens and verify UEFA is in the data
  useEffect(() => {
    if (leftSheetOpen && isMobile) {
      console.log(`[Index] Mobile left sheet OPENED`);
      console.log(`[Index] actualCountries passed to mobile LeftRail:`, actualCountries.length);
      const uefaInMobile = actualCountries.find((c: any) => c.id === 9998 || c.code === 'UEFA');
      console.log(`[Index] UEFA in mobile data:`, uefaInMobile ? `YES (${JSON.stringify(uefaInMobile)})` : 'NO - MISSING IN MOBILE!');
    }
  }, [leftSheetOpen, isMobile, actualCountries]);

  // Filter preloaded leagues by selected country (instant, no network)
  const leaguesData = (() => {
    if (!selectedCountry || !allLeaguesData?.countries) {
      return { leagues: [] };
    }

    // Find the country group directly by ID
    const countryGroup = allLeaguesData.countries.find(
      (c: any) => c.id === selectedCountry
    );

    if (!countryGroup) {
      console.log(`[Index] No leagues found for country ID ${selectedCountry} in preloaded data`);
      return { leagues: [] };
    }

    console.log(`[Index] Filtered ${countryGroup.leagues?.length || 0} leagues for ${countryGroup.name} (instant, no network)`);
    return { leagues: countryGroup.leagues || [] };
  })();

  const leaguesLoading = false; // Always instant after initial preload
  const leaguesError = false; // Errors only on initial preload

  // No-op: prefetch is not needed anymore (all leagues preloaded)
  const prefetchLeagues = useCallback((countryId: number) => {
    // All leagues are already preloaded, no network call needed
  }, []);

  // Background refresh for preloaded data (every 15 minutes)
  useEffect(() => {
    const interval = setInterval(() => {
      console.log("[Index] Background refresh: invalidating leagues-grouped");
      queryClient.invalidateQueries({ queryKey: ['leagues-grouped', SEASON] });
    }, 15 * 60 * 1000); // 15 minutes

    return () => clearInterval(interval);
  }, [queryClient]);

  // Query fixtures from database for selected league (upcoming fixtures only)
  const { data: fixturesData, isLoading: loadingFixtures } = useQuery({
    queryKey: ['fixtures', selectedCountry, SEASON, selectedLeague?.id, 'upcoming', userTimezone],
    queryFn: async () => {
      if (!selectedLeague) return { fixtures: [] };

      console.log(`[Index] Querying fixtures from database for league: ${selectedLeague.id}`);

      // Get current timestamp in seconds (for filtering upcoming fixtures)
      const nowTs = Math.floor(Date.now() / 1000);
      // Get timestamp for 7 days from now
      const weekFromNowTs = nowTs + (7 * 24 * 60 * 60);

      const { data, error } = await supabase
        .from("fixtures")
        .select("*")
        .eq("league_id", selectedLeague.id)
        .gte("timestamp", nowTs)
        .lte("timestamp", weekFromNowTs)
        .order("timestamp", { ascending: true });

      if (error) {
        console.error(`[Index] Error querying fixtures:`, error);
        throw error;
      }

      console.log(`[Index] Found ${data?.length || 0} upcoming fixtures for ${selectedLeague.name}`);
      return { fixtures: data || [] };
    },
    enabled: !!selectedLeague,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
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

  const handleAnalyze = async (fixture: any) => {
    // Check access: paid or whitelisted
    if (!hasAccess && !isWhitelisted) {
      toast({
        title: "Premium Feature",
        description: "Subscribe to access match analysis.",
        action: <Button onClick={() => navigate("/pricing")} size="sm">View Plans</Button>,
      });
      setRightSheetOpen(true);
      return;
    }

    setLoadingAnalysis(true);
    setAnalysis(null);
    setValueAnalysis(null);

    // Open right sheet on mobile immediately to show loading state
    if (isMobile) {
      setRightSheetOpen(true);
    }

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

      if (analysisError) {
        // Check for paywall error (402)
        if ((analysisError as any).status === 402) {
          const errorData = (analysisError as any).context?.body;
          if (errorData?.code === 'PAYWALL') {
            toast({
              title: "Premium Feature",
              description: "This feature requires a subscription.",
              action: <Button onClick={() => navigate("/pricing")} size="sm">View Plans</Button>,
            });
            setLoadingAnalysis(false);
            return;
          }
        }
        throw analysisError;
      }

      // Check if stats are available (new integrity check)
      if (analysisData.stats_available === false) {
        console.warn("[Index] Stats not available for fixture:", fixture.id, analysisData.reason);
        toast({
          title: "Stats Not Available",
          description: analysisData.message || "Insufficient data for this fixture. Stats are still being collected.",
          variant: "destructive",
        });
        setLoadingAnalysis(false);
        return;
      }

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
        injuries: analysisData.injuries || { home: [], away: [] },
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

      // Check for NO_FIXTURES_AVAILABLE before checking error
      if (data?.code === "NO_FIXTURES_AVAILABLE") {
        toast({ 
          title: "No Fixtures Available", 
          description: "Click 'Fetch Fixtures' in the top bar to load upcoming matches first.",
          variant: "destructive",
          duration: 6000,
        });
        await refreshAccess(); // Still refresh in case trial was used
        setGeneratingTicket(false);
        return;
      }

      if (error) {
        // Check for paywall error (402)
        if ((error as any).status === 402) {
          const errorData = (error as any).context?.body;
          if (errorData?.code === 'PAYWALL') {
            toast({
              title: "Premium Feature",
              description: "This feature requires a subscription.",
              action: <Button onClick={() => navigate("/pricing")} size="sm">View Plans</Button>,
            });
            setGeneratingTicket(false);
            return;
          }
        }
        throw error;
      }

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

  // NEW AI Ticket Creator (with custom parameters) - GLOBAL MODE
  const generateAITicket = async (params: any) => {
    setGeneratingTicket(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const { data, error } = await supabase.functions.invoke("generate-ticket", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: {
          // Global mode - no fixtureIds required
          minOdds: params.targetMin,
          maxOdds: params.targetMax,
          risk: params.risk,
          includeMarkets: params.includeMarkets,
          legsMin: params.minLegs,
          legsMax: params.maxLegs,
          useLiveOdds: params.useLiveOdds,
          dayRange: params.dayRange,
          ticketMode: params.ticketMode, // New: pass ticket mode to backend
        },
      });

      // Check for NO_CANDIDATES (optimizer not populated yet)
      if (data?.code === "NO_CANDIDATES") {
        const suggestions = data.suggestions?.join(" • ") || "Try again in a minute or adjust your parameters.";
        toast({ 
          title: "No Candidates Available", 
          description: suggestions,
          duration: 8000,
        });
        await refreshAccess();
        setGeneratingTicket(false);
        setTicketCreatorOpen(false);
        return;
      }

      // Check for NO_FIXTURES_AVAILABLE before checking error
      if (data?.code === "NO_FIXTURES_AVAILABLE") {
        toast({ 
          title: "No Fixtures Available", 
          description: "Click 'Fetch Fixtures' in the top bar to load upcoming matches first.",
          variant: "destructive",
          duration: 6000,
        });
        await refreshAccess(); // Still refresh in case trial was used
        setGeneratingTicket(false);
        setTicketCreatorOpen(false);
        return;
      }

      if (error) {
        // Extract error details from Supabase function error structure
        const status = (error as any)?.status || (error as any)?.context?.status;
        const errorBody = (error as any)?.context?.body || {};
        const errorMessage = errorBody?.error || (error as any)?.message || "Failed to generate ticket";
        const errorDetails = errorBody?.details || "";
        const fieldErrors = errorBody?.fields;

        console.error("[Ticket Creator] Edge function error:", {
          error,
          status,
          errorMessage,
          errorDetails,
          fieldErrors,
          fullContext: (error as any)?.context
        });
        
        // Check for paywall error (402)
        if (status === 402) {
          if (errorBody?.code === 'PAYWALL') {
            toast({
              title: "Premium Feature",
              description: "This feature requires a subscription.",
              action: <Button onClick={() => navigate("/pricing")} size="sm">View Plans</Button>,
            });
            setGeneratingTicket(false);
            return;
          }
        }

        // Build user-friendly error message based on status code and error details
        let title = "Could not generate ticket";
        let description = errorMessage;

        if (status === 401) {
          title = "Authentication Error";
          description = "Please log in again to continue.";
        } else if (status === 422) {
          title = "Invalid Parameters";
          if (fieldErrors && Object.keys(fieldErrors).length > 0) {
            const fieldList = Object.entries(fieldErrors)
              .map(([field, errors]: [string, any]) => `${field}: ${Array.isArray(errors) ? errors.join(", ") : errors}`)
              .join("; ");
            description = `${errorMessage}. ${fieldList}`;
          } else if (errorDetails) {
            description = `${errorMessage}: ${errorDetails}`;
          }
        } else if (status === 500) {
          title = "Server Error";
          description = errorDetails 
            ? `${errorMessage}. ${errorDetails}` 
            : "An unexpected error occurred. Please try again or contact support if the issue persists.";
        } else if (errorDetails) {
          description = `${errorMessage}: ${errorDetails}`;
        }
        
        toast({ 
          title, 
          description, 
          variant: "destructive",
          duration: 8000,
        });
        return;
      }

      // Business outcome without ticket
      if (data.code) {
        let friendlyMessage = data.message || "Not enough valid selections.";
        
        // Add context-specific suggestions based on diagnostic reason
        if (data.code === "NO_SOLUTION_IN_BAND") {
          // Show near-miss ticket in drawer with suggestions
          if (data.best_nearby) {
            const nearMissTicket = {
              mode: "near-miss",
              legs: data.best_nearby.legs.map((leg: any) => ({
                fixture_id: leg.fixtureId,
                home_team: leg.homeTeam,
                away_team: leg.awayTeam,
                pick: leg.selection,
                market: leg.market,
                odds: leg.odds,
                bookmaker: leg.bookmaker,
              })),
              total_odds: data.best_nearby.total_odds,
              target_min: params.targetMin,
              target_max: params.targetMax,
              within_band: false,
              suggestions: data.suggestions,
            };
            
            setCurrentTicket(nearMissTicket);
            setTicketDrawerOpen(true);
            setTicketCreatorOpen(false);
            
            toast({
              title: "📊 Best Match Found",
              description: `Generated ${data.best_nearby.total_odds.toFixed(2)}x (target was ${params.targetMin}–${params.targetMax}x). See suggestions below.`,
            });
            return;
          }
        } else if (data.code === "NO_FIXTURES_AVAILABLE") {
          // Special handling for no fixtures - friendly holiday-aware message
          const holidayMsg = getEmptyStateMessage(new Date(), i18n.language as 'en' | 'ka');
          toast({ 
            title: holidayMsg.title, 
            description: holidayMsg.description,
            duration: 6000,
          });
          return;
        } else if (data.code === "INSUFFICIENT_CANDIDATES" || data.code === "POOL_EMPTY") {
          // Show suggestions from the response
          const suggestions = data.suggestions?.join(" • ") || "Try refreshing fixture data or adjusting your parameters.";
          toast({ 
            title: data.code === "POOL_EMPTY" ? "No Valid Selections" : "Not Enough Valid Selections",
            description: suggestions,
            duration: 8000,
          });
          return;
        } else if (data.code === "IMPOSSIBLE_TARGET" && data.diagnostic) {
          const d = data.diagnostic;
          friendlyMessage += ` Try: 1) Widen odds range (current: ${d.target.min}–${d.target.max}), 2) Adjust legs (${d.legs.min}–${d.legs.max}), or 3) Include more markets.`;
        } else if (data.code === "POOL_EMPTY") {
          friendlyMessage += " Try selecting different markets or enabling live odds.";
        } else if (data.code === "INSUFFICIENT_CANDIDATES") {
          friendlyMessage += " Try widening the target range or including more markets.";
        } else {
          friendlyMessage += " Try widening markets or adjusting the target range.";
        }
        
        toast({ 
          title: "No ticket generated", 
          description: friendlyMessage,
          variant: "destructive",
        });
        return;
      }

      const ticketData = {
        mode: params.risk || "ai",
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
        estimated_win_prob: data.ticket.estimated_win_prob || null,
        target_min: params.targetMin,
        target_max: params.targetMax,
        within_band: data.within_band !== false,
        used_live: data.used_live,
        fallback_to_prematch: data.fallback_to_prematch,
        day_range: params.dayRange,
      };

      // Store params for shuffle
      setLastTicketParams({
        targetMin: params.targetMin,
        targetMax: params.targetMax,
        includeMarkets: params.includeMarkets,
        minLegs: params.minLegs,
        maxLegs: params.maxLegs,
        useLiveOdds: params.useLiveOdds,
        dayRange: params.dayRange,
        countryCode: selectedCountry ? actualCountries.find(c => c.id === selectedCountry)?.code : undefined,
        leagueIds: selectedLeague ? [selectedLeague.id] : undefined,
      });

      setCurrentTicket(ticketData);
      setTicketDrawerOpen(true);
      setTicketCreatorOpen(false);

      const oddsSource = data.used_live ? "Live" : "Pre-match";
      const fallbackNote = data.fallback_to_prematch ? " (fallback from live)" : "";
      const winProbNote = data.ticket.estimated_win_prob ? ` • Win: ${data.ticket.estimated_win_prob.toFixed(1)}%` : "";

      toast({
        title: "AI Ticket created!",
        description: `${data.ticket.legs.length} selections with ${data.ticket.total_odds.toFixed(2)}x total odds • ${oddsSource}${fallbackNote}${winProbNote}`,
      });
    } catch (error: any) {
      console.error("Error generating AI ticket:", error);
      throw error; // Re-throw so dialog can catch it
    } finally {
      setGeneratingTicket(false);
    }
  };

  // Shuffle existing ticket with same parameters
  const shuffleTicket = async (lockedLegIds: string[]) => {
    if (!lastTicketParams || !currentTicket) {
      toast({
        title: "Cannot shuffle",
        description: "No ticket parameters available",
        variant: "destructive",
      });
      return;
    }

    setGeneratingTicket(true);
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const ticketHash = currentTicket?.legs
        ?.map((l: any) => {
          const side = l.pick.toLowerCase().includes('over') ? 'over' : 'under';
          const lineMatch = l.pick.match(/(\d+\.?\d*)/);
          const line = lineMatch ? parseFloat(lineMatch[1]) : 2.5;
          return `${l.fixture_id}-${l.market}-${side}-${line}`;
        })
        .sort()
        .join("|");

      // Use actual leg count, not maxLegs
      const actualLegCount = currentTicket.legs.length;
      const poolMinimum = actualLegCount * 2;
      
      let attempts = 0;
      const maxAttempts = 3;
      let lastResult = null;

      // Retry loop: try up to 3 times with different seeds if we get same ticket
      while (attempts < maxAttempts) {
        attempts++;
        
        // Use timestamp-based seed for randomization
        const seed = Date.now() + attempts * 1000;

        const { data, error } = await supabase.functions.invoke("shuffle-ticket", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: {
            lockedLegIds,
            targetLegs: actualLegCount,
            minOdds: lastTicketParams.targetMin || 1.25,
            maxOdds: lastTicketParams.targetMax || 5.0,
            includeMarkets: lastTicketParams.includeMarkets || ["goals", "corners", "cards"],
            dayRange: lastTicketParams.dayRange || "next_2_days",
            countryCode: lastTicketParams.countryCode,
            leagueIds: lastTicketParams.leagueIds,
            previousTicketHash: ticketHash,
            seed,
          },
        });

        if (error) {
          throw error;
        }

        if (!data || data.error) {
          toast({
            title: data?.error || "Cannot shuffle",
            description: data?.message || "Failed to generate new ticket",
            variant: "destructive",
          });
          return;
        }

        lastResult = data;

        // If we got a different ticket, success!
        if (data.is_different) {
          const ticketData = {
            mode: "shuffle",
            legs: data.legs,
            total_odds: data.total_odds,
            estimated_win_prob: data.estimated_win_prob,
            generated_at: data.generated_at,
          };

          setCurrentTicket(ticketData);

          toast({
            title: "Ticket shuffled!",
            description: `New combination from ${data.pool_size} candidates`,
          });
          return;
        }

        // If pool is too small to retry, break
        if (data.pool_size < poolMinimum) {
          break;
        }

        // Otherwise, try again with new seed
        console.log(`[shuffle] Attempt ${attempts}: same ticket, retrying...`);
      }

      // If we exhausted retries, show the result anyway with appropriate message
      if (lastResult) {
        const ticketData = {
          mode: "shuffle",
          legs: lastResult.legs,
          total_odds: lastResult.total_odds,
          estimated_win_prob: lastResult.estimated_win_prob,
          generated_at: lastResult.generated_at,
        };

        setCurrentTicket(ticketData);

        toast({
          title: "Small pool",
          description: `Results may repeat with ${lastResult.pool_size} candidates. Try loosening filters for more variety.`,
        });
      }
    } catch (error: any) {
      console.error("Error shuffling ticket:", error);
      toast({
        title: "Shuffle failed",
        description: error.message || "Failed to shuffle ticket",
        variant: "destructive",
      });
    } finally {
      setGeneratingTicket(false);
    }
  };

  const handleApplyFilters = async (filters: FilterCriteria) => {
    setFilterCriteria(filters);
    setFilterizerOffset(0); // Reset pagination

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      
      const { data, error } = await supabase.functions.invoke("filterizer-query", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: {
          date: format(selectedDate, "yyyy-MM-dd"),
          market: filters.market,
          side: filters.side,
          line: filters.line,
          minOdds: filters.minOdds,
          showAllOdds: filters.showAllOdds,
          includeModelOnly: filters.includeModelOnly ?? true, // Default to true
          allLeagues: filters.allLeagues ?? false, // All-leagues mode
          dayRange: filters.dayRange ?? "all", // Date filter (same as Ticket Creator)
          limit: 50,
          offset: 0,
          // Only send league/country filters if NOT in all-leagues mode
          countryCode: filters.allLeagues ? undefined : (selectedCountry && selectedCountry !== 0 ? actualCountries.find(c => c.id === selectedCountry)?.code : undefined),
          leagueIds: filters.allLeagues ? undefined : (selectedLeague ? [selectedLeague.id] : undefined),
        },
      });

      if (error) throw error;

      setFilteredFixtures(data.selections || []);
      setFilterizerTotalQualified(data.total_qualified || data.count);
      setFilterizerHasMore(data.pagination?.has_more || false);

      const displayMode = filters.showAllOdds ? "All qualifying odds" : "Best per match";
      const scopeInfo = filters.allLeagues ? " (all leagues, next 120h)" : "";
      const totalInfo = filters.showAllOdds && data.total_qualified ? ` (${data.total_qualified} total)` : "";
      
      toast({
        title: "Filters Applied",
        description: `${displayMode}${scopeInfo}: Found ${data.count} selections${totalInfo} (${filters.market} Over ${filters.line})`,
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

  const handleLoadMoreFilterizer = async () => {
    if (!filterCriteria || loadingMoreFilterizer || !filterizerHasMore) return;
    
    setLoadingMoreFilterizer(true);
    const newOffset = filterizerOffset + 50;
    
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      
      const { data, error } = await supabase.functions.invoke("filterizer-query", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: {
          date: format(selectedDate, "yyyy-MM-dd"),
          market: filterCriteria.market,
          side: filterCriteria.side,
          line: filterCriteria.line,
          minOdds: filterCriteria.minOdds,
          showAllOdds: filterCriteria.showAllOdds,
          includeModelOnly: filterCriteria.includeModelOnly ?? true,
          allLeagues: filterCriteria.allLeagues ?? false,
          dayRange: filterCriteria.dayRange ?? "all", // Date filter (same as Ticket Creator)
          limit: 50,
          offset: newOffset,
          // Only send league/country filters if NOT in all-leagues mode
          countryCode: filterCriteria.allLeagues ? undefined : (selectedCountry && selectedCountry !== 0 ? actualCountries.find(c => c.id === selectedCountry)?.code : undefined),
          leagueIds: filterCriteria.allLeagues ? undefined : (selectedLeague ? [selectedLeague.id] : undefined),
        },
      });

      if (error) throw error;

      setFilteredFixtures(prev => [...prev, ...(data.selections || [])]);
      setFilterizerOffset(newOffset);
      setFilterizerHasMore(data.pagination?.has_more || false);
    } catch (error: any) {
      console.error("Error loading more:", error);
      toast({
        title: "Error",
        description: "Failed to load more results.",
        variant: "destructive",
      });
    } finally {
      setLoadingMoreFilterizer(false);
    }
  };

  const handleClearFilters = () => {
    setFilterCriteria(null);
    setFilteredFixtures([]);
    setFilterizerOffset(0);
    setFilterizerTotalQualified(0);
    setFilterizerHasMore(false);
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
            countries={actualCountries}
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
          <SheetContent side="left" className="w-[280px] p-0 lg:hidden overflow-y-auto">
            <LeftRail
              countries={actualCountries}
              selectedCountry={selectedCountry}
              onSelectCountry={(id) => {
                console.log(`[Index] Mobile: Selected country ${id}`);
                setSelectedCountry(id);
                setLeftSheetOpen(false);
              }}
              leagues={leagues}
              selectedLeague={selectedLeague}
              onSelectLeague={(league) => {
                console.log(`[Index] Mobile: Selected league ${league.id} (${league.name})`);
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
                ? `${t('optimizer:title')}: ${formatMarketLabel(filterCriteria.market, i18n.language)} ${t('filterizer:select_line').split('(')[0].trim()} ${filterCriteria.line}` 
                : t('fixtures:all_fixtures')}
            </h2>
            
            <div className="flex gap-2 shrink-0 items-center max-w-full flex-wrap justify-end">
              {isAdmin && <AdminRefreshButton />}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4">
            {/* Show premium upgrade hero for non-subscribers */}
            {!hasPaidAccess ? (
              <PremiumUpgradeHero />
            ) : (
              <>
                {showFilterizer && (
                  <FilterizerPanel
                    onApplyFilters={handleApplyFilters}
                    onClearFilters={handleClearFilters}
                    isActive={!!filterCriteria}
                  />
                )}

                {showWinner && (
                  <WinnerPanel onClose={() => setShowWinner(false)} />
                )}

                {showTeamTotals && (
                  <TeamTotalsPanel onClose={() => setShowTeamTotals(false)} />
                )}

                {showWhoConcedes && (
                  <WhoConcedesPanel onClose={() => setShowWhoConcedes(false)} />
                )}

                {showCardWar && (
                  <CardWarPanel onClose={() => setShowCardWar(false)} />
                )}

                {showBTTSIndex && (
                  <BTTSIndexPanel onClose={() => setShowBTTSIndex(false)} />
                )}

                {showSafeZone && (
                  <SafeZonePanel onClose={() => setShowSafeZone(false)} />
                )}

                {filterCriteria ? (
                  <>
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
                    {filterizerHasMore && (
                      <div className="flex justify-center py-6">
                        <Button
                          variant="outline"
                          onClick={handleLoadMoreFilterizer}
                          disabled={loadingMoreFilterizer}
                          className="gap-2"
                        >
                          {loadingMoreFilterizer ? t('common:loading_more') : `${t('common:load_more')} (${t('common:remaining', { count: filterizerTotalQualified - filteredFixtures.length })})`}
                        </Button>
                      </div>
                    )}
                  </>
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
              </>
            )}
          </div>
        </div>

        {/* Desktop Right Rail - Only show for paid users */}
        {hasPaidAccess && (
          <div className="hidden lg:flex w-[360px] flex-col overflow-hidden border-l border-border">
            {/* AI Ticket Creator (Advanced) */}
            <div className="p-4 border-b bg-card/30 backdrop-blur-sm shrink-0">
              <Button
                className="w-full gap-2"
                variant="default"
                onClick={() => setTicketCreatorOpen(true)}
                data-tutorial="ticket-creator-btn"
              >
                <Sparkles className="h-4 w-4" />
                {t('common:ai_ticket_creator')}
              </Button>
            </div>

            {/* Filterizer, Winner & Team Totals Toggles */}
            <div className="p-4 border-b bg-card/30 backdrop-blur-sm shrink-0">
              <Button
                className="w-full gap-2 mb-2"
                variant={showFilterizer ? "default" : "outline"}
                onClick={() => {
                  setShowFilterizer(!showFilterizer);
                  if (!showFilterizer) {
                    setShowWinner(false);
                    setShowTeamTotals(false);
                    setShowWhoConcedes(false);
                    setShowCardWar(false);
                  }
                }}
                data-tutorial="filterizer-btn"
              >
                <Filter className="h-4 w-4" />
                {t('common:filterizer')}
              </Button>
              <Button
                className="w-full gap-2 mb-2"
                variant={showWinner ? "default" : "outline"}
                onClick={() => {
                  setShowWinner(!showWinner);
                  if (!showWinner) {
                    setShowFilterizer(false);
                    setShowTeamTotals(false);
                    setShowWhoConcedes(false);
                    setShowCardWar(false);
                  }
                }}
                data-tutorial="winner-btn"
              >
                <Trophy className="h-4 w-4" />
                {t('common:winner_1x2')}
              </Button>
              <Button
                className="w-full gap-2 mb-2"
                variant={showTeamTotals ? "default" : "outline"}
                onClick={() => {
                  setShowTeamTotals(!showTeamTotals);
                  if (!showTeamTotals) {
                    setShowFilterizer(false);
                    setShowWinner(false);
                    setShowWhoConcedes(false);
                    setShowCardWar(false);
                    setShowBTTSIndex(false);
                  }
                }}
                data-tutorial="team-totals-btn"
              >
                <Target className="h-4 w-4" />
                {t('common:team_totals')}
              </Button>
              <Button
                className="w-full gap-2 mb-2"
                variant={showWhoConcedes ? "default" : "outline"}
                onClick={() => {
                  setShowWhoConcedes(!showWhoConcedes);
                  if (!showWhoConcedes) {
                    setShowFilterizer(false);
                    setShowWinner(false);
                    setShowTeamTotals(false);
                    setShowCardWar(false);
                    setShowBTTSIndex(false);
                  }
                }}
                data-tutorial="who-concedes-btn"
              >
                <ShieldAlert className="h-4 w-4" />
                {t('common:who_concedes')}
              </Button>
              <Button
                className="w-full gap-2"
                variant={showCardWar ? "default" : "outline"}
                onClick={() => {
                  setShowCardWar(!showCardWar);
                  if (!showCardWar) {
                    setShowFilterizer(false);
                    setShowWinner(false);
                    setShowTeamTotals(false);
                    setShowWhoConcedes(false);
                    setShowBTTSIndex(false);
                  }
                }}
                data-tutorial="card-war-btn"
              >
                <Swords className="h-4 w-4" />
                {t('common:card_war')}
              </Button>
              <Button
                className="w-full gap-2 mb-2"
                variant={showBTTSIndex ? "default" : "outline"}
                onClick={() => {
                  setShowBTTSIndex(!showBTTSIndex);
                  if (!showBTTSIndex) {
                    setShowFilterizer(false);
                    setShowWinner(false);
                    setShowTeamTotals(false);
                    setShowWhoConcedes(false);
                    setShowCardWar(false);
                    setShowSafeZone(false);
                  }
                }}
                data-tutorial="btts-index-btn"
              >
                <Users className="h-4 w-4" />
                {t('common:btts_index')}
              </Button>
              <Button
                className="w-full gap-2"
                variant={showSafeZone ? "default" : "outline"}
                onClick={() => {
                  setShowSafeZone(!showSafeZone);
                  if (!showSafeZone) {
                    setShowFilterizer(false);
                    setShowWinner(false);
                    setShowTeamTotals(false);
                    setShowWhoConcedes(false);
                    setShowCardWar(false);
                    setShowBTTSIndex(false);
                  }
                }}
                data-tutorial="safe-zone-btn"
              >
                <ShieldCheck className="h-4 w-4" />
                Safe Zone
              </Button>
            </div>

            {/* Tool Panels */}
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
        )}

        {/* Mobile Right Sheet - Only show content for paid users */}
        <Sheet open={rightSheetOpen} onOpenChange={setRightSheetOpen}>
          <SheetContent side="right" className="w-full sm:w-[380px] p-0">
            {hasPaidAccess ? (
              <div className="flex flex-col h-full">
                {/* AI Ticket Creator (Advanced) */}
                <div className="p-4 border-b bg-card/30 backdrop-blur-sm shrink-0">
                  <Button
                    className="w-full gap-2"
                    variant="default"
                    onClick={() => {
                      setTicketCreatorOpen(true);
                      setRightSheetOpen(false);
                    }}
                  >
                    <Sparkles className="h-4 w-4" />
                    {t('common:ai_ticket_creator')}
                  </Button>
                </div>

                {/* Filterizer, Winner, Team Totals, Who Concedes & Card War Toggles */}
                <div className="p-4 border-b bg-card/30 backdrop-blur-sm shrink-0">
                  <Button
                    className="w-full gap-2 mb-2"
                    variant={showFilterizer ? "default" : "outline"}
                    onClick={() => {
                      setShowFilterizer(!showFilterizer);
                      if (!showFilterizer) {
                        setShowWinner(false);
                        setShowTeamTotals(false);
                        setShowWhoConcedes(false);
                        setShowCardWar(false);
                      }
                      setRightSheetOpen(false);
                    }}
                  >
                    <Filter className="h-4 w-4" />
                    {t('common:filterizer')}
                  </Button>
                  <Button
                    className="w-full gap-2 mb-2"
                    variant={showWinner ? "default" : "outline"}
                    onClick={() => {
                      setShowWinner(!showWinner);
                      if (!showWinner) {
                        setShowFilterizer(false);
                        setShowTeamTotals(false);
                        setShowWhoConcedes(false);
                        setShowCardWar(false);
                      }
                      setRightSheetOpen(false);
                    }}
                  >
                    <Trophy className="h-4 w-4" />
                    {t('common:winner_1x2')}
                  </Button>
                  <Button
                    className="w-full gap-2 mb-2"
                    variant={showTeamTotals ? "default" : "outline"}
                    onClick={() => {
                      setShowTeamTotals(!showTeamTotals);
                      if (!showTeamTotals) {
                        setShowFilterizer(false);
                        setShowWinner(false);
                        setShowWhoConcedes(false);
                        setShowCardWar(false);
                        setShowBTTSIndex(false);
                      }
                      setRightSheetOpen(false);
                    }}
                  >
                    <Target className="h-4 w-4" />
                    {t('common:team_totals')}
                  </Button>
                  <Button
                    className="w-full gap-2 mb-2"
                    variant={showWhoConcedes ? "default" : "outline"}
                    onClick={() => {
                      setShowWhoConcedes(!showWhoConcedes);
                      if (!showWhoConcedes) {
                        setShowFilterizer(false);
                        setShowWinner(false);
                        setShowTeamTotals(false);
                        setShowCardWar(false);
                        setShowBTTSIndex(false);
                      }
                      setRightSheetOpen(false);
                    }}
                  >
                    <ShieldAlert className="h-4 w-4" />
                    {t('common:who_concedes')}
                  </Button>
                  <Button
                    className="w-full gap-2"
                    variant={showCardWar ? "default" : "outline"}
                    onClick={() => {
                      setShowCardWar(!showCardWar);
                      if (!showCardWar) {
                        setShowFilterizer(false);
                        setShowWinner(false);
                        setShowTeamTotals(false);
                        setShowWhoConcedes(false);
                        setShowBTTSIndex(false);
                      }
                      setRightSheetOpen(false);
                    }}
                  >
                    <Swords className="h-4 w-4" />
                    {t('common:card_war')}
                  </Button>
                  <Button
                    className="w-full gap-2 mb-2"
                    variant={showBTTSIndex ? "default" : "outline"}
                    onClick={() => {
                      setShowBTTSIndex(!showBTTSIndex);
                      if (!showBTTSIndex) {
                        setShowFilterizer(false);
                        setShowWinner(false);
                        setShowTeamTotals(false);
                        setShowWhoConcedes(false);
                        setShowCardWar(false);
                        setShowSafeZone(false);
                      }
                      setRightSheetOpen(false);
                    }}
                  >
                    <Users className="h-4 w-4" />
                    {t('common:btts_index')}
                  </Button>
                  <Button
                    className="w-full gap-2"
                    variant={showSafeZone ? "default" : "outline"}
                    onClick={() => {
                      setShowSafeZone(!showSafeZone);
                      if (!showSafeZone) {
                        setShowFilterizer(false);
                        setShowWinner(false);
                        setShowTeamTotals(false);
                        setShowWhoConcedes(false);
                        setShowCardWar(false);
                        setShowBTTSIndex(false);
                      }
                      setRightSheetOpen(false);
                    }}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {t('common:safe_zone', 'Safe Zone')}
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
            ) : (
              <div className="p-6">
                <PremiumUpgradeHero />
              </div>
            )}
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

        {/* Mobile AI Ticket Creator FAB - Only show for paid users */}
        {!ticketCreatorOpen && hasPaidAccess && (
          <Button
            className="lg:hidden fixed bottom-4 right-4 z-40 h-14 gap-2 rounded-full shadow-lg"
            onClick={() => setTicketCreatorOpen(true)}
          >
            <Sparkles className="h-5 w-5" />
            <span className="text-sm font-semibold">{t('common:ai_ticket_creator')}</span>
          </Button>
        )}
      </div>

      {/* Ticket Creator Dialog - Only render for paid users */}
      {hasPaidAccess && (
        <TicketCreatorDialog
          open={ticketCreatorOpen}
          onOpenChange={setTicketCreatorOpen}
          onGenerate={generateAITicket}
        />
      )}

      <TicketDrawer
        open={ticketDrawerOpen}
        onOpenChange={setTicketDrawerOpen}
        ticket={currentTicket}
        loading={generatingTicket}
        onShuffle={shuffleTicket}
        canShuffle={!!lastTicketParams && currentTicket?.mode !== "near-miss"}
      />
    </div>
  );
};

export default Index;
