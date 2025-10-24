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
      toast.info("Warming 48h odds pipeline...");
      
      const { data, error } = await supabase.functions.invoke(
        "warmup-odds",
        { body: { window_hours: 48 } }
      );

      if (error) {
        throw error;
      }

      const result = data as { 
        success: boolean;
        backfill: { scanned: number; fetched: number; skipped: number; failed: number };
        optimize: { scanned: number; with_odds: number; inserted: number; skipped: number; duration_ms: number };
        message: string;
      };

      toast.success(result.message);

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
      {isRefreshing ? "Warming..." : "Warmup (48h)"}
    </Button>
  );
};
