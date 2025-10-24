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
        const SIX_HOURS = 6 * 60 * 60 * 1000;

        if (cacheAge < SIX_HOURS) {
          console.log(`[fetch-odds] Cache hit for fixture ${fixtureId} (age: ${Math.round(cacheAge / 1000 / 60)}min)`);
          
          // Flatten cached odds to selections format
          const cachedFixtureOdds = {
            fixture: cachedOdds.payload.fixture,
            bookmakers: cachedOdds.payload.bookmakers || [],
          };
          const selections = flattenOddsToSelections(cachedFixtureOdds);
          
          console.log(`[fetch-odds] Returning ${selections.length} cached selections for fixture ${fixtureId}`);
          
          return new Response(
            JSON.stringify({
              fixture: cachedFixtureOdds.fixture,
              selections,
              source: live ? "live" : "prematch",
              cached: true,
              stale: cacheAge >= 60 * 60 * 1000, // mark stale if older than 1h
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          console.log(`[fetch-odds] Cache stale (>6h) for fixture ${fixtureId} (age: ${Math.round(cacheAge / 1000 / 60)}min)`);
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
      // Fallback to any cached odds (even stale)
      const { data: cachedOdds } = await supabaseClient
        .from("odds_cache")
        .select("*")
        .eq("fixture_id", fixtureId)
        .maybeSingle();
      if (cachedOdds) {
        const cachedFixtureOdds = {
          fixture: cachedOdds.payload.fixture,
          bookmakers: cachedOdds.payload.bookmakers || [],
        };
        const selections = flattenOddsToSelections(cachedFixtureOdds);
        console.warn(`[fetch-odds] Using cached (fallback) ${selections.length} selections for fixture ${fixtureId}`);
        return new Response(
          JSON.stringify({
            fixture: cachedFixtureOdds.fixture,
            selections,
            source: live ? "live" : "prematch",
            cached: true,
            fallback: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({ error: "API error" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const json = await res.json();
    if (!json.response || json.response.length === 0) {
      console.warn(`[fetch-odds] No odds found for fixture ${fixtureId} from API, attempting cache fallback`);
      const { data: cachedOdds } = await supabaseClient
        .from("odds_cache")
        .select("*")
        .eq("fixture_id", fixtureId)
        .maybeSingle();
      if (cachedOdds) {
        const cachedFixtureOdds = {
          fixture: cachedOdds.payload.fixture,
          bookmakers: cachedOdds.payload.bookmakers || [],
        };
        const selections = flattenOddsToSelections(cachedFixtureOdds);
        console.warn(`[fetch-odds] Using cached (fallback) ${selections.length} selections for fixture ${fixtureId}`);
        return new Response(
          JSON.stringify({
            fixture: cachedFixtureOdds.fixture,
            selections,
            source: live ? "live" : "prematch",
            cached: true,
            fallback: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
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
  let skippedInvalidBets = 0;
  let skippedInvalidValues = 0;
  let skippedInvalidOdds = 0;

  // Official API-Football bet IDs for full match totals only
  const OFFICIAL_BET_IDS: Record<number, string> = {
    5: "goals",    // Goals Over/Under (full match)
    45: "corners", // Corners Over/Under (full match)
    80: "cards",   // Cards Over/Under (full match)
  };

  for (const bookmaker of fixtureOdds.bookmakers || []) {
    const bookmakerName = bookmaker.name || `Bookmaker ${bookmaker.id}`;
    
    for (const bet of bookmaker.bets || bookmaker.markets || []) {
      const betId = bet?.id;
      const market = OFFICIAL_BET_IDS[betId];
      
      // STRICT: Only accept official bet IDs
      if (!market) {
        skippedInvalidBets++;
        continue;
      }
      
      for (const value of bet.values || []) {
        const valueStr = String(value.value || "").trim();
        
        // STRICT: Parse only "Over X.Y" or "Under X.Y" format (case insensitive)
        const parsed = parseValueStringStrict(valueStr);
        if (!parsed) {
          skippedInvalidValues++;
          continue;
        }
        
        const odds = Number(value.odd);
        
        // STRICT: Validate odds are finite and > 1.0
        if (!Number.isFinite(odds) || odds <= 1.01) {
          skippedInvalidOdds++;
          continue;
        }
        
        // STRICT: Validate line is finite
        if (!Number.isFinite(parsed.line)) {
          skippedInvalidValues++;
          continue;
        }
        
        selections.push({
          bookmaker: bookmakerName,
          market: market,
          kind: parsed.side,
          odds: odds,
          line: parsed.line,
          scope: "full", // Explicit scope marker
        });
      }
    }
  }

  console.log(`[fetch-odds] Flattened ${selections.length} valid selections from ${fixtureOdds.bookmakers?.length || 0} bookmakers`);
  if (skippedInvalidBets > 0 || skippedInvalidValues > 0 || skippedInvalidOdds > 0) {
    console.log(`[fetch-odds] Skipped: ${skippedInvalidBets} invalid bet IDs, ${skippedInvalidValues} invalid values, ${skippedInvalidOdds} invalid odds`);
  }
  return selections;
}

// STRICT parser: Only accept "Over X.Y" or "Under X.Y" (full match only)
function parseValueStringStrict(valueStr: string): { side: "over" | "under"; line: number } | null {
  const lower = valueStr.toLowerCase().trim();
  
  // Reject anything that looks like 1st half, 2nd half, team-specific, or Asian variants
  if (
    lower.includes("1st half") ||
    lower.includes("2nd half") ||
    lower.includes("1h") ||
    lower.includes("2h") ||
    lower.includes("home") ||
    lower.includes("away") ||
    lower.includes("asian") ||
    lower.includes("team")
  ) {
    return null;
  }
  
  // Accept only "Over X.Y" or "Under X.Y" where X.Y is a decimal number
  const overMatch = lower.match(/^over\s+([\d.]+)$/);
  const underMatch = lower.match(/^under\s+([\d.]+)$/);
  
  if (overMatch) {
    const line = parseFloat(overMatch[1]);
    return Number.isFinite(line) ? { side: "over", line } : null;
  }
  if (underMatch) {
    const line = parseFloat(underMatch[1]);
    return Number.isFinite(line) ? { side: "under", line } : null;
  }
  
  return null;
}

// Legacy parser (kept for backward compatibility in other functions)
function parseValueString(valueStr: string): { side: "over" | "under"; line: number } | null {
  const lower = valueStr.toLowerCase().trim();
  const overMatch = lower.match(/(?:over|o)\s*([\d.]+)/);
  const underMatch = lower.match(/(?:under|u)\s*([\d.]+)/);
  
  if (overMatch) return { side: "over", line: parseFloat(overMatch[1]) };
  if (underMatch) return { side: "under", line: parseFloat(underMatch[1]) };
  return null;
}

function normalizeMarketNameOld(marketName: string): string {
  const lower = marketName.toLowerCase();
  if (lower.includes("goal")) return "goals";
  if (lower.includes("card")) return "cards";
  if (lower.includes("corner")) return "corners";
  if (lower.includes("foul")) return "fouls";
  if (lower.includes("offside")) return "offsides";
  return "unknown";
}
