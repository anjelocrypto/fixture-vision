import { useState, useEffect, useCallback } from "react";
import { AppHeader } from "@/components/AppHeader";
import { LeftRail } from "@/components/LeftRail";
import { CenterRail } from "@/components/CenterRail";
import { RightRail } from "@/components/RightRail";
import { FilterizerPanel, FilterCriteria } from "@/components/FilterizerPanel";
import { WinnerPanel } from "@/components/WinnerPanel";
import { TeamTotalsPanel } from "@/components/TeamTotalsPanel";
import { SelectionsDisplay } from "@/components/SelectionsDisplay";
import { TicketDrawer } from "@/components/TicketDrawer";
import { TicketCreatorDialog } from "@/components/TicketCreatorDialog";
import { AdminRefreshButton } from "@/components/AdminRefreshButton";
import { PaywallGate } from "@/components/PaywallGate";
import { TrialBadge } from "@/components/TrialBadge";
import { useAccess } from "@/hooks/useAccess";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Filter, Sparkles, Shield, Zap, Ticket, Menu, BarChart3, Trophy, Target } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { formatMarketLabel } from "@/lib/i18nFormatters";

// Helper function to convert country code to flag emoji
const getCountryFlag = (code: string): string => {
  if (code === "WORLD") return "🌍";
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
  { id: 0, name: "World", code: "WORLD" },
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
  const { t, i18n } = useTranslation(['fixtures', 'filterizer', 'optimizer']);
  const queryClient = useQueryClient();
  const { hasAccess, isWhitelisted, isAdmin, trialCredits, refreshAccess } = useAccess();
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

  // Prefetch leagues for all major countries on initial load
  // Removed aggressive global prefetch to avoid API rate limiting
  // We now rely on per-country query below and optional hover prefetch
  // useEffect(() => {
  //   const prefetchAllCountries = async () => {
  //     const countriesToPrefetch = MOCK_COUNTRIES.filter(c => c.id !== 0);
  //     for (const country of countriesToPrefetch) {
  //       queryClient.prefetchQuery({
  //         queryKey: ['leagues', country.id, SEASON],
  //         queryFn: async () => {
  //           const { data } = await supabase.functions.invoke("fetch-leagues", {
  //             body: { country: country.name, season: SEASON },
  //           });
  //           return data;
  //         },
  //         staleTime: 5 * 60 * 1000,
  //       });
  //     }
  //   };
  //   const timer = setTimeout(() => { prefetchAllCountries(); }, 500);
  //   return () => clearTimeout(timer);
  // }, [queryClient]);

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

  // Fetch leagues with exponential backoff + jitter for rate limiting
  const { data: leaguesData, isError: leaguesError, isLoading: leaguesLoading } = useQuery({
    queryKey: ['leagues', selectedCountry, SEASON],
    queryFn: async () => {
      const country = MOCK_COUNTRIES.find((c) => c.id === selectedCountry);
      if (!country || country.id === 0) return { leagues: [] };

      console.log(`[Index] Fetching leagues for country: ${country.name}, season: ${SEASON}`);

      // Exponential backoff: 250ms → 500 → 1000 → 2000 (max 4 tries)
      const maxRetries = 4;
      let attempt = 0;
      
      while (attempt < maxRetries) {
        try {
          const { data, error } = await supabase.functions.invoke("fetch-leagues", {
            body: { country: country.name, season: SEASON },
          });

          if (error) {
            console.error(`[Index] Error fetching leagues (attempt ${attempt + 1}):`, error);
            throw error;
          }

          // If stale cache returned due to rate limit, still use it
          if (data?.stale) {
            console.warn(`[Index] Using stale cache for ${country.name}, retry after ${data.retry_after}s`);
          }

          console.log(`[Index] Fetched ${data?.leagues?.length || 0} leagues for ${country.name}`);
          return data;
        } catch (err: any) {
          attempt++;
          if (attempt >= maxRetries) throw err;
          
          // Exponential backoff with jitter: base * 2^attempt + random(0-100ms)
          const baseDelay = 250;
          const backoff = baseDelay * Math.pow(2, attempt);
          const jitter = Math.random() * 100;
          const delay = backoff + jitter;
          
          console.log(`[Index] Retry ${attempt}/${maxRetries} for ${country.name} after ${Math.round(delay)}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      return { leagues: [] };
    },
    enabled: !!selectedCountry && selectedCountry !== 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false, // Handle retries manually above
    refetchOnWindowFocus: false,
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
    // Check access: paid, whitelisted, or has trial credits
    if (!hasAccess && !isWhitelisted && (trialCredits === null || trialCredits <= 0)) {
      toast({
        title: "No Trial Credits",
        description: "You've used all your free analyses. Subscribe to continue.",
        action: <Button onClick={() => navigate("/pricing")} size="sm">View Plans</Button>,
      });
      setRightSheetOpen(true);
      return;
    }

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

      if (analysisError) {
        // Check for paywall error (402)
        if ((analysisError as any).status === 402) {
          const errorData = (analysisError as any).context?.body;
          if (errorData?.code === 'PAYWALL') {
            toast({
              title: "Trial Expired",
              description: errorData.reason === 'no_trial_credits' 
                ? "You've used all 5 free analyses. Subscribe to continue."
                : "This feature requires a subscription.",
              action: <Button onClick={() => navigate("/pricing")} size="sm">View Plans</Button>,
            });
            await refreshAccess(); // Refresh to update trial credits display
            setLoadingAnalysis(false);
            return;
          }
        }
        throw analysisError;
      }

      // Refresh access to update trial credits count
      await refreshAccess();

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
              title: "Trial Expired",
              description: errorData.reason === 'no_trial_credits' 
                ? "You've used all 5 free generations. Subscribe to continue."
                : "This feature requires a subscription.",
              action: <Button onClick={() => navigate("/pricing")} size="sm">View Plans</Button>,
            });
            await refreshAccess();
            setGeneratingTicket(false);
            return;
          }
        }
        throw error;
      }

      await refreshAccess(); // Refresh trial credits

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
        setTicketCreatorOpen(false);
        return;
      }

      if (error) {
        // Check for paywall error (402)
        if ((error as any).status === 402) {
          const errorData = (error as any).context?.body;
          if (errorData?.code === 'PAYWALL') {
            toast({
              title: "Trial Expired",
              description: errorData.reason === 'no_trial_credits' 
                ? "You've used all 5 free generations. Subscribe to continue."
                : "This feature requires a subscription.",
              action: <Button onClick={() => navigate("/pricing")} size="sm">View Plans</Button>,
            });
            await refreshAccess();
            setGeneratingTicket(false);
            return;
          }
        }
        // If the function returned a non-2xx status, try to surface a friendly message if available
        const friendly = (error as any)?.message || "Failed to generate ticket";
        toast({ title: "Could not generate ticket", description: friendly, variant: "destructive" });
        return;
      }

      await refreshAccess(); // Refresh trial credits

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
              title: "No exact match found",
              description: `Best nearby: ${data.best_nearby.total_odds.toFixed(2)}x (target: ${params.targetMin}–${params.targetMax}x). Check suggestions.`,
              variant: "destructive",
            });
            return;
          }
        } else if (data.code === "NO_FIXTURES_AVAILABLE") {
          // Special handling for no fixtures - show very clear instructions
          toast({ 
            title: "No Fixtures Available", 
            description: "Click 'Fetch Fixtures' in the top bar to load upcoming matches first.",
            variant: "destructive",
            duration: 6000,
          });
          return;
        } else if (data.code === "INSUFFICIENT_CANDIDATES") {
          // Show suggestions from the response
          const suggestions = data.suggestions?.join(" • ") || "Try refreshing fixture data or adjusting your parameters.";
          toast({ 
            title: "Not Enough Valid Selections", 
            description: suggestions,
            variant: "destructive",
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
      };

      // Store params for shuffle
      setLastTicketParams({
        targetMin: params.targetMin,
        targetMax: params.targetMax,
        includeMarkets: params.includeMarkets,
        minLegs: params.minLegs,
        maxLegs: params.maxLegs,
        useLiveOdds: params.useLiveOdds,
        countryCode: selectedCountry ? MOCK_COUNTRIES.find(c => c.id === selectedCountry)?.code : undefined,
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
          limit: 50,
          offset: 0,
          // Respect country/league selection from left rail
          countryCode: selectedCountry && selectedCountry !== 0 ? MOCK_COUNTRIES.find(c => c.id === selectedCountry)?.code : undefined,
          leagueIds: selectedLeague ? [selectedLeague.id] : undefined,
        },
      });

      if (error) throw error;

      setFilteredFixtures(data.selections || []);
      setFilterizerTotalQualified(data.total_qualified || data.count);
      setFilterizerHasMore(data.pagination?.has_more || false);

      const displayMode = filters.showAllOdds ? "All qualifying odds" : "Best per match";
      const totalInfo = filters.showAllOdds && data.total_qualified ? ` (${data.total_qualified} total)` : "";
      
      toast({
        title: "Filters Applied",
        description: `${displayMode}: Found ${data.count} selections${totalInfo} (${filters.market} Over ${filters.line})`,
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
          limit: 50,
          offset: newOffset,
          // Respect country/league selection from left rail (pagination)
          countryCode: selectedCountry && selectedCountry !== 0 ? MOCK_COUNTRIES.find(c => c.id === selectedCountry)?.code : undefined,
          leagueIds: selectedLeague ? [selectedLeague.id] : undefined,
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
                ? `${t('optimizer:title')}: ${formatMarketLabel(filterCriteria.market, i18n.language)} ${t('filterizer:select_line').split('(')[0].trim()} ${filterCriteria.line}` 
                : t('fixtures:all_fixtures')}
            </h2>
            
            <div className="flex gap-2 shrink-0">
              <TrialBadge 
                creditsRemaining={trialCredits} 
                isWhitelisted={isWhitelisted}
                hasAccess={hasAccess}
              />
              {isAdmin && <AdminRefreshButton />}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4">
            {showFilterizer && (
              <PaywallGate feature="Filterizer">
                <FilterizerPanel
                  onApplyFilters={handleApplyFilters}
                  onClearFilters={handleClearFilters}
                  isActive={!!filterCriteria}
                />
              </PaywallGate>
            )}

            {showWinner && (
              <PaywallGate feature="Winner Predictions">
                <WinnerPanel onClose={() => setShowWinner(false)} />
              </PaywallGate>
            )}

            {showTeamTotals && (
              <PaywallGate feature="Team Totals O1.5">
                <TeamTotalsPanel onClose={() => setShowTeamTotals(false)} />
              </PaywallGate>
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
          </div>
        </div>

        {/* Desktop Right Rail */}
        <div className="hidden lg:flex w-[360px] flex-col overflow-hidden border-l border-border">
          <PaywallGate feature="advanced betting tools and AI analysis">
            <>
              {/* AI Ticket Creator (Advanced) */}
              <div className="p-4 border-b bg-card/30 backdrop-blur-sm shrink-0">
                <Button
                  className="w-full gap-2"
                  variant="default"
                  onClick={() => setTicketCreatorOpen(true)}
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
                    }
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
                    }
                  }}
                >
                  <Trophy className="h-4 w-4" />
                  {t('common:winner_1x2')}
                </Button>
                <Button
                  className="w-full gap-2"
                  variant={showTeamTotals ? "default" : "outline"}
                  onClick={() => {
                    setShowTeamTotals(!showTeamTotals);
                    if (!showTeamTotals) {
                      setShowFilterizer(false);
                      setShowWinner(false);
                    }
                  }}
                >
                  <Target className="h-4 w-4" />
                  Team Totals O1.5
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
            </>
          </PaywallGate>
        </div>

        {/* Mobile Right Sheet */}
        <Sheet open={rightSheetOpen} onOpenChange={setRightSheetOpen}>
          <SheetContent side="right" className="w-full sm:w-[380px] p-0">
            <PaywallGate feature="advanced betting tools and AI analysis" allowTrial={true}>
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
                      }
                      setRightSheetOpen(false);
                    }}
                  >
                    <Trophy className="h-4 w-4" />
                    {t('common:winner_1x2')}
                  </Button>
                  <Button
                    className="w-full gap-2"
                    variant={showTeamTotals ? "default" : "outline"}
                    onClick={() => {
                      setShowTeamTotals(!showTeamTotals);
                      if (!showTeamTotals) {
                        setShowFilterizer(false);
                        setShowWinner(false);
                      }
                      setRightSheetOpen(false);
                    }}
                  >
                    <Target className="h-4 w-4" />
                    Team Totals O1.5
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
            </PaywallGate>
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
        >
          <Sparkles className="h-5 w-5" />
          <span className="text-sm font-semibold">{t('common:ai_ticket_creator')}</span>
        </Button>
      </div>

      <TicketCreatorDialog
        open={ticketCreatorOpen}
        onOpenChange={setTicketCreatorOpen}
        onGenerate={generateAITicket}
      />

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
