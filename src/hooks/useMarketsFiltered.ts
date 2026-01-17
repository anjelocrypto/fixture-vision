import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Market } from "./useMarkets";

export interface MarketWithMetadata extends Market {
  fixture: {
    id: number;
    timestamp: number | null;
    league_id: number | null;
    home_team: string;
    away_team: string;
  } | null;
  league: {
    id: number;
    name: string;
    logo: string | null;
  } | null;
  country: {
    id: number;
    name: string;
    code: string | null;
    flag: string | null;
  } | null;
}

export interface MarketsFilters {
  status: "open" | "closed" | "resolved" | "all";
  countryId?: number | null;
  leagueId?: number | null;
  search?: string;
  sortBy?: "kickoff" | "pool" | "newest";
}

// Fetch countries that have open markets
export function useMarketCountries() {
  return useQuery({
    queryKey: ["market-countries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prediction_markets")
        .select(`
          fixture_id,
          fixtures!inner(
            league_id,
            leagues!inner(
              country_id,
              countries!inner(id, name, code, flag)
            )
          )
        `)
        .eq("status", "open")
        .not("fixture_id", "is", null);

      if (error) throw error;

      // Extract unique countries
      const countryMap = new Map<number, { id: number; name: string; code: string | null; flag: string | null }>();
      
      (data || []).forEach((item: any) => {
        const country = item.fixtures?.leagues?.countries;
        if (country && !countryMap.has(country.id)) {
          countryMap.set(country.id, {
            id: country.id,
            name: country.name,
            code: country.code,
            flag: country.flag,
          });
        }
      });

      return Array.from(countryMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
    staleTime: 1000 * 60 * 5,
  });
}

// Fetch leagues that have open markets, optionally filtered by country
export function useMarketLeagues(countryId?: number | null) {
  return useQuery({
    queryKey: ["market-leagues", countryId],
    queryFn: async () => {
      let query = supabase
        .from("prediction_markets")
        .select(`
          fixture_id,
          fixtures!inner(
            league_id,
            leagues!inner(id, name, logo, country_id)
          )
        `)
        .eq("status", "open")
        .not("fixture_id", "is", null);

      const { data, error } = await query;

      if (error) throw error;

      // Extract unique leagues
      const leagueMap = new Map<number, { id: number; name: string; logo: string | null; country_id: number | null; marketCount: number }>();
      
      (data || []).forEach((item: any) => {
        const league = item.fixtures?.leagues;
        if (league) {
          // Filter by country if specified
          if (countryId && league.country_id !== countryId) return;
          
          if (leagueMap.has(league.id)) {
            leagueMap.get(league.id)!.marketCount++;
          } else {
            leagueMap.set(league.id, {
              id: league.id,
              name: league.name,
              logo: league.logo,
              country_id: league.country_id,
              marketCount: 1,
            });
          }
        }
      });

      return Array.from(leagueMap.values()).sort((a, b) => b.marketCount - a.marketCount);
    },
    staleTime: 1000 * 60 * 5,
  });
}

// Main filtered markets hook with server-side filtering
export function useMarketsFiltered(filters: MarketsFilters) {
  return useQuery({
    queryKey: ["markets-filtered", filters],
    queryFn: async () => {
      // Base query with all joins
      let query = supabase
        .from("prediction_markets")
        .select(`
          *,
          fixtures(
            id,
            timestamp,
            league_id,
            teams_home,
            teams_away,
            leagues(
              id,
              name,
              logo,
              country_id,
              countries(id, name, code, flag)
            )
          )
        `)
        .order("closes_at", { ascending: true });

      // Apply status filter
      if (filters.status !== "all") {
        query = query.eq("status", filters.status);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Transform and filter in memory (for league/country - Supabase nested filtering is limited)
      let results: MarketWithMetadata[] = (data || []).map((item: any) => {
        const fixture = item.fixtures;
        const league = fixture?.leagues;
        const country = league?.countries;

        return {
          ...item,
          fixtures: undefined, // Remove raw join data
          fixture: fixture ? {
            id: fixture.id,
            timestamp: fixture.timestamp,
            league_id: fixture.league_id,
            home_team: (fixture.teams_home as any)?.name || "TBD",
            away_team: (fixture.teams_away as any)?.name || "TBD",
          } : null,
          league: league ? {
            id: league.id,
            name: league.name,
            logo: league.logo,
          } : null,
          country: country ? {
            id: country.id,
            name: country.name,
            code: country.code,
            flag: country.flag,
          } : null,
        };
      });

      // Filter by country if specified
      if (filters.countryId) {
        results = results.filter((m) => m.country?.id === filters.countryId);
      }

      // Filter by league if specified
      if (filters.leagueId) {
        results = results.filter((m) => m.league?.id === filters.leagueId);
      }

      // Filter by search term
      if (filters.search && filters.search.trim()) {
        const searchLower = filters.search.toLowerCase().trim();
        results = results.filter((m) => 
          m.title.toLowerCase().includes(searchLower) ||
          m.fixture?.home_team.toLowerCase().includes(searchLower) ||
          m.fixture?.away_team.toLowerCase().includes(searchLower) ||
          m.league?.name.toLowerCase().includes(searchLower)
        );
      }

      // Sort
      if (filters.sortBy === "pool") {
        results.sort((a, b) => 
          (b.total_staked_yes + b.total_staked_no) - (a.total_staked_yes + a.total_staked_no)
        );
      } else if (filters.sortBy === "newest") {
        results.sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      } else {
        // Default: by kickoff time
        results.sort((a, b) => {
          const aTime = a.fixture?.timestamp || 0;
          const bTime = b.fixture?.timestamp || 0;
          return aTime - bTime;
        });
      }

      return results;
    },
    staleTime: 1000 * 30, // 30 second cache
  });
}

// Group markets by league
export function groupMarketsByLeague(markets: MarketWithMetadata[]) {
  const groups = new Map<number, { league: MarketWithMetadata["league"]; country: MarketWithMetadata["country"]; markets: MarketWithMetadata[] }>();
  
  markets.forEach((market) => {
    if (!market.league) return;
    
    if (!groups.has(market.league.id)) {
      groups.set(market.league.id, {
        league: market.league,
        country: market.country,
        markets: [],
      });
    }
    groups.get(market.league.id)!.markets.push(market);
  });

  // Sort by number of markets (most first)
  return Array.from(groups.values()).sort((a, b) => b.markets.length - a.markets.length);
}
