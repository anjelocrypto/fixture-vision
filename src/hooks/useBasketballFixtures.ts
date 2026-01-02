import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface BasketballGame {
  id: number;
  api_game_id: number;
  date: string;
  home_team_id: number;
  away_team_id: number;
  home_team_name: string;
  away_team_name: string;
  league_key: string;
  status_short: string;
}

interface UseBasketballFixturesOptions {
  leagueKey?: string | null;
  hoursAhead?: number;
}

export function useBasketballFixtures({ leagueKey, hoursAhead = 48 }: UseBasketballFixturesOptions = {}) {
  return useQuery({
    queryKey: ["basketball-fixtures", leagueKey, hoursAhead],
    queryFn: async (): Promise<BasketballGame[]> => {
      const now = new Date();
      const endTime = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

      let query = supabase
        .from("basketball_games")
        .select(`
          id,
          api_game_id,
          date,
          home_team_id,
          away_team_id,
          league_key,
          status_short,
          home_team:basketball_teams!basketball_games_home_team_id_fkey(name),
          away_team:basketball_teams!basketball_games_away_team_id_fkey(name)
        `)
        .eq("status_short", "NS")
        .gte("date", now.toISOString())
        .lte("date", endTime.toISOString())
        .order("date", { ascending: true });

      if (leagueKey) {
        query = query.eq("league_key", leagueKey);
      }

      const { data, error } = await query;

      if (error) throw error;

      return (data || []).map((game: any) => ({
        id: game.id,
        api_game_id: game.api_game_id,
        date: game.date,
        home_team_id: game.home_team_id,
        away_team_id: game.away_team_id,
        home_team_name: game.home_team?.name || "TBD",
        away_team_name: game.away_team?.name || "TBD",
        league_key: game.league_key,
        status_short: game.status_short,
      }));
    },
    staleTime: 60 * 1000, // 1 minute
  });
}

// Helper to group games by date
export function groupGamesByDate(games: BasketballGame[]): { today: BasketballGame[]; tomorrow: BasketballGame[] } {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];

  return {
    today: games.filter((g) => g.date.startsWith(todayStr)),
    tomorrow: games.filter((g) => g.date.startsWith(tomorrowStr)),
  };
}
