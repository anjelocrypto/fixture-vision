import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Market, Position } from "./useMarkets";

export interface MarketAggregates {
  total_positions: number;
  yes_positions: number;
  no_positions: number;
  yes_stake: number;
  no_stake: number;
  total_pool: number;
  unique_traders: number;
}

export interface MarketWithFixture extends Market {
  fixture?: {
    id: number;
    home_team: string;
    away_team: string;
    kickoff_at: Date;
    league_id: number;
  } | null;
}

export interface ActivityEntry {
  id: string;
  type: "bet" | "system";
  created_at: string;
  outcome?: string;
  net_stake?: number;
  odds_at_placement?: number;
  action?: string;
  details?: Record<string, unknown>;
}

export interface ChartDataPoint {
  time: string;
  timestamp: number;
  yes_percent: number;
  cumulative_yes: number;
  cumulative_no: number;
}

// Fetch market with fixture info
export function useMarketWithFixture(marketId: string | null) {
  return useQuery({
    queryKey: ["market-detail", marketId],
    queryFn: async () => {
      if (!marketId) return null;

      const { data: market, error } = await supabase
        .from("prediction_markets")
        .select("*")
        .eq("id", marketId)
        .single();

      if (error) throw error;

      let fixture = null;
      if (market.fixture_id) {
        const { data: fixtureData } = await supabase
          .from("fixtures")
          .select("id, teams_home, teams_away, timestamp, league_id")
          .eq("id", market.fixture_id)
          .maybeSingle();

        if (fixtureData) {
          fixture = {
            id: fixtureData.id,
            home_team: (fixtureData.teams_home as Record<string, unknown>)?.name as string || "Home",
            away_team: (fixtureData.teams_away as Record<string, unknown>)?.name as string || "Away",
            kickoff_at: new Date(Number(fixtureData.timestamp) * 1000),
            league_id: fixtureData.league_id,
          };
        }
      }

      return { ...market, fixture } as MarketWithFixture;
    },
    enabled: !!marketId,
  });
}

// Fetch market aggregates using the optimized RPC
export function useMarketAggregates(marketId: string | null) {
  return useQuery({
    queryKey: ["market-aggregates", marketId],
    queryFn: async () => {
      if (!marketId) return null;

      const { data, error } = await supabase
        .rpc("get_market_aggregates", { _market_id: marketId });

      if (error) {
        console.error("Error fetching market aggregates:", error);
        // Fallback to client-side calculation if RPC fails
        const { data: positions, error: posError } = await supabase
          .from("market_positions")
          .select("outcome, net_stake, user_id")
          .eq("market_id", marketId);

        if (posError) throw posError;

        const positionsData = positions || [];
        const yesPositions = positionsData.filter((p) => p.outcome === "yes");
        const noPositions = positionsData.filter((p) => p.outcome === "no");

        const yes_stake = yesPositions.reduce((sum, p) => sum + (p.net_stake || 0), 0);
        const no_stake = noPositions.reduce((sum, p) => sum + (p.net_stake || 0), 0);
        const uniqueUsers = new Set(positionsData.map((p) => p.user_id));

        return {
          total_positions: positionsData.length,
          yes_positions: yesPositions.length,
          no_positions: noPositions.length,
          yes_stake,
          no_stake,
          total_pool: yes_stake + no_stake,
          unique_traders: uniqueUsers.size,
        } as MarketAggregates;
      }

      // Parse RPC result (returns JSON)
      return data as unknown as MarketAggregates;
    },
    enabled: !!marketId,
  });
}

// Fetch current user positions for this market
export function useMyMarketPositions(marketId: string | null) {
  return useQuery({
    queryKey: ["my-market-positions", marketId],
    queryFn: async () => {
      if (!marketId) return [];

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("market_positions")
        .select("*")
        .eq("market_id", marketId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Position[];
    },
    enabled: !!marketId,
  });
}

// Fetch activity feed (latest positions + system events)
export function useMarketActivity(marketId: string | null, limit = 50) {
  return useQuery({
    queryKey: ["market-activity", marketId, limit],
    queryFn: async () => {
      if (!marketId) return [];

      // Fetch positions
      const { data: positions, error: posError } = await supabase
        .from("market_positions")
        .select("id, created_at, outcome, net_stake, odds_at_placement")
        .eq("market_id", marketId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (posError) throw posError;

      // Fetch audit log events for this market
      const { data: auditLogs } = await supabase
        .from("admin_market_audit_log")
        .select("id, created_at, action, details")
        .eq("market_id", marketId)
        .order("created_at", { ascending: false })
        .limit(10);

      const betActivities: ActivityEntry[] = (positions || []).map((p) => ({
        id: p.id,
        type: "bet" as const,
        created_at: p.created_at,
        outcome: p.outcome,
        net_stake: p.net_stake,
        odds_at_placement: p.odds_at_placement,
      }));

      const systemActivities: ActivityEntry[] = (auditLogs || []).map((log) => ({
        id: log.id,
        type: "system" as const,
        created_at: log.created_at,
        action: log.action,
        details: log.details as Record<string, unknown>,
      }));

      // Merge and sort by time
      const allActivities = [...betActivities, ...systemActivities].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      return allActivities.slice(0, limit);
    },
    enabled: !!marketId,
  });
}

// Fetch chart data (YES % over time)
export function useMarketChart(marketId: string | null) {
  return useQuery({
    queryKey: ["market-chart", marketId],
    queryFn: async () => {
      if (!marketId) return [];

      const { data, error } = await supabase
        .from("market_positions")
        .select("created_at, outcome, net_stake")
        .eq("market_id", marketId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      if (!data || data.length === 0) return [];

      // Group by hour and compute cumulative yes %
      const hourlyData: Map<string, { yes: number; no: number; timestamp: number }> = new Map();

      let cumulativeYes = 0;
      let cumulativeNo = 0;

      for (const pos of data) {
        const date = new Date(pos.created_at);
        // Round to nearest hour
        date.setMinutes(0, 0, 0);
        const hourKey = date.toISOString();

        if (pos.outcome === "yes") {
          cumulativeYes += pos.net_stake || 0;
        } else {
          cumulativeNo += pos.net_stake || 0;
        }

        hourlyData.set(hourKey, {
          yes: cumulativeYes,
          no: cumulativeNo,
          timestamp: date.getTime(),
        });
      }

      const chartData: ChartDataPoint[] = Array.from(hourlyData.entries()).map(
        ([time, data]) => ({
          time,
          timestamp: data.timestamp,
          cumulative_yes: data.yes,
          cumulative_no: data.no,
          yes_percent:
            data.yes + data.no > 0
              ? Math.round((data.yes / (data.yes + data.no)) * 100)
              : 50,
        })
      );

      return chartData;
    },
    enabled: !!marketId,
  });
}
