import { Button } from "@/components/ui/button";
import { RefreshCw, Calendar, CheckCircle2 } from "lucide-react";
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
          .single();

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

  const handleRefresh = async (windowHours: number) => {
    setSelectedWindow(windowHours);
    setIsRefreshing(true);
    
    try {
      toast.info(`Warming ${windowHours}h odds pipeline...`);
      
      const { data, error } = await supabase.functions.invoke(
        "warmup-odds",
        { body: { window_hours: windowHours } }
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

      toast.success(result.message || "Warmup completed successfully");

    } catch (error) {
      console.error("Refresh error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Refresh failed: ${errorMessage}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
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
          className="gap-2 animate-in fade-in slide-in-from-left-2"
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
      )}
    </div>
  );
};
