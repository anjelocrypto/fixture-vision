import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Market {
  id: string;
  title: string;
  description: string | null;
  category: string;
  market_type: string;
  fixture_id: number | null;
  status: string;
  closes_at: string;
  odds_yes: number;
  odds_no: number;
  total_staked_yes: number;
  total_staked_no: number;
  winning_outcome: string | null;
  resolved_at: string | null;
  created_at: string;
  resolution_rule: string | null;
}

export interface Position {
  id: string;
  market_id: string;
  outcome: string;
  stake: number;
  fee_amount: number;
  net_stake: number;
  odds_at_placement: number;
  potential_payout: number;
  status: string;
  payout_amount: number | null;
  settled_at: string | null;
  created_at: string;
}

export interface UserCoins {
  balance: number;
  total_wagered: number;
  total_won: number;
  total_fees_paid: number;
}

export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  balance: number;
  total_wagered: number;
  total_won: number;
  total_fees_paid: number;
  positions_count: number;
  wins_count: number;
  losses_count: number;
  win_rate: number;
  roi: number;
  rank: number;
}

// Fetch open markets
export function useMarkets(status: "open" | "closed" | "resolved" | "all" = "open") {
  return useQuery({
    queryKey: ["markets", status],
    queryFn: async () => {
      let query = supabase
        .from("prediction_markets")
        .select("*")
        .order("closes_at", { ascending: true });

      if (status !== "all") {
        query = query.eq("status", status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Market[];
    },
  });
}

// Fetch single market
export function useMarket(marketId: string | null) {
  return useQuery({
    queryKey: ["market", marketId],
    queryFn: async () => {
      if (!marketId) return null;
      const { data, error } = await supabase
        .from("prediction_markets")
        .select("*")
        .eq("id", marketId)
        .single();
      if (error) throw error;
      return data as Market;
    },
    enabled: !!marketId,
  });
}

// Fetch user's positions
export function useMyPositions() {
  return useQuery({
    queryKey: ["my-positions"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("market_positions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Position[];
    },
  });
}

// Fetch user's coins/balance
export function useMyCoins() {
  return useQuery({
    queryKey: ["my-coins"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // Ensure row exists
      await supabase.rpc("ensure_market_coins");

      const { data, error } = await supabase
        .from("market_coins")
        .select("balance, total_wagered, total_won, total_fees_paid")
        .eq("user_id", user.id)
        .single();

      if (error) throw error;
      return data as UserCoins;
    },
  });
}

// Fetch leaderboard
export function useLeaderboard(limit = 50) {
  return useQuery({
    queryKey: ["leaderboard", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_market_leaderboard")
        .select("*")
        .order("rank", { ascending: true })
        .limit(limit);

      if (error) throw error;
      return data as LeaderboardEntry[];
    },
  });
}

// Place bet mutation
export function usePlaceBet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { market_id: string; outcome: "yes" | "no"; stake: number }) => {
      const { data, error } = await supabase.functions.invoke("market-place-bet", {
        body: params,
      });

      if (error) throw error;
      if (!data.ok) throw new Error(data.error || "Failed to place bet");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-coins"] });
      queryClient.invalidateQueries({ queryKey: ["my-positions"] });
      queryClient.invalidateQueries({ queryKey: ["markets"] });
      queryClient.invalidateQueries({ queryKey: ["market"] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    },
  });
}

// Admin: Create market
export function useCreateMarket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      title: string;
      description?: string;
      category?: string;
      market_type?: string;
      fixture_id?: number;
      closes_at: string;
      initial_odds_yes?: number;
      initial_odds_no?: number;
    }) => {
      const { data, error } = await supabase.functions.invoke("market-create", {
        body: params,
      });

      if (error) throw error;
      if (!data.ok) throw new Error(data.error || "Failed to create market");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["markets"] });
    },
  });
}

// Admin: Resolve market
export function useResolveMarket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { market_id: string; winning_outcome: "yes" | "no" | "void" | null }) => {
      // Convert "void" to null for the edge function
      const outcome = params.winning_outcome === "void" ? null : params.winning_outcome;
      
      const { data, error } = await supabase.functions.invoke("market-resolve", {
        body: { market_id: params.market_id, winning_outcome: outcome },
      });

      if (error) throw error;
      if (!data.ok) throw new Error(data.error || "Failed to resolve market");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["markets"] });
      queryClient.invalidateQueries({ queryKey: ["market"] });
      queryClient.invalidateQueries({ queryKey: ["my-positions"] });
      queryClient.invalidateQueries({ queryKey: ["my-coins"] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    },
  });
}
