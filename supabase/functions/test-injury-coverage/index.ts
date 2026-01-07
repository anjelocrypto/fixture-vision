import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchLeagueInjuries } from "../_shared/injuries.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Admin auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: isAdmin } = await supabaseClient.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });

    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log("[test-injury-coverage] Testing injury coverage for all active leagues");

    // Get all leagues with upcoming fixtures
    const { data: upcomingLeagues } = await supabaseClient
      .from("fixtures")
      .select("league_id")
      .gte("timestamp", Math.floor(Date.now() / 1000))
      .lte("timestamp", Math.floor((Date.now() + 120 * 60 * 60 * 1000) / 1000))
      .in("status", ["NS", "TBD"]);

    const uniqueLeagueIds = [...new Set((upcomingLeagues || []).map((f: any) => f.league_id))];
    console.log(`[test-injury-coverage] Testing ${uniqueLeagueIds.length} leagues`);

    const now = new Date();
    const month = now.getUTCMonth();
    const year = now.getUTCFullYear();
    const season = (month >= 7) ? year : year - 1;

    const results: Record<number, number> = {};
    const supportedLeagues: number[] = [];

    for (const leagueId of uniqueLeagueIds.slice(0, 30)) { // Test first 30 to avoid quota
      try {
        const injuries = await fetchLeagueInjuries(leagueId, season);
        results[leagueId] = injuries.length;
        
        if (injuries.length > 0) {
          supportedLeagues.push(leagueId);
          console.log(`[test-injury-coverage] ✅ League ${leagueId}: ${injuries.length} injuries`);
        } else {
          console.log(`[test-injury-coverage] ⚪ League ${leagueId}: no injuries`);
        }
        
        // Rate limit: ~1 request/second
        await new Promise(resolve => setTimeout(resolve, 1200));
      } catch (err) {
        console.error(`[test-injury-coverage] ❌ League ${leagueId}: error`, err);
        results[leagueId] = -1;
      }
    }

    console.log(`[test-injury-coverage] Found ${supportedLeagues.length} leagues with injury data`);

    return new Response(
      JSON.stringify({
        tested: Object.keys(results).length,
        supported_leagues: supportedLeagues,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[test-injury-coverage] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
