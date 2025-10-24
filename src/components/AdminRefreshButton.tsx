import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const AdminRefreshButton = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    
    try {
      // Step 1: Backfill odds
      toast.info("Fetching odds for upcoming fixtures...");
      
      const { data: oddsData, error: oddsError } = await supabase.functions.invoke(
        "backfill-odds",
        { body: {} }
      );

      if (oddsError) {
        throw oddsError;
      }

      const oddsResult = oddsData as { scanned: number; fetched: number; skipped: number; failed: number };
      
      toast.success(
        `Odds (48h): ${oddsResult.scanned} scanned, ${oddsResult.fetched} fetched, ${oddsResult.skipped} skipped (90min cache), ${oddsResult.failed} failed`
      );

      // Step 2: Optimize selections
      toast.info("Optimizing selections...");

      const { data: selectionsData, error: selectionsError } = await supabase.functions.invoke(
        "optimize-selections-refresh",
        { body: {} }
      );

      if (selectionsError) {
        throw selectionsError;
      }

      const selectionsResult = selectionsData as { 
        scanned: number; 
        with_odds: number;
        inserted: number; 
        skipped: number;
        failed: number;
        duration_ms: number;
      };

      toast.success(
        `Selections (48h): ${selectionsResult.inserted} upserted from ${selectionsResult.scanned} fixtures (${selectionsResult.with_odds} with odds) in ${(selectionsResult.duration_ms / 1000).toFixed(1)}s`
      );

    } catch (error) {
      console.error("Refresh error:", error);
      toast.error(`Refresh failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Button
      onClick={handleRefresh}
      disabled={isRefreshing}
      variant="outline"
      size="sm"
      className="gap-2"
    >
      <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
      {isRefreshing ? "Refreshing..." : "Refresh Selections"}
    </Button>
  );
};
