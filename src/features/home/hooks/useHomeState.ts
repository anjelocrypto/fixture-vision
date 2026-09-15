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

const currentUtc = new Date();
const SEASON = currentUtc.getUTCMonth() >= 6
  ? currentUtc.getUTCFullYear()
  : currentUtc.getUTCFullYear() - 1;

const CATALOGUE_CACHE_KEY = 'league-catalogue-v3';
const CATALOGUE_TTL_MS = 30 * 60 * 1000;

export function useHomeState() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(['common', 'fixtures', 'filterizer', 'optimizer']);
  const queryClient = useQueryClient();
  const { hasAccess, isWhitelisted, isAdmin, trialCredits, refreshAccess } = useAccess();
  const hasPaidAccess = hasAccess || isWhitelisted;

  // No hardcoded country id — the selection is resolved against the country ids
  // the catalogue actually returns (see the auto-select effect below).
  const [selectedCountry, setSelectedCountry] = useState<number | null>(null);
  const today = useMemo(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }, []);
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

  // Supported competition catalogue. This is metadata about which competitions
  // and countries exist — it is NOT filtered by the current season, and the
  // per-league season/availability fields are reported as-is by the backend.
  const { data: allLeaguesData, isLoading: catalogueLoading, isError: catalogueError, refetch: refetchCatalogue } = useQuery({
    queryKey: [CATALOGUE_CACHE_KEY],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("list-leagues-grouped", { body: {} });
      if (error) throw error;
      try {
        localStorage.setItem(CATALOGUE_CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
        // Drop every superseded cache shape, including the season-keyed ones.
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && key.startsWith('leagues-grouped-')) localStorage.removeItem(key);
        }
      } catch { /* storage unavailable — non-fatal */ }
      return data;
    },
    staleTime: CATALOGUE_TTL_MS,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
    initialData: () => {
      // Expiring cache: stale entries are ignored so availability counts can
      // never be served indefinitely from a previous day.
      try {
        const raw = localStorage.getItem(CATALOGUE_CACHE_KEY);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw);
        if (!parsed?.at || Date.now() - parsed.at > CATALOGUE_TTL_MS) {
          localStorage.removeItem(CATALOGUE_CACHE_KEY);
          return undefined;
        }
        return parsed.data;
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
  }, [queryClient, selectedCountry, today]);

  const actualCountries = useMemo(() => {
    if (!allLeaguesData?.countries) return [];
    return allLeaguesData.countries.map((c: any) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      flag: c.flag,
      upcomingFixtures: c.upcoming_fixtures ?? 0,
      currentSeasonLeagues: c.current_season_leagues ?? 0,
      leagueCount: c.leagues?.length ?? 0,
      lastSyncedAt: c.last_synced_at ?? null,
    }));
  }, [allLeaguesData]);

  // Resolve the initial selection against the ids the catalogue actually
  // returned. Prefer a country that has upcoming fixtures; otherwise fall back
  // to the first returned country so the catalogue is never empty on screen.
  useEffect(() => {
    if (selectedCountry !== null || actualCountries.length === 0) return;
    const withFixtures = actualCountries.find((c: any) => c.upcomingFixtures > 0);
    setSelectedCountry((withFixtures ?? actualCountries[0]).id);
  }, [actualCountries, selectedCountry]);

  // A stored/stale selection that no longer exists must not strand the user.
  useEffect(() => {
    if (selectedCountry === null || actualCountries.length === 0) return;
    if (!actualCountries.some((c: any) => c.id === selectedCountry)) {
      setSelectedCountry(actualCountries[0].id);
    }
  }, [actualCountries, selectedCountry]);

  const catalogueMeta = useMemo(() => ({
    catalogueSeason: allLeaguesData?.catalogue_season ?? null,
    currentSeason: allLeaguesData?.current_season ?? SEASON,
    currentSeasonAvailable: allLeaguesData?.current_season_available ?? false,
    totalLeagues: allLeaguesData?.total_leagues ?? 0,
    totalUpcomingFixtures: allLeaguesData?.total_upcoming_fixtures ?? 0,
    generatedAt: allLeaguesData?.generated_at ?? null,
  }), [allLeaguesData]);

  const leaguesData = (() => {
    if (!selectedCountry || !allLeaguesData?.countries) return { leagues: [] };
    const countryGroup = allLeaguesData.countries.find((c: any) => c.id === selectedCountry);
    return { leagues: countryGroup?.leagues || [] };
  })();

  const prefetchLeagues = useCallback((_countryId: number) => {}, []);

  // Background refresh
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: [CATALOGUE_CACHE_KEY] });
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
