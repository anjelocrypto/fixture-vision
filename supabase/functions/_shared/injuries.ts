// Injury data management and key player detection
// API-Football endpoint: GET /injuries?league={id}&season={year}
//
// SYSTEM OVERVIEW:
// 1. API returns injuries with player.type values like "Missing Fixture", "Injury", "Doubtful", "Red Card", "Suspended"
// 2. We filter for relevant injuries by checking both player.type and player.reason fields
// 3. Since API doesn't provide player position data, we identify significant injuries by severity:
//    - Cruciate ligament injuries, fractures, ruptures, Achilles injuries, suspensions
// 4. When significant injuries exist for a team, we apply 15% goal reduction in computeCombinedMetrics
// 5. Data synced automatically via cron job every 4 hours (sync-injuries-12h)
// 6. Powers injury display in FixtureStatsDisplay, GeminiAnalysis, and RightRail components

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
 * Get key player injuries for a specific team
 * Returns list of injured/doubtful/suspended players
 * 
 * NOTE: API-Football /injuries endpoint does not provide player position data,
 * so we cannot filter by attacking positions. Instead, we filter by injury severity
 * and status to identify impactful injuries that warrant goal reduction.
 */
export async function getKeyAttackingInjuries(
  teamId: number,
  leagueId: number,
  season: number,
  supabaseClient: any
): Promise<Array<{ player_name: string; position: string | null; status: string; injury_type: string | null }>> {
  console.log(`[injuries] Checking key player injuries for team ${teamId}, league ${leagueId}, season ${season}`);
  
  try {
    // Query player_injuries table for this team
    const { data: injuries, error } = await supabaseClient
      .from('player_injuries')
      .select('*')
      .eq('team_id', teamId)
      .eq('league_id', leagueId)
      .eq('season', season)
      .in('status', ['injured', 'doubtful', 'suspended']);
    
    if (error) {
      console.error(`[injuries] Error fetching injuries for team ${teamId}:`, error);
      return [];
    }
    
    if (!injuries || injuries.length === 0) {
      console.log(`[injuries] No injuries found for team ${teamId}`);
      return [];
    }
    
    // Since API doesn't provide positions, filter by injury severity/type
    // Focus on serious injuries that would likely impact team performance
    const significantInjuries = injuries.filter((inj: any) => {
      const injuryType = (inj.injury_type ?? '').toLowerCase();
      const isSeriousInjury =
        injuryType.includes('cruciate') ||      // ACL/PCL tears
        injuryType.includes('ligament') ||      // Ligament injuries
        injuryType.includes('fracture') ||      // Broken bones
        injuryType.includes('rupture') ||       // Muscle ruptures
        injuryType.includes('tear') ||          // Muscle tears
        injuryType.includes('achilles') ||      // Achilles injuries
        injuryType.includes('suspended') ||     // Suspensions
        injuryType.includes('red card') ||      // Red card suspensions
        inj.status === 'suspended';             // Any suspension
      
      return isSeriousInjury;
    });
    
    console.log(`[injuries] Found ${significantInjuries.length} significant injuries for team ${teamId} (${injuries.length} total injuries)`);
    
    return significantInjuries.map((inj: any) => ({
      player_name: inj.player_name,
      position: inj.position,
      status: inj.status,
      injury_type: inj.injury_type,
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
