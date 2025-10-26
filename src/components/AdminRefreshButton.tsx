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
      toast.info("Fetching fixtures for top leagues...");
      
      // Top leagues from allowed countries (ID from API-Football)
      const topLeagues = [
        { id: 39, name: "Premier League" },        // England
        { id: 40, name: "Championship" },          // England
        { id: 140, name: "La Liga" },              // Spain
        { id: 141, name: "La Liga 2" },            // Spain
        { id: 135, name: "Serie A" },              // Italy
        { id: 136, name: "Serie B" },              // Italy
        { id: 78, name: "Bundesliga" },            // Germany
        { id: 79, name: "2. Bundesliga" },         // Germany
        { id: 61, name: "Ligue 1" },               // France
        { id: 62, name: "Ligue 2" },               // France
        { id: 88, name: "Eredivisie" },            // Netherlands
        { id: 94, name: "Primeira Liga" },         // Portugal
        { id: 203, name: "Super Lig" },            // Turkey
        { id: 144, name: "Pro League" },           // Belgium
        { id: 179, name: "Premiership" },          // Scotland
        { id: 253, name: "MLS" },                  // USA
        { id: 71, name: "Serie A" },               // Brazil
        { id: 128, name: "Liga Profesional" },     // Argentina
      ];
      
      let totalFetched = 0;
      
      for (const league of topLeagues) {
        try {
          const { data: fixturesData, error: fixturesError } = await supabase.functions.invoke(
            "fetch-fixtures",
            { 
              body: { 
                league: league.id, 
                season: 2025,
                date: new Date().toISOString().split('T')[0],
                tz: "UTC"
              } 
            }
          );
          
          if (!fixturesError && fixturesData?.fixtures) {
            totalFetched += fixturesData.fixtures.length;
            console.log(`✓ ${league.name}: ${fixturesData.fixtures.length} fixtures`);
          }
          
          // Small delay to avoid rate limiting (50 RPM = 1.2s between calls)
          await new Promise(resolve => setTimeout(resolve, 1300));
          
        } catch (err) {
          console.warn(`✗ ${league.name}: ${err}`);
        }
      }
      
      toast.success(`✓ Fetched ${totalFetched} fixtures from ${topLeagues.length} leagues`);
      
    } catch (error) {
      console.error("Fetch fixtures error:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed: ${errorMessage}`);
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
