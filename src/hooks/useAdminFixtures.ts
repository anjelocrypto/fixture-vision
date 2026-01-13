import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Country {
  id: number;
  name: string;
  code: string | null;
  flag: string | null;
}

export interface League {
  id: number;
  name: string;
  logo: string | null;
  country_id: number | null;
  season: number;
}

export interface Fixture {
  id: number;
  date: string;
  timestamp: number | null;
  league_id: number | null;
  status: string | null;
  teams_home: { id: number; name: string; logo?: string };
  teams_away: { id: number; name: string; logo?: string };
}

// Fetch all countries
export function useCountries() {
  return useQuery({
    queryKey: ["admin-countries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("countries")
        .select("id, name, code, flag")
        .order("name");

      if (error) throw error;
      return data as Country[];
    },
    staleTime: 1000 * 60 * 30, // Cache for 30 mins
  });
}

// Fetch leagues by country
export function useLeaguesByCountry(countryId: number | null) {
  return useQuery({
    queryKey: ["admin-leagues", countryId],
    queryFn: async () => {
      if (!countryId) return [];
      
      const { data, error } = await supabase
        .from("leagues")
        .select("id, name, logo, country_id, season")
        .eq("country_id", countryId)
        .order("name");

      if (error) throw error;
      return data as League[];
    },
    enabled: !!countryId,
    staleTime: 1000 * 60 * 15,
  });
}

// Fetch fixtures for a league within a time window
export function useFixturesNext(leagueId: number | null, hoursAhead: number = 48) {
  return useQuery({
    queryKey: ["admin-fixtures", leagueId, hoursAhead],
    queryFn: async () => {
      if (!leagueId) return [];

      const now = Math.floor(Date.now() / 1000);
      const endTs = now + hoursAhead * 3600;

      const { data, error } = await supabase
        .from("fixtures")
        .select("id, date, timestamp, league_id, status, teams_home, teams_away")
        .eq("league_id", leagueId)
        .gte("timestamp", now)
        .lte("timestamp", endTs)
        .order("timestamp", { ascending: true });

      if (error) throw error;
      return data as Fixture[];
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 5, // 5 min cache
  });
}

// Get fixture count per league for next N hours
export function useLeagueFixtureCounts(hoursAhead: number = 48) {
  return useQuery({
    queryKey: ["admin-fixture-counts", hoursAhead],
    queryFn: async () => {
      const now = Math.floor(Date.now() / 1000);
      const endTs = now + hoursAhead * 3600;

      // Get fixtures grouped by league
      const { data, error } = await supabase
        .from("fixtures")
        .select("league_id")
        .gte("timestamp", now)
        .lte("timestamp", endTs);

      if (error) throw error;

      // Count per league
      const counts: Record<number, number> = {};
      (data || []).forEach((f) => {
        if (f.league_id) {
          counts[f.league_id] = (counts[f.league_id] || 0) + 1;
        }
      });

      return counts;
    },
    staleTime: 1000 * 60 * 5,
  });
}

// Market templates
export const MARKET_TEMPLATES = [
  { label: "Over 0.5 Goals", rule: "over_0.5_goals", category: "goals" },
  { label: "Over 1.5 Goals", rule: "over_1.5_goals", category: "goals" },
  { label: "Over 2.5 Goals", rule: "over_2.5_goals", category: "goals" },
  { label: "Under 2.5 Goals", rule: "under_2.5_goals", category: "goals" },
  { label: "BTTS", rule: "btts", category: "goals" },
  { label: "Home Win", rule: "home_win", category: "match" },
  { label: "Draw", rule: "draw", category: "match" },
  { label: "Away Win", rule: "away_win", category: "match" },
  // Corners - feature flag disabled for now (auto-resolve not ready)
  // { label: "Over 8.5 Corners", rule: "over_8.5_corners", category: "corners" },
  // { label: "Under 9.5 Corners", rule: "under_9.5_corners", category: "corners" },
] as const;

export type MarketTemplate = typeof MARKET_TEMPLATES[number];

// Create market from fixture using RPC
export function useCreateMarketFromFixture() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      fixture_id: number;
      resolution_rule: string;
      odds_yes?: number;
      odds_no?: number;
      close_minutes_before_kickoff?: number;
      title_override?: string;
    }) => {
      const { data, error } = await supabase.rpc("admin_create_market_for_fixture", {
        _fixture_id: params.fixture_id,
        _resolution_rule: params.resolution_rule,
        _odds_yes: params.odds_yes ?? 1.80,
        _odds_no: params.odds_no ?? 2.00,
        _close_minutes_before_kickoff: params.close_minutes_before_kickoff ?? 5,
        _title_override: params.title_override ?? null,
      });

      if (error) throw error;
      
      // RPC returns jsonb
      const result = data as { ok: boolean; error?: string; market_id?: string; title?: string; status?: string };
      if (!result.ok) {
        throw new Error(result.error || "Failed to create market");
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["markets"] });
    },
  });
}
