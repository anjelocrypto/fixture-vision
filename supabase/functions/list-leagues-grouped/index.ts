/**
 * LIST-LEAGUES-GROUPED (RC3.4 — catalogue vs. availability separation)
 *
 * The catalogue (which competitions and countries exist) is NEVER filtered by a
 * requested season and NEVER invented: every returned league is a real row in
 * public.leagues. Season/fixture availability is reported separately and
 * truthfully per league:
 *
 *   season               - the season the stored rows are actually tagged with
 *   is_current_season    - season === the current football season
 *   upcoming_fixtures    - count of stored fixtures with kickoff >= now
 *   availability         - "current" | "stale" | "empty"
 *   last_kickoff_at      - latest stored kickoff (coverage, not sync)
 *   last_synced_at       - latest fixture row update (sync, not coverage)
 *
 * Nothing here relabels a 2025 season as 2026, and no hardcoded UEFA /
 * International placeholder league is injected any more.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handlePreflight } from "../_shared/cors.ts";
import { authenticateUser } from "../_shared/user_auth.ts";
import { getFootballSeasonForLeague } from "../_shared/season.ts";

const UEFA_CLUB_LEAGUE_IDS = [2, 3, 848];
const INTERNATIONAL_LEAGUE_IDS = [
  5, 1, 4, 960, 32, 34, 33, 31, 29, 30, 9, 36, 964, 17, 2, 3, 848,
];

const UEFA_GROUP_ID = 9998;
const INTERNATIONAL_GROUP_ID = 9999;

type CatalogueRow = {
  league_id: number;
  league_name: string;
  logo: string | null;
  season: number | null;
  country_id: number | null;
  country_name: string | null;
  country_code: string | null;
  country_flag: string | null;
  upcoming_fixtures: number | string | null;
  total_fixtures: number | string | null;
  last_kickoff_at: string | null;
  last_synced_at: string | null;
};

const toCount = (v: number | string | null): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n as number) ? Number(n) : 0;
};

const maxIso = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return new Date(a) >= new Date(b) ? a : b;
};

serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return handlePreflight(origin, req);
  }

  const start = performance.now();

  try {
    const auth = await authenticateUser(req, "[list-leagues-grouped]");
    if (!auth.authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...getCorsHeaders(origin, req), "Content-Type": "application/json" },
      });
    }

    const currentSeason = getFootballSeasonForLeague(39);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data, error } = await supabaseClient.rpc("get_league_catalogue");
    if (error) throw error;

    const rows = (data ?? []) as CatalogueRow[];
    console.log(`[list-leagues-grouped] catalogue rows: ${rows.length}`);

    const seasons = rows
      .map((r) => r.season)
      .filter((s): s is number => typeof s === "number");
    const catalogueSeason = seasons.length ? Math.max(...seasons) : null;

    type Group = {
      id: number;
      code: string | null;
      name: string;
      flag: string | null;
      // deno-lint-ignore no-explicit-any
      leagues: any[];
      upcoming_fixtures: number;
      current_season_leagues: number;
      last_synced_at: string | null;
    };

    const groups = new Map<string, Group>();

    const ensureGroup = (key: string, seed: Omit<Group, "leagues" | "upcoming_fixtures" | "current_season_leagues" | "last_synced_at">): Group => {
      let g = groups.get(key);
      if (!g) {
        g = { ...seed, leagues: [], upcoming_fixtures: 0, current_season_leagues: 0, last_synced_at: null };
        groups.set(key, g);
      }
      return g;
    };

    for (const row of rows) {
      const upcoming = toCount(row.upcoming_fixtures);
      const total = toCount(row.total_fixtures);
      const isCurrent = row.season === currentSeason;
      const availability = upcoming > 0 ? "current" : total > 0 ? "stale" : "empty";

      const league = {
        id: row.league_id,
        name: row.league_name,
        logo: row.logo,
        season: row.season,
        is_current_season: isCurrent,
        upcoming_fixtures: upcoming,
        total_fixtures: total,
        availability,
        last_kickoff_at: row.last_kickoff_at,
        last_synced_at: row.last_synced_at,
      };

      let key: string;
      let seed: Omit<Group, "leagues" | "upcoming_fixtures" | "current_season_leagues" | "last_synced_at">;

      if (UEFA_CLUB_LEAGUE_IDS.includes(row.league_id)) {
        key = "UEFA";
        seed = { id: UEFA_GROUP_ID, code: "UEFA", name: "UEFA", flag: null };
      } else if (INTERNATIONAL_LEAGUE_IDS.includes(row.league_id)) {
        key = "International";
        seed = { id: INTERNATIONAL_GROUP_ID, code: "INTL", name: "International", flag: null };
      } else if (row.country_id !== null && row.country_name) {
        key = `country:${row.country_id}`;
        seed = {
          id: row.country_id,
          code: row.country_code,
          name: row.country_name,
          flag: row.country_flag,
        };
      } else {
        // A league with no country association is still real — never hide it.
        key = "Other";
        seed = { id: 9997, code: null, name: "Other", flag: null };
      }

      const group = ensureGroup(key, seed);
      group.leagues.push(league);
      group.upcoming_fixtures += upcoming;
      if (isCurrent) group.current_season_leagues += 1;
      group.last_synced_at = maxIso(group.last_synced_at, row.last_synced_at);
    }

    const rank = (g: Group) => (g.id === UEFA_GROUP_ID ? 0 : g.id === INTERNATIONAL_GROUP_ID ? 1 : 2);
    const countries = [...groups.values()]
      .map((g) => ({
        ...g,
        leagues: g.leagues.sort((a, b) => String(a.name).localeCompare(String(b.name))),
      }))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

    const totalUpcoming = countries.reduce((sum, c) => sum + c.upcoming_fixtures, 0);

    const payload = {
      countries,
      catalogue_season: catalogueSeason,
      current_season: currentSeason,
      current_season_available: rows.some((r) => r.season === currentSeason),
      total_leagues: rows.length,
      total_upcoming_fixtures: totalUpcoming,
      generated_at: new Date().toISOString(),
    };

    const elapsed = Math.round(performance.now() - start);
    console.log(
      `[list-leagues-grouped] ${countries.length} groups, ${rows.length} leagues, ` +
        `${totalUpcoming} upcoming, catalogue_season=${catalogueSeason}, in ${elapsed}ms`,
    );

    const body = JSON.stringify(payload);
    // Availability changes as kickoffs pass — keep the shared cache short.
    const headers = {
      ...getCorsHeaders(origin, req),
      "Content-Type": "application/json",
      "Cache-Control": "private, max-age=300, stale-while-revalidate=900",
      "X-Server-Time-Ms": elapsed.toString(),
    };

    return new Response(body, { headers });
  } catch (error) {
    console.error("[list-leagues-grouped] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...getCorsHeaders(origin, req), "Content-Type": "application/json" },
    });
  }
});
