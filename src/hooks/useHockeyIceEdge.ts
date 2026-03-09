import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface IceEdgeGame {
  game_id: number;
  league_id: number;
  season: number;
  home_team_id: number;
  away_team_id: number;
  puck_drop: string;
  projected_total: number;
  value_score: number;
  chaos_score: number;
  ot_risk: number;
  p1_heat: number;
  regulation_lean: string;
  confidence_tier: string;
  iceedge_rank: number | null;
  reasoning: string | null;
  recommended_markets: RecommendedMarket[];
  // Joined
  home_team?: { id: number; name: string; short_name: string | null; logo: string | null };
  away_team?: { id: number; name: string; short_name: string | null; logo: string | null };
  home_league?: { name: string; logo: string | null };
}

export interface RecommendedMarket {
  market: string;
  side: string;
  line?: number;
  reason: string;
}

async function fetchIceEdge(): Promise<IceEdgeGame[]> {
  const { data, error } = await supabase
    .from("hockey_iceedge_cache")
    .select(`
      game_id, league_id, season, home_team_id, away_team_id, puck_drop,
      projected_total, value_score, chaos_score, ot_risk, p1_heat,
      regulation_lean, confidence_tier, iceedge_rank, reasoning, recommended_markets
    `)
    .order("iceedge_rank", { ascending: true, nullsFirst: false });

  if (error) throw error;
  if (!data || data.length === 0) return [];

  // Fetch team names
  const teamIds = [...new Set(data.flatMap((d: any) => [d.home_team_id, d.away_team_id]))];
  const { data: teams } = await supabase
    .from("hockey_teams")
    .select("id, name, short_name, logo")
    .in("id", teamIds);

  const teamMap = new Map<number, any>();
  for (const t of (teams ?? [])) teamMap.set(t.id, t);

  // Fetch league names
  const leagueIds = [...new Set(data.map((d: any) => d.league_id))];
  const { data: leagues } = await supabase
    .from("hockey_leagues")
    .select("id, name, logo")
    .in("id", leagueIds);

  const leagueMap = new Map<number, any>();
  for (const l of (leagues ?? [])) leagueMap.set(l.id, l);

  return data.map((d: any) => ({
    ...d,
    recommended_markets: (d.recommended_markets ?? []) as RecommendedMarket[],
    home_team: teamMap.get(d.home_team_id),
    away_team: teamMap.get(d.away_team_id),
    home_league: leagueMap.get(d.league_id),
  }));
}

export function useHockeyIceEdge() {
  return useQuery({
    queryKey: ["hockey-iceedge"],
    queryFn: fetchIceEdge,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}
