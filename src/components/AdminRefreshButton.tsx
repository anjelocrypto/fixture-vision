import { Button } from "@/components/ui/button";
import { RefreshCw, Calendar } from "lucide-react";
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

export const AdminRefreshButton = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFetchingFixtures, setIsFetchingFixtures] = useState(false);
  const [selectedWindow, setSelectedWindow] = useState(48);

  const handleFetchFixtures = async () => {
    setIsFetchingFixtures(true);
    try {
      toast.info("Fetching fixtures for next 72 hours across all allowed leagues...");

      const { data, error } = await supabase.functions.invoke("fetch-fixtures", {
        body: { window_hours: 72 },
      });

      if (error) {
        console.error("Fetch fixtures error:", error);
        toast.error("Failed to fetch fixtures");
        return;
      }

      const topFailures =
        Array.isArray(data.top_3_failures) && data.top_3_failures.length
          ? data.top_3_failures.map((f: any) => `${f.reason}=${f.count}`).join(", ")
          : "none";
      const summary =
        `window=${data.window} • leagues_upserted=${data.leagues_upserted} ` +
        `• in_window=${data.in_window} • inserted=${data.inserted} • updated=${data.updated} • failed=${data.failed} ` +
        `• rpm=${data.rpm_avg}`;
      toast.success(`Fixtures: ${summary}`);
      console.log("[fetch-fixtures] Result:", data);
      console.warn("[fetch-fixtures] Top failures:", data.top_3_failures || []);
    } catch (error) {
      console.error("Error in handleFetchFixtures:", error);
      toast.error("Failed to fetch fixtures");
    } finally {
      setIsFetchingFixtures(false);
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
        className="gap-2"
      >
        <Calendar className={`h-4 w-4 ${isFetchingFixtures ? "animate-pulse" : ""}`} />
        {isFetchingFixtures ? "Fetching..." : "Fetch Fixtures"}
      </Button>
      
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
          <DropdownMenuItem onClick={() => handleRefresh(72)}>
            🏟️ 72 hours
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleRefresh(48)}>
            📅 48 hours
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleRefresh(6)}>
            ⚡ 6 hours
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleRefresh(1)}>
            🔥 1 hour
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
