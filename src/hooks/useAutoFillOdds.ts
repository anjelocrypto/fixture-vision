import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface AutoFillOddsResult {
  odds_yes: number;
  odds_no: number;
  source: "api_football" | "default";
  bookmaker: string;
}

export function useAutoFillOdds(fixtureId: number | null, resolutionRule: string | null) {
  return useQuery({
    queryKey: ["auto-fill-odds", fixtureId, resolutionRule],
    queryFn: async (): Promise<AutoFillOddsResult> => {
      if (!fixtureId || !resolutionRule) {
        return {
          odds_yes: 1.80,
          odds_no: 2.00,
          source: "default",
          bookmaker: "none",
        };
      }

      const { data, error } = await supabase.rpc("get_market_template_odds", {
        _fixture_id: fixtureId,
        _resolution_rule: resolutionRule,
      });

      if (error) {
        console.error("Auto-fill odds error:", error);
        // Return defaults on error
        return {
          odds_yes: 1.80,
          odds_no: 2.00,
          source: "default",
          bookmaker: "none",
        };
      }

      // Parse the JSONB response
      const result = data as unknown as AutoFillOddsResult;
      return {
        odds_yes: result?.odds_yes ?? 1.80,
        odds_no: result?.odds_no ?? 2.00,
        source: result?.source ?? "default",
        bookmaker: result?.bookmaker ?? "none",
      };
    },
    enabled: !!fixtureId && !!resolutionRule,
    staleTime: 1000 * 60 * 5, // 5 min cache
    retry: false, // Don't retry on error, just use defaults
  });
}
