import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";

const INTERNATIONAL_LEAGUE_IDS = [5, 1, 4, 960, 32, 34, 33, 31, 29, 30, 9, 36, 964];
const INTERNATIONAL_LEAGUE_NAMES: Record<number, string> = {
  5: "UEFA Nations League",
  1: "World Cup",
  4: "UEFA Euro Championship",
  960: "UEFA Euro Championship Qualification",
  32: "World Cup Qualification (Africa)",
  34: "World Cup Qualification (Asia)",
  33: "World Cup Qualification (Oceania)",
  31: "World Cup Qualification (South America)",
  29: "World Cup Qualification (CONCACAF)",
  30: "World Cup Qualification (Europe)",
  9: "Copa América",
  36: "AFCON Qualification",
  964: "Africa Cup of Nations",
};

serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const start = performance.now();

  try {
    const url = new URL(req.url);
    const season = parseInt(url.searchParams.get("season") || "2025");

    console.log(`[list-leagues-grouped] Fetching all leagues for season: ${season}`);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Single query: fetch all leagues with country info
    // Uses the new index: leagues_season_country_idx
    const { data: allLeagues, error } = await supabaseClient
      .from("leagues")
      .select(`
        id,
        name,
        logo,
        season,
        country_id,
        countries (
          id,
          name,
          code,
          flag
        )
      `)
      .eq("season", season)
      .order("country_id", { ascending: true, nullsFirst: true })
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    console.log(`[list-leagues-grouped] Fetched ${allLeagues?.length || 0} leagues from DB`);

    // Group by country
    const grouped: Record<string, any> = {};

    // Add International group first (leagues with null country_id)
    const internationalLeagues = (allLeagues || [])
      .filter((l: any) => l.country_id === null)
      .map((l: any) => ({
        id: l.id,
        name: l.name,
        logo: l.logo,
        season: l.season,
      }));

    // If we have cached international leagues, use them; otherwise use hardcoded list
    if (internationalLeagues.length > 0) {
      grouped["International"] = {
        code: "INTL",
        name: "International",
        flag: null,
        leagues: internationalLeagues,
      };
    } else {
      // Fallback to hardcoded international leagues
      grouped["International"] = {
        code: "INTL",
        name: "International",
        flag: null,
        leagues: INTERNATIONAL_LEAGUE_IDS.map(id => ({
          id,
          name: INTERNATIONAL_LEAGUE_NAMES[id] || `League ${id}`,
          logo: null,
          season,
        })),
      };
    }

    // Group remaining leagues by country
    (allLeagues || [])
      .filter((l: any) => l.country_id !== null && l.countries)
      .forEach((league: any) => {
        const country = league.countries;
        const countryKey = country.name;

        if (!grouped[countryKey]) {
          grouped[countryKey] = {
            code: country.code,
            name: country.name,
            flag: country.flag,
            leagues: [],
          };
        }

        grouped[countryKey].leagues.push({
          id: league.id,
          name: league.name,
          logo: league.logo,
          season: league.season,
        });
      });

    // Convert to array
    const countries = Object.values(grouped);

    const elapsed = Math.round(performance.now() - start);
    console.log(`[list-leagues-grouped] Completed in ${elapsed}ms, returning ${countries.length} countries`);

    // Calculate ETag based on data hash
    const dataStr = JSON.stringify(countries);
    const etag = `"${btoa(String(dataStr.length))}"`;

    // Response with aggressive caching
    const headers = {
      ...getCorsHeaders(origin, req),
      "Content-Type": "application/json",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400", // 1h cache, 24h stale
      "ETag": etag,
      "Last-Modified": new Date().toUTCString(),
      "X-Server-Time-Ms": elapsed.toString(),
    };

    // Check if client has cached version (ETag match)
    const clientEtag = req.headers.get("If-None-Match");
    if (clientEtag === etag) {
      console.log(`[list-leagues-grouped] ETag match, returning 304`);
      return new Response(null, { status: 304, headers });
    }

    return new Response(
      JSON.stringify({ countries, season, cached_at: new Date().toISOString() }),
      { headers }
    );
  } catch (error) {
    console.error("[list-leagues-grouped] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...getCorsHeaders(origin, req), "Content-Type": "application/json" },
      }
    );
  }
});
