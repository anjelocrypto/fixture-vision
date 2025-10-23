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
        `Odds backfill: ${oddsResult.fetched} fetched, ${oddsResult.skipped} skipped, ${oddsResult.failed} failed`
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

      const selectionsResult = selectionsData as { scanned: number; inserted: number; skipped: number };

      toast.success(
        `Selections: ${selectionsResult.inserted} upserted from ${selectionsResult.scanned} fixtures`
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
