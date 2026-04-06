import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAccess } from "@/hooks/useAccess";
import { getEmptyStateMessage } from "@/lib/holidayMessages";
import { Button } from "@/components/ui/button";
import type { FilterCriteria } from "@/components/FilterizerPanel";

// Helper function to convert country code to flag emoji
const getCountryFlag = (code: string): string => {
  if (code === "GB") return "🏴󠁧󠁢󠁥󠁮󠁧󠁿";
  if (code === "GB-SCT") return "🏴󠁧󠁢󠁳󠁣󠁴󠁿";
  const codePoints = code
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
};

const SEASON = 2025;

export function useHomeState() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(['common', 'fixtures', 'filterizer', 'optimizer']);
  const queryClient = useQueryClient();
  const { hasAccess, isWhitelisted, isAdmin, trialCredits, refreshAccess } = useAccess();
  const hasPaidAccess = hasAccess || isWhitelisted;

  const [selectedCountry, setSelectedCountry] = useState<number | null>(140);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [selectedLeague, setSelectedLeague] = useState<any>(null);
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [analysis, setAnalysis] = useState<any>(null);
  const [valueAnalysis, setValueAnalysis] = useState<any>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [filterCriteria, setFilterCriteria] = useState<FilterCriteria | null>(null);
  const [filteredFixtures, setFilteredFixtures] = useState<any[]>([]);
  const [filterizerOffset, setFilterizerOffset] = useState(0);
  const [filterizerTotalQualified, setFilterizerTotalQualified] = useState(0);
  const [filterizerHasMore, setFilterizerHasMore] = useState(false);
  const [loadingMoreFilterizer, setLoadingMoreFilterizer] = useState(false);
  const [currentTicket, setCurrentTicket] = useState<any>(null);
  const [generatingTicket, setGeneratingTicket] = useState(false);
  const [lastTicketParams, setLastTicketParams] = useState<any>(null);

  // Tool panel visibility
  const [showFilterizer, setShowFilterizer] = useState(false);
  const [showWinner, setShowWinner] = useState(false);
  const [showTeamTotals, setShowTeamTotals] = useState(false);
  const [showWhoConcedes, setShowWhoConcedes] = useState(false);
  const [showCardWar, setShowCardWar] = useState(false);
  const [showBTTSIndex, setShowBTTSIndex] = useState(false);
  const [showSafeZone, setShowSafeZone] = useState(false);
  const [showDailyInsights, setShowDailyInsights] = useState(false);

  // Overlay states
  const [leftSheetOpen, setLeftSheetOpen] = useState(false);
  const [rightSheetOpen, setRightSheetOpen] = useState(false);
  const [ticketDrawerOpen, setTicketDrawerOpen] = useState(false);
  const [ticketCreatorOpen, setTicketCreatorOpen] = useState(false);

  // Preload ALL leagues once on mount
  const { data: allLeaguesData } = useQuery({
    queryKey: ['leagues-grouped', SEASON, 'v2'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("list-leagues-grouped", {
        body: { season: SEASON },
      });
      if (error) throw error;
      try {
        localStorage.setItem(`leagues-grouped-${SEASON}-v2`, JSON.stringify(data));
        localStorage.removeItem(`leagues-grouped-${SEASON}`);
      } catch (e) { /* ignore */ }
      return data;
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    initialData: () => {
      try {
        const cached = localStorage.getItem(`leagues-grouped-${SEASON}-v2`);
        return cached ? JSON.parse(cached) : undefined;
      } catch { return undefined; }
    },
  });

  // Reset on country change
  useEffect(() => {
    if (selectedCountry !== null) {
      setSelectedLeague(null);
      setSelectedDate(today);
      setAnalysis(null);
      setValueAnalysis(null);
      setFilterCriteria(null);
      setFilteredFixtures([]);
      queryClient.removeQueries({ queryKey: ['leagues'] });
      queryClient.removeQueries({ queryKey: ['fixtures'] });
      queryClient.invalidateQueries({ queryKey: ['leagues', selectedCountry, SEASON] });
    }
  }, [selectedCountry]);

  const actualCountries = useMemo(() => {
    if (!allLeaguesData?.countries) return [];
    return allLeaguesData.countries.map((c: any) => ({
      id: c.id, name: c.name, code: c.code, flag: c.flag,
    }));
  }, [allLeaguesData]);

  const leaguesData = (() => {
    if (!selectedCountry || !allLeaguesData?.countries) return { leagues: [] };
    const countryGroup = allLeaguesData.countries.find((c: any) => c.id === selectedCountry);
    return { leagues: countryGroup?.leagues || [] };
  })();

  const prefetchLeagues = useCallback((_countryId: number) => {}, []);

  // Background refresh
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['leagues-grouped', SEASON] });
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [queryClient]);

  // Query fixtures
  const { data: fixturesData, isLoading: loadingFixtures } = useQuery({
    queryKey: ['fixtures', selectedCountry, SEASON, selectedLeague?.id, 'upcoming', userTimezone],
    queryFn: async () => {
      if (!selectedLeague) return { fixtures: [] };
      const nowTs = Math.floor(Date.now() / 1000);
      const weekFromNowTs = nowTs + (7 * 24 * 60 * 60);
      const { data, error } = await supabase
        .from("fixtures")
        .select("*")
        .eq("league_id", selectedLeague.id)
        .gte("timestamp", nowTs)
        .lte("timestamp", weekFromNowTs)
        .order("timestamp", { ascending: true });
      if (error) throw error;
      return { fixtures: data || [] };
    },
    enabled: !!selectedLeague,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  const leagues = leaguesData?.leagues || [];
  const nowSec = Math.floor(Date.now() / 1000);
  const allUpcomingFixtures = (fixturesData?.fixtures || []).filter(
    (fx: any) => fx.timestamp >= nowSec
  );
  const fixtures = allUpcomingFixtures.filter(
    (fx: any) => format(new Date(fx.timestamp * 1000), "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd")
  );

  const displayFixtures = filterCriteria ? filteredFixtures : fixtures;

  // Close all tool panels except the specified one
  const openToolExclusive = useCallback((tool: string) => {
    setShowFilterizer(tool === 'filterizer' ? !showFilterizer : false);
    setShowWinner(tool === 'winner' ? !showWinner : false);
    setShowTeamTotals(tool === 'teamTotals' ? !showTeamTotals : false);
    setShowWhoConcedes(tool === 'whoConcedes' ? !showWhoConcedes : false);
    setShowCardWar(tool === 'cardWar' ? !showCardWar : false);
    setShowBTTSIndex(tool === 'bttsIndex' ? !showBTTSIndex : false);
    setShowSafeZone(tool === 'safeZone' ? !showSafeZone : false);
    setShowDailyInsights(tool === 'dailyInsights' ? !showDailyInsights : false);
  }, [showFilterizer, showWinner, showTeamTotals, showWhoConcedes, showCardWar, showBTTSIndex, showSafeZone, showDailyInsights]);

  return {
    // Access
    hasPaidAccess, isAdmin, hasAccess, isWhitelisted, trialCredits, refreshAccess,
    // Selection state
    selectedCountry, setSelectedCountry,
    selectedDate, setSelectedDate,
    selectedLeague, setSelectedLeague,
    // Data
    actualCountries, leagues, fixtures: displayFixtures, loadingFixtures,
    allUpcomingFixtures, filteredFixtures, filterCriteria,
    // Analysis
    analysis, setAnalysis, valueAnalysis, setValueAnalysis,
    loadingAnalysis, setLoadingAnalysis,
    // Ticket
    currentTicket, setCurrentTicket,
    generatingTicket, setGeneratingTicket,
    lastTicketParams, setLastTicketParams,
    // Overlays
    leftSheetOpen, setLeftSheetOpen,
    rightSheetOpen, setRightSheetOpen,
    ticketDrawerOpen, setTicketDrawerOpen,
    ticketCreatorOpen, setTicketCreatorOpen,
    // Tools
    showFilterizer, setShowFilterizer,
    showWinner, setShowWinner,
    showTeamTotals, setShowTeamTotals,
    showWhoConcedes, setShowWhoConcedes,
    showCardWar, setShowCardWar,
    showBTTSIndex, setShowBTTSIndex,
    showSafeZone, setShowSafeZone,
    showDailyInsights, setShowDailyInsights,
    openToolExclusive,
    // Filterizer
    setFilterCriteria, setFilteredFixtures,
    filterizerOffset, setFilterizerOffset,
    filterizerTotalQualified, setFilterizerTotalQualified,
    filterizerHasMore, setFilterizerHasMore,
    loadingMoreFilterizer, setLoadingMoreFilterizer,
    // Utilities
    prefetchLeagues,
    toast, navigate, t, i18n, queryClient,
    SEASON,
  };
}
