import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { apiHeaders, API_BASE } from "../_shared/api.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const RequestSchema = z.object({
  fixtureId: z.number().int().positive(),
  markets: z.array(z.string()).optional(),
  bookmakers: z.array(z.string()).optional(),
  live: z.boolean().optional(),
  forceRefresh: z.boolean().optional(),
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    // Validate input
    const bodyRaw = await req.json().catch(() => null);
    if (!bodyRaw) {
      return new Response(
        JSON.stringify({ error: "Invalid request body" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const validation = RequestSchema.safeParse(bodyRaw);
    if (!validation.success) {
      console.error("[fetch-odds] Validation error:", validation.error.format());
      return new Response(
        JSON.stringify({ error: "Invalid request parameters" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
      );
    }

    const { fixtureId, markets, bookmakers, live = false, forceRefresh = false } = validation.data;
    
    const API_KEY = Deno.env.get("API_FOOTBALL_KEY");
    if (!API_KEY) {
      throw new Error("API_FOOTBALL_KEY not configured");
    }

    const cacheKey = `odds:${fixtureId}:${live ? "live" : "prematch"}:${markets?.join(",") || "all"}:${bookmakers?.join(",") || "all"}`;

    // Check cache
    if (!forceRefresh) {
      const { data: cachedOdds } = await supabaseClient
        .from("odds_cache")
        .select("*")
        .eq("fixture_id", fixtureId)
        .single();

      if (cachedOdds) {
        const cacheAge = Date.now() - new Date(cachedOdds.captured_at).getTime();
        const ONE_HOUR = 60 * 60 * 1000;

        if (cacheAge < ONE_HOUR) {
          console.log(`[fetch-odds] Cache hit for fixture ${fixtureId} (age: ${Math.round(cacheAge / 1000 / 60)}min)`);
          return new Response(
            JSON.stringify({
              ...cachedOdds.payload,
              source: live ? "live" : "prematch",
              cached: true,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          console.log(`[fetch-odds] Cache stale for fixture ${fixtureId} (age: ${Math.round(cacheAge / 1000 / 60)}min)`);
        }
      } else {
        console.log(`[fetch-odds] Cache miss for fixture ${fixtureId}`);
      }
    }

    // Fetch from API
    console.log(`[fetch-odds] Fetching odds from API for fixture ${fixtureId} (live=${live})`);
    const searchParams = new URLSearchParams({
      fixture: fixtureId.toString(),
    });

    if (live) {
      searchParams.append("live", "true");
    }

    const res = await fetch(`${API_BASE}/odds?${searchParams}`, {
      method: "GET",
      headers: apiHeaders(),
    });

    if (!res.ok) {
      console.error(`[fetch-odds] API error: ${res.status} ${res.statusText}`);
      return new Response(JSON.stringify({ error: "API error" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const json = await res.json();
    if (!json.response || json.response.length === 0) {
      console.warn(`[fetch-odds] No odds found for fixture ${fixtureId}`);
      return new Response(
        JSON.stringify({ error: "No odds found", fixtureId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Transform and filter odds
    const fixtureOdds = json.response[0];
    const selections = flattenOddsToSelections(fixtureOdds);

    // Persist to cache
    console.log(`[fetch-odds] Persisting ${selections.length} selections to cache for fixture ${fixtureId}`);
    await supabaseClient.from("odds_cache").upsert({
      fixture_id: fixtureId,
      captured_at: new Date().toISOString(),
      payload: {
        fixture: fixtureOdds.fixture,
        bookmakers: fixtureOdds.bookmakers,
      },
    });

    return new Response(
      JSON.stringify({
        fixture: fixtureOdds.fixture,
        selections,
        source: live ? "live" : "prematch",
        cached: false,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[fetch-odds] Internal error:", {
      message: error instanceof Error ? error.message : "Unknown",
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    });
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

function flattenOddsToSelections(fixtureOdds: any) {
  const selections: any[] = [];

  for (const bookmaker of fixtureOdds.bookmakers) {
    for (const market of bookmaker.markets) {
      for (const outcome of market.outcomes) {
        selections.push({
          bookmaker: bookmaker.name,
          market: normalizeMarketNameOld(market.name),
          kind: normalizeOutcomeName(outcome.name),
          odds: outcome.odd,
          line: extractLineFromMarket(market.name),
        });
      }
    }
  }

  return selections;
}

function extractLineFromMarket(marketName: string): number | null {
  const match = marketName.match(/Over (\d+\.?\d*)/i);
  if (match) {
    return parseFloat(match[1]);
  }
  return null;
}

function normalizeOutcomeName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("over")) return "over";
  if (lower.includes("under")) return "under";
  return name;
}

function normalizeMarketNameOld(marketName: string): string {
  const lower = marketName.toLowerCase();
  if (lower.includes("goals")) return "goals";
  if (lower.includes("card")) return "cards";
  if (lower.includes("corner")) return "corners";
  return "unknown";
}
