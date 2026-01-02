import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface TeamAnalysis {
  team_id: number;
  team_name: string;
  sample_size: number;
  // Season averages
  ppg_for: number;
  ppg_against: number;
  ppg_total: number;
  tpm_avg: number;
  // Last 5 specific
  last5_ppg_for: number;
  last5_ppg_against: number;
  last5_ppg_total: number;
  last5_tpm_avg: number;
  last5_wins: number;
  last5_losses: number;
  last5_games: GameResult[];
}

interface GameResult {
  game_id: number;
  date: string;
  opponent: string;
  points_for: number;
  points_against: number;
  total_points: number;
  result: "W" | "L";
  tpm: number | null;
}

export interface FixtureAnalysis {
  game_id: number;
  date: string;
  league_key: string;
  home_team: TeamAnalysis;
  away_team: TeamAnalysis;
  combined: {
    expected_total: number;
    matchup_assessment: "HIGH" | "MEDIUM" | "LOW";
  };
}

export function useBasketballFixtureAnalysis(gameId: number | null) {
  return useQuery({
    queryKey: ["basketball-fixture-analysis", gameId],
    queryFn: async (): Promise<FixtureAnalysis | null> => {
      if (!gameId) return null;

      // Get game details
      const { data: game, error: gameError } = await supabase
        .from("basketball_games")
        .select(`
          id, date, league_key, home_team_id, away_team_id,
          home_team:basketball_teams!basketball_games_home_team_id_fkey(id, name),
          away_team:basketball_teams!basketball_games_away_team_id_fkey(id, name)
        `)
        .eq("id", gameId)
        .single();

      if (gameError || !game) throw gameError || new Error("Game not found");

      // Fetch stats for both teams in parallel
      const [homeStats, awayStats, homeLast5, awayLast5] = await Promise.all([
        fetchTeamStats(game.home_team_id),
        fetchTeamStats(game.away_team_id),
        fetchLast5Games(game.home_team_id),
        fetchLast5Games(game.away_team_id),
      ]);

      const homeTeam = buildTeamAnalysis(
        game.home_team_id,
        (game.home_team as any)?.name || "Home",
        homeStats,
        homeLast5
      );

      const awayTeam = buildTeamAnalysis(
        game.away_team_id,
        (game.away_team as any)?.name || "Away",
        awayStats,
        awayLast5
      );

      // Calculate combined metrics
      const expectedTotal = (homeTeam.last5_ppg_for + awayTeam.last5_ppg_for + homeTeam.last5_ppg_against + awayTeam.last5_ppg_against) / 2;
      
      let matchupAssessment: "HIGH" | "MEDIUM" | "LOW" = "MEDIUM";
      if (expectedTotal >= 230) matchupAssessment = "HIGH";
      else if (expectedTotal <= 210) matchupAssessment = "LOW";

      return {
        game_id: game.id,
        date: game.date,
        league_key: game.league_key,
        home_team: homeTeam,
        away_team: awayTeam,
        combined: {
          expected_total: Math.round(expectedTotal * 10) / 10,
          matchup_assessment: matchupAssessment,
        },
      };
    },
    enabled: !!gameId,
  });
}

async function fetchTeamStats(teamId: number) {
  const { data } = await supabase
    .from("basketball_stats_cache")
    .select("*")
    .eq("team_id", teamId)
    .single();
  return data;
}

async function fetchLast5Games(teamId: number): Promise<GameResult[]> {
  const { data: gameStats } = await supabase
    .from("basketball_game_team_stats")
    .select(`
      id, game_id, points, tpm, is_home,
      game:basketball_games!inner(
        id, date, home_score, away_score, status_short,
        home_team:basketball_teams!basketball_games_home_team_id_fkey(name),
        away_team:basketball_teams!basketball_games_away_team_id_fkey(name)
      )
    `)
    .eq("team_id", teamId)
    .order("game_id", { ascending: false })
    .limit(5);

  if (!gameStats) return [];

  return gameStats
    .filter((gs: any) => gs.game?.status_short === "FT")
    .map((gs: any) => {
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
      };
    });
}

function buildTeamAnalysis(
  teamId: number,
  teamName: string,
  stats: any,
  last5Games: GameResult[]
): TeamAnalysis {
  return {
    team_id: teamId,
    team_name: teamName,
    sample_size: stats?.sample_size || 0,
    ppg_for: stats?.ppg_for || 0,
    ppg_against: stats?.ppg_against || 0,
    ppg_total: stats?.ppg_total || 0,
    tpm_avg: stats?.tpm_avg || 0,
    last5_ppg_for: stats?.last5_ppg_for || 0,
    last5_ppg_against: stats?.last5_ppg_against || 0,
    last5_ppg_total: stats?.last5_ppg_total || 0,
    last5_tpm_avg: stats?.last5_tpm_avg || 0,
    last5_wins: stats?.last5_wins || 0,
    last5_losses: stats?.last5_losses || 0,
    last5_games: last5Games,
  };
}
