import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface TeamFormGame {
  game_id: number;
  date: string;
  opponent: string;
  points_for: number;
  points_against: number;
  total_points: number;
  result: "W" | "L";
  tpm: number | null;
  rebounds: number | null;
}

interface TeamFormData {
  team_id: number;
  team_name: string;
  league_key: string;
  sample_size: number;
  // Season averages
  ppg_for: number;
  ppg_against: number;
  ppg_total: number;
  tpm_avg: number;
  rpg_total: number;
  // Last 5
  last5_ppg_for: number;
  last5_ppg_against: number;
  last5_ppg_total: number;
  last5_wins: number;
  last5_losses: number;
  last5_games: TeamFormGame[];
}

export function useBasketballTeamForm(teamId: number | null) {
  return useQuery({
    queryKey: ["basketball-team-form", teamId],
    queryFn: async (): Promise<TeamFormData | null> => {
      if (!teamId) return null;

      // Get team info
      const { data: team } = await supabase
        .from("basketball_teams")
        .select("id, name, league_key")
        .eq("id", teamId)
        .single();

      if (!team) return null;

      // Get stats cache
      const { data: stats } = await supabase
        .from("basketball_stats_cache")
        .select("*")
        .eq("team_id", teamId)
        .single();

      // Get last 5 games
      const { data: gameStats } = await supabase
        .from("basketball_game_team_stats")
        .select(`
          id, game_id, points, tpm, rebounds_total, is_home,
          game:basketball_games!inner(
            id, date, home_score, away_score,
            home_team:basketball_teams!basketball_games_home_team_id_fkey(name),
            away_team:basketball_teams!basketball_games_away_team_id_fkey(name)
          )
        `)
        .eq("team_id", teamId)
        .order("created_at", { ascending: false })
        .limit(5);

      const last5Games: TeamFormGame[] = (gameStats || []).map((gs: any) => {
        const game = gs.game;
        const isHome = gs.is_home;
        const opponent = isHome ? game.away_team?.name : game.home_team?.name;
        const opponentScore = isHome ? game.away_score : game.home_score;
        
        return {
          game_id: gs.game_id,
          date: game.date,
          opponent: opponent || "Unknown",
          points_for: gs.points,
          points_against: opponentScore || 0,
          total_points: gs.points + (opponentScore || 0),
          result: gs.points > opponentScore ? "W" : "L",
          tpm: gs.tpm,
          rebounds: gs.rebounds_total,
        };
      });

      return {
        team_id: team.id,
        team_name: team.name,
        league_key: team.league_key,
        sample_size: stats?.sample_size || 0,
        ppg_for: stats?.ppg_for || 0,
        ppg_against: stats?.ppg_against || 0,
        ppg_total: stats?.ppg_total || 0,
        tpm_avg: stats?.tpm_avg || 0,
        rpg_total: stats?.rpg_total || 0,
        last5_ppg_for: stats?.last5_ppg_for || 0,
        last5_ppg_against: stats?.last5_ppg_against || 0,
        last5_ppg_total: stats?.last5_ppg_total || 0,
        last5_wins: stats?.last5_wins || 0,
        last5_losses: stats?.last5_losses || 0,
        last5_games: last5Games,
      };
    },
    enabled: !!teamId,
  });
}
