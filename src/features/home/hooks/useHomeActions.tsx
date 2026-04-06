import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { getEmptyStateMessage } from "@/lib/holidayMessages";
import type { FilterCriteria } from "@/components/FilterizerPanel";

/**
 * Encapsulates all async business actions for the Home page:
 * analyze fixture, generate ticket, shuffle, apply filterizer, etc.
 */
export function useHomeActions(state: any) {
  const {
    hasAccess, isWhitelisted, hasPaidAccess,
    selectedCountry, selectedDate, selectedLeague,
    actualCountries,
    setAnalysis, setValueAnalysis, setLoadingAnalysis,
    setCurrentTicket, setGeneratingTicket,
    setTicketDrawerOpen, setTicketCreatorOpen,
    setRightSheetOpen, setLastTicketParams,
    setFilterCriteria, setFilteredFixtures,
    setFilterizerOffset, setFilterizerTotalQualified,
    setFilterizerHasMore, setLoadingMoreFilterizer,
    filterizerOffset, filterCriteria, filteredFixtures,
    currentTicket, lastTicketParams,
    refreshAccess, toast, navigate, t, i18n,
  } = state;

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const handleAnalyze = useCallback(async (fixture: any) => {
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

    if (isMobile) {
      setRightSheetOpen(true);
    }

    try {
      const homeTeamId = fixture.teams_home?.id;
      const awayTeamId = fixture.teams_away?.id;
      if (!homeTeamId || !awayTeamId) throw new Error("Missing team IDs");

      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const { data: analysisData, error: analysisError } = await supabase.functions.invoke("analyze-fixture", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: { fixtureId: fixture.id, homeTeamId, awayTeamId },
      });

      if (analysisError) {
        if ((analysisError as any).status === 402) {
          toast({
            title: "Premium Feature",
            description: "This feature requires a subscription.",
            action: <Button onClick={() => navigate("/pricing")} size="sm">View Plans</Button>,
          });
          setLoadingAnalysis(false);
          return;
        }
        throw analysisError;
      }

      if (analysisData.stats_available === false) {
        toast({ title: "Stats Not Available", description: analysisData.message || "Insufficient data.", variant: "destructive" });
        setLoadingAnalysis(false);
        return;
      }

      const { data: oddsData } = await supabase
        .from("odds_cache")
        .select("fixture_id, captured_at")
        .eq("fixture_id", fixture.id)
        .single();

      setAnalysis({
        ...analysisData,
        home: { ...analysisData.home, name: fixture.teams_home?.name, logo: fixture.teams_home?.logo },
        away: { ...analysisData.away, name: fixture.teams_away?.name, logo: fixture.teams_away?.logo },
        injuries: analysisData.injuries || { home: [], away: [] },
        odds_available: !!oddsData,
      });

      if (oddsData) {
        const { data: valueData, error: valueError } = await supabase.functions.invoke("calculate-value", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: { fixtureId: fixture.id },
        });
        if (!valueError && valueData) {
          const edgesWithTimestamp = valueData.edges?.map((edge: any) => ({ ...edge, computed_at: oddsData.captured_at }));
          setValueAnalysis({ ...valueData, edges: edgesWithTimestamp });
        }
      }
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to analyze fixture.", variant: "destructive" });
    } finally {
      setLoadingAnalysis(false);
    }
  }, [hasAccess, isWhitelisted, isMobile]);

  const generateAITicket = useCallback(async (params: any) => {
    setGeneratingTicket(true);
    const FUNCTION_TIMEOUT_MS = 15000;
    const timeoutId = setTimeout(() => {}, FUNCTION_TIMEOUT_MS);
    let invokeTimeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const invokePromise = supabase.functions.invoke("generate-ticket", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: {
          minOdds: params.targetMin,
          maxOdds: params.targetMax,
          risk: params.risk,
          includeMarkets: params.includeMarkets,
          legsMin: params.minLegs,
          legsMax: params.maxLegs,
          useLiveOdds: params.useLiveOdds,
          dayRange: params.dayRange,
          ticketMode: params.ticketMode,
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        invokeTimeoutId = setTimeout(() => reject(new Error("FUNCTION_TIMEOUT")), FUNCTION_TIMEOUT_MS);
      });

      const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

      if (data?.code === "NO_CANDIDATES") {
        toast({ title: "No Candidates Available", description: data.suggestions?.join(" • ") || "Try again.", duration: 8000 });
        await refreshAccess();
        setGeneratingTicket(false);
        setTicketCreatorOpen(false);
        return;
      }

      if (data?.code === "NO_FIXTURES_AVAILABLE") {
        toast({ title: "No Fixtures Available", description: "Click 'Fetch Fixtures' to load matches.", variant: "destructive", duration: 6000 });
        await refreshAccess();
        setGeneratingTicket(false);
        setTicketCreatorOpen(false);
        return;
      }

      if (error) {
        const status = (error as any)?.status || (error as any)?.context?.status;
        const errorBody = (error as any)?.context?.body || {};
        const errorMessage = errorBody?.error || (error as any)?.message || "Failed to generate ticket";

        if (status === 402 && errorBody?.code === 'PAYWALL') {
          toast({
            title: "Premium Feature",
            description: "This feature requires a subscription.",
            action: <Button onClick={() => navigate("/pricing")} size="sm">View Plans</Button>,
          });
          setGeneratingTicket(false);
          return;
        }

        toast({ title: "Could not generate ticket", description: errorMessage, variant: "destructive", duration: 8000 });
        return;
      }

      if (data.code) {
        let friendlyMessage = data.message || "Not enough valid selections.";
        if (data.code === "NO_SOLUTION_IN_BAND" && data.best_nearby) {
          const nearMissTicket = {
            mode: "near-miss",
            legs: data.best_nearby.legs.map((leg: any) => ({
              fixture_id: leg.fixtureId, home_team: leg.homeTeam, away_team: leg.awayTeam,
              pick: leg.selection, market: leg.market, odds: leg.odds, bookmaker: leg.bookmaker,
            })),
            total_odds: data.best_nearby.total_odds,
            target_min: params.targetMin, target_max: params.targetMax,
            within_band: false, suggestions: data.suggestions,
          };
          setCurrentTicket(nearMissTicket);
          setTicketDrawerOpen(true);
          setTicketCreatorOpen(false);
          toast({ title: "📊 Best Match Found", description: `Generated ${data.best_nearby.total_odds.toFixed(2)}x` });
          return;
        }
        if (data.code === "NO_FIXTURES_AVAILABLE") {
          const holidayMsg = getEmptyStateMessage(new Date(), i18n.language as 'en' | 'ka');
          toast({ title: holidayMsg.title, description: holidayMsg.description, duration: 6000 });
          return;
        }
        if (data.code === "INSUFFICIENT_CANDIDATES" || data.code === "POOL_EMPTY") {
          toast({ title: "No Qualifying Matches", description: "No matches meet Safe Zone rules. Try again later.", duration: 8000 });
          return;
        }
        toast({ title: "No ticket generated", description: friendlyMessage, variant: "destructive" });
        return;
      }

      const ticketData = {
        mode: params.risk || "ai",
        legs: data.ticket.legs.map((leg: any) => ({
          fixture_id: leg.fixtureId, home_team: leg.homeTeam, away_team: leg.awayTeam,
          pick: leg.selection, market: leg.market, odds: leg.odds, bookmaker: leg.bookmaker,
        })),
        total_odds: data.ticket.total_odds,
        estimated_win_prob: data.ticket.estimated_win_prob || null,
        target_min: params.targetMin, target_max: params.targetMax,
        within_band: data.within_band !== false,
        used_live: data.used_live, fallback_to_prematch: data.fallback_to_prematch,
        day_range: params.dayRange,
      };

      setLastTicketParams({
        targetMin: params.targetMin, targetMax: params.targetMax,
        includeMarkets: params.includeMarkets,
        minLegs: params.minLegs, maxLegs: params.maxLegs,
        useLiveOdds: params.useLiveOdds, dayRange: params.dayRange,
        countryCode: selectedCountry ? actualCountries.find((c: any) => c.id === selectedCountry)?.code : undefined,
        leagueIds: selectedLeague ? [selectedLeague.id] : undefined,
      });

      setCurrentTicket(ticketData);
      setTicketDrawerOpen(true);
      setTicketCreatorOpen(false);

      const oddsSource = data.used_live ? "Live" : "Pre-match";
      const winProbNote = data.ticket.estimated_win_prob ? ` • Win: ${data.ticket.estimated_win_prob.toFixed(1)}%` : "";
      toast({
        title: "AI Ticket created!",
        description: `${data.ticket.legs.length} selections with ${data.ticket.total_odds.toFixed(2)}x total odds • ${oddsSource}${winProbNote}`,
      });
    } catch (error: any) {
      if (error?.message === "FUNCTION_TIMEOUT") {
        toast({ title: "Request Timeout", description: "Backend took too long. Try again.", variant: "destructive", duration: 8000 });
        return;
      }
      toast({ title: "Error", description: "Failed to generate ticket.", variant: "destructive" });
    } finally {
      clearTimeout(timeoutId);
      if (invokeTimeoutId) clearTimeout(invokeTimeoutId);
      setGeneratingTicket(false);
    }
  }, [selectedCountry, selectedLeague, actualCountries]);

  const shuffleTicket = useCallback(async (lockedLegIds: string[]) => {
    if (!lastTicketParams || !currentTicket) {
      toast({ title: "Cannot shuffle", description: "No ticket parameters available", variant: "destructive" });
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

      const actualLegCount = currentTicket.legs.length;
      const poolMinimum = actualLegCount * 2;
      let attempts = 0;
      const maxAttempts = 3;
      let lastResult = null;

      while (attempts < maxAttempts) {
        attempts++;
        const seed = Date.now() + attempts * 1000;

        const { data, error } = await supabase.functions.invoke("shuffle-ticket", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: {
            lockedLegIds, targetLegs: actualLegCount,
            minOdds: lastTicketParams.targetMin || 1.25,
            maxOdds: lastTicketParams.targetMax || 5.0,
            includeMarkets: lastTicketParams.includeMarkets || ["goals", "corners", "cards"],
            dayRange: lastTicketParams.dayRange || "next_2_days",
            countryCode: lastTicketParams.countryCode,
            leagueIds: lastTicketParams.leagueIds,
            previousTicketHash: ticketHash, seed,
          },
        });

        if (error) throw error;
        if (!data || data.error) {
          toast({ title: data?.error || "Cannot shuffle", description: data?.message || "Failed", variant: "destructive" });
          return;
        }
        lastResult = data;
        if (data.is_different) {
          setCurrentTicket({
            mode: "shuffle", legs: data.legs, total_odds: data.total_odds,
            estimated_win_prob: data.estimated_win_prob, generated_at: data.generated_at,
          });
          toast({ title: "Ticket shuffled!", description: `New combination from ${data.pool_size} candidates` });
          return;
        }
        if (data.pool_size < poolMinimum) break;
      }

      if (lastResult) {
        setCurrentTicket({
          mode: "shuffle", legs: lastResult.legs, total_odds: lastResult.total_odds,
          estimated_win_prob: lastResult.estimated_win_prob, generated_at: lastResult.generated_at,
        });
        toast({ title: "Small pool", description: `Results may repeat with ${lastResult.pool_size} candidates.` });
      }
    } catch (error: any) {
      toast({ title: "Shuffle failed", description: error.message || "Failed to shuffle", variant: "destructive" });
    } finally {
      setGeneratingTicket(false);
    }
  }, [currentTicket, lastTicketParams]);

  const handleApplyFilters = useCallback(async (filters: FilterCriteria) => {
    setFilterCriteria(filters);
    setFilterizerOffset(0);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const { data, error } = await supabase.functions.invoke("filterizer-query", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: {
          date: format(selectedDate, "yyyy-MM-dd"),
          market: filters.market, side: filters.side, line: filters.line,
          minOdds: filters.minOdds, showAllOdds: filters.showAllOdds,
          includeModelOnly: filters.includeModelOnly ?? true,
          allLeagues: filters.allLeagues ?? false,
          dayRange: filters.dayRange ?? "all",
          limit: 50, offset: 0,
          countryCode: filters.allLeagues ? undefined : (selectedCountry && selectedCountry !== 0 ? actualCountries.find((c: any) => c.id === selectedCountry)?.code : undefined),
          leagueIds: filters.allLeagues ? undefined : (selectedLeague ? [selectedLeague.id] : undefined),
        },
      });
      if (error) throw error;
      setFilteredFixtures(data.selections || []);
      setFilterizerTotalQualified(data.total_qualified || data.count);
      setFilterizerHasMore(data.pagination?.has_more || false);
      toast({ title: "Filters Applied", description: `Found ${data.count} selections` });
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to apply filters.", variant: "destructive" });
    }
  }, [selectedDate, selectedCountry, selectedLeague, actualCountries]);

  const handleLoadMoreFilterizer = useCallback(async () => {
    if (!filterCriteria || state.loadingMoreFilterizer || !state.filterizerHasMore) return;
    setLoadingMoreFilterizer(true);
    const newOffset = filterizerOffset + 50;

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const { data, error } = await supabase.functions.invoke("filterizer-query", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: {
          date: format(selectedDate, "yyyy-MM-dd"),
          market: filterCriteria.market, side: filterCriteria.side, line: filterCriteria.line,
          minOdds: filterCriteria.minOdds, showAllOdds: filterCriteria.showAllOdds,
          includeModelOnly: filterCriteria.includeModelOnly ?? true,
          allLeagues: filterCriteria.allLeagues ?? false,
          dayRange: filterCriteria.dayRange ?? "all",
          limit: 50, offset: newOffset,
          countryCode: filterCriteria.allLeagues ? undefined : (selectedCountry && selectedCountry !== 0 ? actualCountries.find((c: any) => c.id === selectedCountry)?.code : undefined),
          leagueIds: filterCriteria.allLeagues ? undefined : (selectedLeague ? [selectedLeague.id] : undefined),
        },
      });
      if (error) throw error;
      setFilteredFixtures((prev: any) => [...prev, ...(data.selections || [])]);
      setFilterizerOffset(newOffset);
      setFilterizerHasMore(data.pagination?.has_more || false);
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to load more.", variant: "destructive" });
    } finally {
      setLoadingMoreFilterizer(false);
    }
  }, [filterCriteria, filterizerOffset, selectedDate, selectedCountry, selectedLeague, actualCountries]);

  const handleClearFilters = useCallback(() => {
    setFilterCriteria(null);
    setFilteredFixtures([]);
    setFilterizerOffset(0);
    setFilterizerTotalQualified(0);
    setFilterizerHasMore(false);
    state.setShowFilterizer(false);
  }, []);

  return {
    handleAnalyze,
    generateAITicket,
    shuffleTicket,
    handleApplyFilters,
    handleLoadMoreFilterizer,
    handleClearFilters,
  };
}
