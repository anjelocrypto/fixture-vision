// Player importance scoring system for injury impact calculations
// API-Football endpoints: /players, /players/statistics
//
// IMPORTANCE SCORING MODEL:
// - Base score (60%): minutes_played / max_minutes_in_team
// - Offensive contribution (40%): (goals + assists) / max_contributions_in_team
// - Final importance: 0.0 (bench player) to 1.0 (star player)
// - Threshold for injury impact: importance >= 0.6 (key players only)

import { API_BASE, apiHeaders } from "./api.ts";

export interface PlayerImportanceData {
  player_id: number;
  player_name: string;
  team_id: number;
  league_id: number;
  season: number;
  importance: number; // 0.0 - 1.0
  minutes_played: number;
  matches_played: number;
  matches_started: number;
  goals: number;
  assists: number;
}

/**
 * Fetch player statistics for a team from API-Football
 * Uses /players endpoint with team and season filters
 */
export async function fetchTeamPlayerStats(
  teamId: number,
  leagueId: number,
  season: number
): Promise<PlayerImportanceData[]> {
  console.log(`[player-importance] Fetching players for team ${teamId}, league ${leagueId}, season ${season}`);
  
  const url = `${API_BASE}/players?team=${teamId}&season=${season}&league=${leagueId}`;
  const res = await fetch(url, { headers: apiHeaders() });
  
  if (!res.ok) {
    console.error(`[player-importance] Failed to fetch players: HTTP ${res.status}`);
    return [];
  }
  
  const json = await res.json();
  const players = json?.response ?? [];
  
  console.log(`[player-importance] API-Football returned ${players.length} players for team ${teamId}`);
  
  // Extract player stats and compute importance scores
  const playerData: PlayerImportanceData[] = [];
  
  for (const item of players) {
    const player = item?.player;
    const statistics = item?.statistics?.[0]; // First stat entry (usually the main league)
    
    if (!player?.id || !statistics) continue;
    
    const minutesPlayed = Number(statistics?.games?.minutes || 0);
    const matchesPlayed = Number(statistics?.games?.appearences || 0);
    const matchesStarted = Number(statistics?.games?.lineups || 0);
    const goals = Number(statistics?.goals?.total || 0);
    const assists = Number(statistics?.goals?.assists || 0);
    
    playerData.push({
      player_id: Number(player.id),
      player_name: String(player.name || 'Unknown'),
      team_id: teamId,
      league_id: leagueId,
      season: season,
      importance: 0, // Will be calculated after all players are loaded
      minutes_played: minutesPlayed,
      matches_played: matchesPlayed,
      matches_started: matchesStarted,
      goals: goals,
      assists: assists,
    });
  }
  
  // Compute importance scores
  if (playerData.length === 0) {
    console.log(`[player-importance] No valid player data for team ${teamId}`);
    return [];
  }
  
  const maxMinutes = Math.max(...playerData.map(p => p.minutes_played), 1);
  const maxContributions = Math.max(...playerData.map(p => p.goals + p.assists), 1);
  
  console.log(`[player-importance] Team ${teamId} max stats: minutes=${maxMinutes}, contributions=${maxContributions}`);
  
  for (const player of playerData) {
    // Importance formula:
    // 60% weight on minutes played (playing time)
    // 40% weight on goals+assists (offensive contribution)
    const minutesScore = player.minutes_played / maxMinutes;
    const contributionScore = (player.goals + player.assists) / maxContributions;
    
    player.importance = (minutesScore * 0.6) + (contributionScore * 0.4);
    
    // Clamp to [0, 1]
    player.importance = Math.max(0, Math.min(1, player.importance));
    
    console.log(
      `[player-importance] ${player.player_name}: minutes=${player.minutes_played}/${maxMinutes}, ` +
      `contributions=${player.goals + player.assists}/${maxContributions}, importance=${player.importance.toFixed(2)}`
    );
  }
  
  // Sort by importance descending
  playerData.sort((a, b) => b.importance - a.importance);
  
  console.log(`[player-importance] Computed importance for ${playerData.length} players on team ${teamId}`);
  console.log(`[player-importance] Top 5 players: ${playerData.slice(0, 5).map(p => `${p.player_name} (${p.importance.toFixed(2)})`).join(', ')}`);
  
  return playerData;
}

/**
 * Sync player importance data for a specific league and season
 * Fetches all teams with fixtures in the league and computes importance scores
 */
export async function syncLeaguePlayerImportance(
  leagueId: number,
  season: number,
  supabaseClient: any
): Promise<{ teams_processed: number; players_synced: number }> {
  console.log(`[player-importance] 🏁 Starting sync for league ${leagueId}, season ${season}`);
  
  // Get all unique teams with upcoming fixtures in this league
  const { data: fixtures, error: fixturesError } = await supabaseClient
    .from('fixtures')
    .select('teams_home, teams_away')
    .eq('league_id', leagueId)
    .gte('timestamp', Math.floor(Date.now() / 1000))
    .limit(100);
  
  if (fixturesError) {
    console.error(`[player-importance] ❌ Error fetching fixtures for league ${leagueId}:`, fixturesError);
    throw new Error(`Failed to fetch fixtures: ${fixturesError.message}`);
  }
  
  if (!fixtures || fixtures.length === 0) {
    console.log(`[player-importance] ⚠️ No upcoming fixtures for league ${leagueId}, skipping`);
    return { teams_processed: 0, players_synced: 0 };
  }
  
  // Extract unique team IDs
  const teamIds = new Set<number>();
  for (const fixture of fixtures) {
    const homeId = fixture.teams_home?.id;
    const awayId = fixture.teams_away?.id;
    if (homeId) teamIds.add(Number(homeId));
    if (awayId) teamIds.add(Number(awayId));
  }
  
  console.log(`[player-importance] Found ${teamIds.size} unique teams in ${fixtures.length} upcoming fixtures for league ${leagueId}`);
  
  let teamsProcessed = 0;
  let playersSynced = 0;
  
  for (const teamId of teamIds) {
    try {
      console.log(`[player-importance] Fetching players for team ${teamId}...`);
      const playerData = await fetchTeamPlayerStats(teamId, leagueId, season);
      
      if (playerData.length === 0) {
        console.log(`[player-importance] ⚠️ No players found for team ${teamId}, skipping upsert`);
        continue;
      }
      
      console.log(`[player-importance] Upserting ${playerData.length} players for team ${teamId}...`);
      
      // Upsert player importance data
      let successCount = 0;
      for (const player of playerData) {
        const { error } = await supabaseClient
          .from('player_importance')
          .upsert({
            player_id: player.player_id,
            team_id: player.team_id,
            league_id: player.league_id,
            season: player.season,
            importance: player.importance,
            minutes_played: player.minutes_played,
            matches_played: player.matches_played,
            matches_started: player.matches_started,
            goals: player.goals,
            assists: player.assists,
            last_update: new Date().toISOString(),
          }, {
            onConflict: 'player_id,team_id,league_id,season'
          });
        
        if (error) {
          console.error(`[player-importance] ❌ Error upserting player ${player.player_id} (${player.player_name}):`, error);
        } else {
          successCount++;
        }
      }
      
      teamsProcessed++;
      playersSynced += successCount;
      console.log(`[player-importance] ✅ Team ${teamId} complete: ${successCount}/${playerData.length} players synced`);
      
      // Rate limiting: wait 1.2 seconds between teams (~50 requests/minute API-Football limit)
      await new Promise(resolve => setTimeout(resolve, 1200));
      
    } catch (error) {
      console.error(`[player-importance] ❌ Error processing team ${teamId}:`, error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[player-importance] Error details: ${errorMsg}`);
    }
  }
  
  console.log(`[player-importance] 🎉 League ${leagueId} sync complete: ${teamsProcessed} teams, ${playersSynced} players`);
  
  return { teams_processed: teamsProcessed, players_synced: playersSynced };
}

/**
 * Get player importance for injured players of a team
 * Returns importance scores for specific player IDs
 */
export async function getPlayerImportance(
  playerIds: number[],
  teamId: number,
  leagueId: number,
  season: number,
  supabaseClient: any
): Promise<Map<number, number>> {
  if (playerIds.length === 0) {
    return new Map();
  }
  
  const { data: importance, error } = await supabaseClient
    .from('player_importance')
    .select('player_id, importance')
    .eq('team_id', teamId)
    .eq('league_id', leagueId)
    .eq('season', season)
    .in('player_id', playerIds);
  
  if (error) {
    console.error(`[player-importance] Error fetching importance:`, error);
    return new Map();
  }
  
  const importanceMap = new Map<number, number>();
  for (const record of importance || []) {
    importanceMap.set(record.player_id, Number(record.importance));
  }
  
  return importanceMap;
}
