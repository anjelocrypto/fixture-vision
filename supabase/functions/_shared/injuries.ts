// Injury data management and key player detection
// API-Football endpoint: GET /injuries?league={id}&season={year}
//
// SYSTEM OVERVIEW:
// 1. API returns injuries with player.type values like "Missing Fixture", "Injury", "Doubtful", "Red Card", "Suspended"
// 2. We filter for relevant injuries by checking both player.type and player.reason fields
// 3. Goal reduction is determined ONLY by player importance (>= 0.6) + availability status
// 4. Injury type (reason) is purely informational for UI display - it does NOT affect calculations
// 5. Scaled reduction: 0-5-10-15-20% based on max importance and count of key injured players
// 6. Data synced automatically via cron job every 4 hours (sync-injuries-12h)
// 7. Powers injury display in FixtureStatsDisplay, GeminiAnalysis, and RightRail components

import { API_BASE, apiHeaders } from "./api.ts";

export interface PlayerInjury {
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string;
  league_id: number;
  season: number;
  position: string | null;
  injury_type: string | null;
  status: string;
  start_date: string | null;
  expected_return: string | null;
}

// Key attacking positions
const ATTACKING_POSITIONS = new Set([
  'F', 'FW', 'ST', 'CF', 'LW', 'RW', 'AM', 'CAM', 'SS', 'W'
]);

/**
 * Fetch injuries for a specific league and season from API-Football
 */
export async function fetchLeagueInjuries(
  leagueId: number,
  season: number
): Promise<PlayerInjury[]> {
  console.log(`[injuries] Fetching injuries for league ${leagueId}, season ${season}`);
  
  const url = `${API_BASE}/injuries?league=${leagueId}&season=${season}`;
  const res = await fetch(url, { headers: apiHeaders() });
  
  if (!res.ok) {
    console.error(`[injuries] Failed to fetch injuries: HTTP ${res.status}`);
    return [];
  }
  
  const json = await res.json();
  const injuries = json?.response ?? [];
  
  console.log(`[injuries] API-Football returned ${injuries.length} injuries for league ${leagueId}`);
  
  // Normalize to our schema
  let processedCount = 0;
  const normalized: PlayerInjury[] = injuries
    .filter((injury: any) => {
      // Filter for relevant injury/suspension statuses
      // API-Football returns player.type values like: "Missing Fixture", "Injury", "Doubtful", "Red Card", "Suspended"
      const rawType = (injury?.player?.type ?? '').toString().toLowerCase();
      const rawReason = (injury?.player?.reason ?? '').toString().toLowerCase();
      
      // Be generous: include any clear injury, doubt, or suspension cases
      const isRelevant =
        rawType.includes('injury') ||
        rawType.includes('injured') ||
        rawType.includes('missing') ||      // "Missing Fixture" due to injury
        rawType.includes('doubt') ||
        rawType.includes('susp') ||         // "Suspended"
        rawType.includes('red card') ||     // Red card suspension
        rawReason.includes('injury') ||
        rawReason.includes('tear') ||
        rawReason.includes('strain') ||
        rawReason.includes('rupture') ||
        rawReason.includes('fracture');
      
      return isRelevant;
    })
    .map((injury: any) => {
      const player = injury?.player || {};
      const team = injury?.team || {};
      const fixture = injury?.fixture || {};
      const league = injury?.league || {};
      
      // Normalize status to our standard values
      const rawStatus = (player.type ?? '').toString().toLowerCase();
      let normalizedStatus = 'injured'; // default
      if (rawStatus.includes('doubt')) {
        normalizedStatus = 'doubtful';
      } else if (rawStatus.includes('susp') || rawStatus.includes('red card')) {
        normalizedStatus = 'suspended';
      } else if (rawStatus.includes('injury') || rawStatus.includes('missing')) {
        normalizedStatus = 'injured';
      }
      
      const injuryData = {
        player_id: Number(player.id) || 0,
        player_name: String(player.name || 'Unknown'),
        team_id: Number(team.id) || 0,
        team_name: String(team.name || 'Unknown'),
        league_id: Number(league.id) || leagueId,
        season: season,
        position: player.position || null,
        injury_type: player.reason || null,
        status: normalizedStatus,
        start_date: fixture.date || null,
        expected_return: null, // API doesn't provide this reliably
      };
      
      
      return injuryData;
    })
    .filter((inj: PlayerInjury) => inj.player_id > 0 && inj.team_id > 0);
  
  console.log(`[injuries] Normalized ${normalized.length} valid injuries`);
  return normalized;
}

/**
 * Check if a player position is an attacking position
 */
function isAttackingPosition(position: string | null): boolean {
  if (!position) return false;
  const normalized = position.trim().toUpperCase();
  
  // Check direct matches
  if (ATTACKING_POSITIONS.has(normalized)) return true;
  
  // Check if position contains attacking keywords
  if (
    normalized.includes('FORWARD') ||
    normalized.includes('STRIKER') ||
    normalized.includes('WINGER') ||
    normalized.includes('ATTACKER')
  ) {
    return true;
  }
  
  return false;
}

/**
 * Get important player injuries for a specific team
 * Returns list of injured/doubtful/suspended players who are KEY PLAYERS (importance >= 0.6)
 * 
 * FILTERING LOGIC (importance-only):
 * 1. Status: injured, doubtful, suspended (availability check)
 * 2. Player importance: ONLY includes players with importance >= 0.6
 * 
 * CRITICAL: injury_type is NOT used for filtering - it's purely informational for UI display.
 * Goal reduction is determined ONLY by importance + count, not by injury severity.
 */
export async function getKeyAttackingInjuries(
  teamId: number,
  leagueId: number,
  season: number,
  supabaseClient: any
): Promise<Array<{ player_name: string; position: string | null; status: string; injury_type: string | null; importance: number }>> {
  console.log(`[injuries] Checking key player injuries for team ${teamId}, league ${leagueId}, season ${season}`);
  
  try {
    // First, fetch injuries for the team
    const { data: injuries, error: injError } = await supabaseClient
      .from('player_injuries')
      .select('player_id, player_name, position, status, injury_type')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .eq('season', season)
      .in('status', ['injured', 'doubtful', 'suspended']);
    
    if (injError) {
      console.error(`[injuries] Error fetching injuries for team ${teamId}:`, injError);
      return [];
    }
    
    if (!injuries || injuries.length === 0) {
      console.log(`[injuries] No injuries found for team ${teamId}`);
      return [];
    }
    
    console.log(`[injuries] Found ${injuries.length} injuries for team ${teamId}, fetching importance data`);
    
    // Get player IDs
    const playerIds = injuries.map((inj: any) => inj.player_id);
    
    // Fetch importance data for these players
    const { data: importance, error: impError } = await supabaseClient
      .from('player_importance')
      .select('player_id, importance')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .eq('season', season)
      .in('player_id', playerIds);
    
    if (impError) {
      console.error(`[injuries] Error fetching importance for team ${teamId}:`, impError);
      return [];
    }
    
    // Create map of player_id -> importance
    const importanceMap = new Map<number, number>();
    (importance || []).forEach((imp: any) => {
      importanceMap.set(imp.player_id, Number(imp.importance));
    });
    
    console.log(`[injuries] Fetched importance for ${importanceMap.size} players, filtering by importance >= 0.6`);
    
    // Filter by importance ONLY - ignore injury_type completely
    const IMPORTANCE_THRESHOLD = 0.6;
    
    const impactfulInjuries = injuries.filter((inj: any) => {
      const importance = importanceMap.get(inj.player_id) ?? 0;
      const isKeyPlayer = importance >= IMPORTANCE_THRESHOLD;
      
      if (!isKeyPlayer) {
        console.log(
          `[injuries] Excluding ${inj.player_name}: low importance (${importance.toFixed(2)} < ${IMPORTANCE_THRESHOLD}). ` +
          `Injury type "${inj.injury_type}" is irrelevant for calculations.`
        );
      }
      
      return isKeyPlayer;
    });
    
    console.log(
      `[injuries] Found ${impactfulInjuries.length} impactful injuries (importance >= ${IMPORTANCE_THRESHOLD}) for team ${teamId}. ` +
      `Injury types are for display only and do NOT affect goal reduction.`
    );
    
    return impactfulInjuries.map((inj: any) => ({
      player_name: inj.player_name,
      position: inj.position,
      status: inj.status,
      injury_type: inj.injury_type, // Display only - not used in calculations
      importance: importanceMap.get(inj.player_id) ?? 0,
    }));
  } catch (err) {
    console.error(`[injuries] Exception fetching injuries for team ${teamId}:`, err);
    return [];
  }
}

/**
 * Check if a team has significant player injuries
 * Since API-Football doesn't provide position data, we filter by injury severity instead
 */
export async function hasKeyAttackingInjuries(
  teamId: number,
  leagueId: number,
  season: number,
  supabaseClient: any
): Promise<boolean> {
  const injuries = await getKeyAttackingInjuries(teamId, leagueId, season, supabaseClient);
  return injuries.length > 0;
}

/**
 * Apply goal reduction for injury impact
 * Returns adjusted goals value (85% of original if key attacker is injured)
 */
export function applyInjuryImpact(
  originalGoals: number,
  hasInjury: boolean
): number {
  if (!hasInjury) return originalGoals;
  
  const adjusted = originalGoals * 0.85; // -15% impact
  console.log(`[injuries] Applying injury impact: ${originalGoals.toFixed(2)} → ${adjusted.toFixed(2)} (-15%)`);
  return adjusted;
}
