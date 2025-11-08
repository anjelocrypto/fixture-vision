import { Button } from "@/components/ui/button";
import { RefreshCw, Calendar, CheckCircle2, Globe, Search } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const retryWithBackoff = async <T,>(
  fn: () => Promise<T>,
  maxAttempts = 5,
  onAttempt?: (attempt: number) => void
): Promise<T> => {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      onAttempt?.(attempt);
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check if it's a network-related error worth retrying
      const isNetworkError =
        error?.name === "FunctionsFetchError" ||
        error?.message?.includes("network") ||
        error?.message?.includes("ERR_NETWORK") ||
        error?.message?.includes("HTTP2") ||
        error?.message?.includes("QUIC") ||
        error?.message?.includes("fetch") ||
        error?.message?.includes("timeout");
      
      if (!isNetworkError || attempt === maxAttempts) {
        throw error;
      }
      
      // Exponential backoff with jitter: 200ms, 400ms, 800ms, 1600ms, 3200ms
      const baseDelay = 200 * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 100;
      const delay = baseDelay + jitter;
      
      console.log(`[retry] Attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(delay)}ms...`);
      await sleep(delay);
    }
  }
  
  throw lastError;
};

export const AdminRefreshButton = () => {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFetchingFixtures, setIsFetchingFixtures] = useState(false);
  const [isRefreshingStats, setIsRefreshingStats] = useState(false);
  const [isRefreshingResults, setIsRefreshingResults] = useState(false);
  const [isFetchingPredictions, setIsFetchingPredictions] = useState(false);
  const [isPopulatingOutcomes, setIsPopulatingOutcomes] = useState(false);
  const [isVerifyingTeamTotals, setIsVerifyingTeamTotals] = useState(false);
  const [selectedWindow, setSelectedWindow] = useState(120);
  const [currentAttempt, setCurrentAttempt] = useState(0);
  const [showWarmupPrompt, setShowWarmupPrompt] = useState(false);

  const handleFetchFixtures = async () => {
    setIsFetchingFixtures(true);
    setCurrentAttempt(0);
    const startTime = Date.now();
    let finalState: "ok" | "fallback_ok" | "fail" = "fail";

    try {
      toast.info("Fetching fixtures for next 120 hours (5 days)...");

      const { data, error } = await retryWithBackoff(
        () =>
          supabase.functions.invoke("fetch-fixtures", {
            body: { window_hours: 120 },
          }),
        5,
        (attempt) => {
          setCurrentAttempt(attempt);
          if (attempt > 1) {
            toast.info(`Fetching fixtures... (attempt ${attempt}/5)`, { duration: 1500 });
          }
        }
      );

      if (error) throw error;

      // Success path
      finalState = "ok";
      const topFailures =
        Array.isArray(data.top_3_failures) && data.top_3_failures.length
          ? data.top_3_failures.map((f: any) => `${f.reason}=${f.count}`).join(", ")
          : "none";
      const summary =
        `${data.in_window} in window • ${data.inserted} inserted • ${data.updated} updated • ${data.failed} failed`;
      
      if (currentAttempt > 1) {
        toast.success(`Recovered from network hiccup! ${summary}`);
      } else {
        toast.success(`Fixtures: ${summary}`);
      }
      
      console.log("[fetch-fixtures] Result:", data);
      console.log("[fetch-fixtures] Telemetry:", {
        attempts: currentAttempt || 1,
        final_state: finalState,
        duration_ms: Date.now() - startTime,
      });
      
      if (data.top_3_failures?.length) {
        console.warn("[fetch-fixtures] Top failures:", data.top_3_failures);
      }

      // Invalidate badge query to refresh
      queryClient.invalidateQueries({ queryKey: ["last-fetch-run"] });

      // Prompt for warmup
      setShowWarmupPrompt(true);
      setTimeout(() => setShowWarmupPrompt(false), 8000);
    } catch (error: any) {
      console.error("Fetch fixtures final error:", error);
      console.log("[fetch-fixtures] Telemetry:", {
        attempts: currentAttempt || 1,
        final_state: finalState,
        duration_ms: Date.now() - startTime,
        error_message: error?.message || "unknown",
      });

      // Fallback: query logs for actual results
      try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: logData } = await supabase
          .from("optimizer_run_logs")
          .select("*")
          .eq("run_type", "fetch-fixtures")
          .gte("started_at", fiveMinutesAgo)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (logData) {
          finalState = "fallback_ok";
          const scope = logData.scope as any;
          const summary = `Backend finished: ${scope.fixtures_inserted || 0} inserted • ${scope.fixtures_updated || 0} updated • ${scope.fixtures_failed || 0} failed • ${scope.leagues_upserted || 0} leagues`;
          toast.info(
            `Response didn't reach browser, but backend completed. ${summary}`,
            { duration: 8000 }
          );
          console.log("[fetch-fixtures] Fallback result from logs:", logData.scope);
          
          // Invalidate badge query
          queryClient.invalidateQueries({ queryKey: ["last-fetch-run"] });
          
          // Still prompt for warmup
          setShowWarmupPrompt(true);
          setTimeout(() => setShowWarmupPrompt(false), 8000);
          return;
        }
      } catch (fallbackError) {
        console.error("Fallback query failed:", fallbackError);
      }

      toast.error(`Failed to fetch fixtures: ${error.message || "Unknown error"}`);
    } finally {
      setIsFetchingFixtures(false);
      setCurrentAttempt(0);
    }
  };

  const handleRefreshStats = async (windowHours: number) => {
    setIsRefreshingStats(true);
    
    try {
      toast.info(`Refreshing stats for ${windowHours}h window...`);
      
      // Get current session to ensure we have a valid token
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error("Not authenticated. Please log in again.");
      }

      const { data, error } = await supabase.functions.invoke(
        "stats-refresh",
        { 
          body: { window_hours: windowHours, stats_ttl_hours: 24 },
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );

      if (error) {
        console.error("Stats refresh error:", error);
        throw error;
      }

      console.log("Stats refresh result:", data);
      toast.success(data?.message || "Stats refreshed successfully");

    } catch (error) {
      console.error("Stats refresh error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Stats refresh failed: ${errorMessage}`);
    } finally {
      setIsRefreshingStats(false);
    }
  };

  const handleRefresh = async (windowHours: number) => {
    setSelectedWindow(windowHours);
    setIsRefreshing(true);
    
    try {
      toast.info(`Warming ${windowHours}h odds pipeline...`);
      
      // Get current session to ensure we have a valid token
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error("Not authenticated. Please log in again.");
      }
      
      const { data, error } = await supabase.functions.invoke(
        "warmup-odds",
        { 
          body: { window_hours: windowHours },
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );

      if (error) {
        console.error("Function invocation error:", error);
        throw error;
      }

      const result = data as { 
        success: boolean;
        error?: string;
        status?: number;
        details?: any;
        backfill?: { scanned: number; fetched: number; skipped: number; failed: number };
        optimize?: { scanned: number; with_odds: number; inserted: number; skipped: number; duration_ms: number };
        message?: string;
        statsResult?: string;
        started?: boolean;
        force?: boolean;
        window_hours?: number;
      };

      console.log("Warmup result:", result);

      if (!result.success) {
        const errorMsg = result.error || "Unknown error";
        const statusInfo = result.status ? ` (status: ${result.status})` : "";
        const detailsInfo = result.details ? `\nDetails: ${JSON.stringify(result.details).substring(0, 100)}` : "";
        console.error("Warmup failed:", { error: errorMsg, status: result.status, details: result.details });
        toast.error(`Warmup failed: ${errorMsg}${statusInfo}${detailsInfo}`);
        return;
      }

      // Interpret statsResult from warmup-odds
      if ((result as any).statsResult === "already-running") {
        toast.info("Stats refresh already running; warmup proceeding.");
      } else {
        toast.success(result.message || "Warmup queued; selections updating in background.");
      }

    } catch (error) {
      console.error("Refresh error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Refresh failed: ${errorMessage}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRefreshResults = async (windowHours: number = 6) => {
    setIsRefreshingResults(true);
    
    try {
      toast.info(`Refreshing results for last ${windowHours}h...`);
      
      // Get current session to ensure we have a valid token
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error("Not authenticated. Please log in again.");
      }

      const { data, error } = await supabase.functions.invoke(
        "results-refresh",
        { 
          body: { window_hours: windowHours },
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );

      if (error) {
        console.error("Results refresh error:", error);
        throw error;
      }

      const result = data as {
        success: boolean;
        window_hours?: number;
        scanned: number;
        inserted: number;
        skipped: number;
        errors: number;
        duration_ms?: number;
      };

      console.log("Results refresh result:", result);
      
      const summary = `${result.scanned} scanned • ${result.inserted} inserted • ${result.skipped} skipped • ${result.errors} errors`;
      toast.success(`Results refreshed: ${summary}`);

    } catch (error) {
      console.error("Results refresh error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Results refresh failed: ${errorMessage}`);
    } finally {
      setIsRefreshingResults(false);
    }
  };

  const handleFetchPredictions = async (windowHours: number = 72) => {
    setIsFetchingPredictions(true);
    
    try {
      toast.info(`Fetching predictions for ${windowHours}h window...`);
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Not authenticated. Please log in again.");
      }

      const { data, error } = await supabase.functions.invoke(
        "fetch-predictions",
        { 
          body: { window_hours: windowHours, force: false },
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );

      if (error) {
        console.error("Fetch predictions error:", error);
        throw error;
      }

      const result = data as {
        success: boolean;
        scanned: number;
        fetched: number;
        upserted: number;
        skipped: number;
        failed: number;
        duration_ms: number;
      };

      console.log("Fetch predictions result:", result);
      
      const summary = `${result.scanned} scanned • ${result.fetched} fetched • ${result.upserted} upserted • ${result.skipped} skipped • ${result.failed} failed`;
      toast.success(`Predictions: ${summary}`);

    } catch (error) {
      console.error("Fetch predictions error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Fetch predictions failed: ${errorMessage}`);
    } finally {
      setIsFetchingPredictions(false);
    }
  };

  const handlePopulateOutcomes = async (windowHours: number = 72) => {
    setIsPopulatingOutcomes(true);
    
    try {
      toast.info(`Populating winner outcomes for ${windowHours}h window...`);
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Not authenticated. Please log in again.");
      }

      let offset = 0;
      let hasMore = true;
      let totalScanned = 0;
      let totalUpserted = 0;
      let batchCount = 0;

      while (hasMore) {
        batchCount++;
        
        const { data, error } = await supabase.functions.invoke(
          "populate-winner-outcomes",
          { 
            body: { window_hours: windowHours, batch_size: 50, offset },
            headers: {
              Authorization: `Bearer ${session.access_token}`
            }
          }
        );

        if (error) {
          console.error("Populate outcomes error:", error);
          throw error;
        }

        const result = data as {
          success: boolean;
          scanned: number;
          withOdds: number;
          upserted: number;
          skipped: number;
          failed: number;
          duration_ms: number;
          total_fixtures: number;
          has_more: boolean;
          next_offset: number | null;
        };

        console.log(`Batch ${batchCount} result:`, result);
        
        totalScanned += result.scanned;
        totalUpserted += result.upserted;
        hasMore = result.has_more;
        offset = result.next_offset || 0;

        // Show progress
        toast.info(`Batch ${batchCount}: ${result.upserted} outcomes added (${totalScanned}/${result.total_fixtures} fixtures processed)`, {
          duration: 2000,
        });

        // If there are more batches, wait a bit before next call
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      toast.success(`Complete! ${totalUpserted} outcomes from ${totalScanned} fixtures across ${batchCount} batches`);

    } catch (error) {
      console.error("Populate outcomes error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Populate outcomes failed: ${errorMessage}`);
    } finally {
      setIsPopulatingOutcomes(false);
    }
  };

  const handleVerifyTeamTotals = async () => {
    setIsVerifyingTeamTotals(true);
    
    try {
      toast.info("🔍 Verifying team totals market coverage... (this may take 3-5 mins)");
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Not authenticated. Please log in again.");
      }

      const { data, error } = await supabase.functions.invoke(
        "verify-team-totals",
        { 
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );

      if (error) {
        console.error("Team totals verification error:", error);
        throw error;
      }

      console.log("===== TEAM TOTALS VERIFICATION REPORT =====");
      console.log(JSON.stringify(data, null, 2));
      console.log("==========================================");
      
      const summary = data.summary;
      toast.success(
        `Team Totals Report Ready!\n` +
        `📊 ${summary.fixtures_scanned}/${summary.total_fixtures_next_120h} fixtures scanned\n` +
        `🏠 ${summary.home_o15_coverage_pct}% have Home O1.5\n` +
        `✈️ ${summary.away_o15_coverage_pct}% have Away O1.5\n` +
        `Check console for full report`,
        { duration: 10000 }
      );

    } catch (error) {
      console.error("Team totals verification error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Verification failed: ${errorMessage}`);
    } finally {
      setIsVerifyingTeamTotals(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-2">
        <Globe className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground font-medium">Admin: All Countries</span>
      </div>
      <div className="flex gap-2">
        <Button
          onClick={handleFetchFixtures}
          disabled={isFetchingFixtures}
          variant="outline"
          size="sm"
          className="gap-2 relative"
        >
          <Calendar className={`h-4 w-4 ${isFetchingFixtures ? "animate-pulse" : ""}`} />
          {isFetchingFixtures
            ? currentAttempt > 0
              ? `Fetching (${currentAttempt}/5)...`
              : "Fetching..."
            : "Fetch Fixtures"}
        </Button>

      {showWarmupPrompt && (
        <Button
          variant="default"
          size="sm"
          className="gap-2 animate-in fade-in-from-left-2"
          onClick={() => {
            handleRefresh(120);
            setShowWarmupPrompt(false);
          }}
        >
          <CheckCircle2 className="h-4 w-4" />
          Run Warmup (120h)?
        </Button>
      )}
      
      {!showWarmupPrompt && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={isRefreshingStats}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshingStats ? "animate-spin" : ""}`} />
                {isRefreshingStats ? "Refreshing..." : "Refresh Stats"}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleRefreshStats(168)}>
                📆 7 days (168h)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleRefreshStats(120)}>
                🏟️ 5 days (120h)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleRefreshStats(72)}>
                📅 3 days (72h)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={isRefreshing}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                {isRefreshing ? "Warming..." : `Warmup (${selectedWindow}h)`}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleRefresh(168)}>
                📆 7 days (168h)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleRefresh(120)}>
                🏟️ 5 days (120h)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleRefresh(72)}>
                📅 3 days (72h)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleRefresh(6)}>
                ⚡ 6 hours
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleRefresh(1)}>
                🔥 1 hour
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            onClick={() => handleRefreshResults(6)}
            disabled={isRefreshingResults}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <CheckCircle2 className={`h-4 w-4 ${isRefreshingResults ? "animate-pulse" : ""}`} />
            {isRefreshingResults ? "Refreshing..." : "Refresh Results (6h)"}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={isFetchingPredictions || isPopulatingOutcomes}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${(isFetchingPredictions || isPopulatingOutcomes) ? "animate-spin" : ""}`} />
                Winner Pipeline
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleFetchPredictions(72)}>
                📊 Fetch Predictions (72h)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePopulateOutcomes(72)}>
                🎯 Populate Outcomes (72h)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            onClick={handleVerifyTeamTotals}
            disabled={isVerifyingTeamTotals}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Search className={`h-4 w-4 ${isVerifyingTeamTotals ? "animate-pulse" : ""}`} />
            {isVerifyingTeamTotals ? "Verifying..." : "Verify Team Totals"}
          </Button>
        </>
      )}
      </div>
    </div>
  );
};
