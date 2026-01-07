import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RULES_VERSION = 'v2_combined_matrix_v1';

interface LegRequest {
  fixtureId: number;
  market: string;
  side: string;
  line: number;
}

interface OddsUpdate {
  fixtureId: number;
  market: string;
  side: string;
  line: number;
  odds: number | null;
  bookmaker: string | null;
  rules_version: string | null;
  combined_snapshot?: any;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { legs } = await req.json() as { legs: LegRequest[] };

    if (!legs || !Array.isArray(legs) || legs.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid legs array' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[get-latest-odds] Refreshing odds for ${legs.length} legs`);

    const updates: OddsUpdate[] = [];

    // Query optimized_selections for each leg
    for (const leg of legs) {
      const { data, error } = await supabaseClient
        .from('optimized_selections')
        .select('odds, bookmaker, rules_version, combined_snapshot')
        .eq('fixture_id', leg.fixtureId)
        .eq('market', leg.market)
        .eq('side', leg.side)
        .eq('line', leg.line)
        .eq('is_live', false)
        .eq('rules_version', RULES_VERSION)
        .order('odds', { ascending: false })
        .limit(1)
        .single();

      if (error) {
        console.warn(`[get-latest-odds] No data for fixture ${leg.fixtureId} ${leg.market} ${leg.side} ${leg.line}:`, error.message);
        updates.push({
          fixtureId: leg.fixtureId,
          market: leg.market,
          side: leg.side,
          line: leg.line,
          odds: null,
          bookmaker: null,
          rules_version: null,
        });
        continue;
      }

      updates.push({
        fixtureId: leg.fixtureId,
        market: leg.market,
        side: leg.side,
        line: leg.line,
        odds: data.odds,
        bookmaker: data.bookmaker,
        rules_version: data.rules_version,
        combined_snapshot: data.combined_snapshot,
      });
    }

    console.log(`[get-latest-odds] Returning ${updates.length} updates`);

    return new Response(
      JSON.stringify({ updates }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[get-latest-odds] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
