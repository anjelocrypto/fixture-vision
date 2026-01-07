import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchHeadToHeadStats } from "../_shared/h2h.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to construct qualification rule text
function buildQualificationRule(market: string, combinedValue: number | undefined, side: string, line: number): string {
  if (!combinedValue) {
    return `${market} ${side} ${line} (rule-based selection)`;
  }
  
  // Infer range based on line and combined value
  const rangeMin = line - 1.5;
  const rangeMax = line + 1.5;
  return `${market} ${rangeMin.toFixed(1)}–${rangeMax.toFixed(1)} → ${side.charAt(0).toUpperCase() + side.slice(1)} ${line} (inclusive bounds)`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication first
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Create client with user's token for auth and RPC calls
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    // Check access: paid, whitelisted, or trial
    // Use user client so auth.uid() works in the RPC
    const { data: accessCheck, error: accessError } = await supabaseUser.rpc('try_use_feature', {
      feature_key: 'gemini_analysis'
    });
    
    // Create service role client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (accessError) {
      console.error('[analyze-ticket] Access check error:', accessError);
      return new Response(
        JSON.stringify({ error: 'Failed to check access' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessResult = Array.isArray(accessCheck) ? accessCheck[0] : accessCheck;
    
    if (!accessResult?.allowed) {
      console.log(`[analyze-ticket] Access denied: ${accessResult?.reason}`);
      return new Response(
        JSON.stringify({ 
          code: 'PAYWALL',
          error: 'This feature requires a subscription',
          reason: accessResult?.reason || 'no_access',
          remaining_uses: accessResult?.remaining_uses
        }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[analyze-ticket] Access granted: ${accessResult.reason}, remaining: ${accessResult.remaining_uses ?? 'unlimited'}`);

    const { ticket, language = 'en' } = await req.json();
    
    if (!ticket || !ticket.legs) {
      return new Response(
        JSON.stringify({ error: 'Invalid ticket data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[analyze-ticket] Processing ticket with ${ticket.legs.length} legs, mode: ${ticket.mode}, language: ${language}`);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    // Get unique league IDs and fixture IDs
    const leagueIds = [...new Set(ticket.legs.map((leg: any) => leg.league_id).filter(Boolean))];
    const fixtureIds = [...new Set(ticket.legs.map((leg: any) => leg.fixture_id).filter(Boolean))];
    
    // Fetch league and country data
    let leagueMap = new Map();
    let countryMap = new Map();
    
    if (leagueIds.length > 0) {
      const { data: leagues } = await supabase
        .from('leagues')
        .select('id, name, country_id')
        .in('id', leagueIds);

      if (leagues && leagues.length > 0) {
        const countryIds = [...new Set(leagues.map(l => l.country_id).filter(Boolean))];
        
        if (countryIds.length > 0) {
          const { data: countries } = await supabase
            .from('countries')
            .select('id, code, name')
            .in('id', countryIds);
          
          countryMap = new Map(countries?.map(c => [c.id, c]) ?? []);
        }
        
        leagueMap = new Map(leagues.map(l => [l.id, l]));
      }
    }

    // Fetch optimized_selections for enrichment (combined_snapshot, rules_version, etc.)
    let selectionsMap = new Map();
    if (fixtureIds.length > 0) {
      const { data: selections } = await supabase
        .from('optimized_selections')
        .select('fixture_id, market, side, line, combined_snapshot, rules_version, model_prob, edge_pct, bookmaker')
        .in('fixture_id', fixtureIds);
      
      if (selections) {
        // Create composite key: fixtureId-market-side-line
        selections.forEach(sel => {
          const key = `${sel.fixture_id}-${sel.market}-${sel.side}-${sel.line}`;
          selectionsMap.set(key, sel);
        });
      }
    }
    
    console.log(`[analyze-ticket] Enriched ${selectionsMap.size} selections from optimized_selections table`);


    // Build enriched structured data for each match, including H2H stats
    const matchesData = await Promise.all(ticket.legs.map(async (leg: any, index: number) => {
      const league = leagueMap.get(leg.league_id);
      const country = league ? countryMap.get(league.country_id) : null;
      
      // Parse side and line from pick if not directly available
      const pickLower = leg.pick?.toLowerCase() || '';
      const side = leg.side || (pickLower.includes('over') ? 'over' : pickLower.includes('under') ? 'under' : 'over');
      const lineMatch = leg.pick?.match(/(\d+\.?\d*)/);
      const line = leg.line || (lineMatch ? parseFloat(lineMatch[1]) : 2.5);
      
      // Try to find enriched data from optimized_selections
      const selectionKey = `${leg.fixture_id}-${leg.market}-${side}-${line}`;
      const enrichedSelection = selectionsMap.get(selectionKey);
      
      // Extract combined value for this market
      const combinedSnapshot = enrichedSelection?.combined_snapshot || {};
      const marketValue = combinedSnapshot[leg.market] || null;
      
      // Extract team IDs from leg (assuming they're in teams_home/teams_away JSON)
      let homeTeamId: number | null = null;
      let awayTeamId: number | null = null;
      let homeStats: any = null;
      let awayStats: any = null;
      let h2hStats: any = null;
      
      try {
        // Fetch fixture to get team IDs
        const { data: fixtureData } = await supabase
          .from('fixtures')
          .select('teams_home, teams_away')
          .eq('id', leg.fixture_id)
          .single();
        
        if (fixtureData) {
          homeTeamId = fixtureData.teams_home?.id;
          awayTeamId = fixtureData.teams_away?.id;
          
          // Fetch home and away team stats from stats_cache
          if (homeTeamId) {
            const { data: homeStatsData } = await supabase
              .from('stats_cache')
              .select('*')
              .eq('team_id', homeTeamId)
              .single();
            homeStats = homeStatsData;
          }
          
          if (awayTeamId) {
            const { data: awayStatsData } = await supabase
              .from('stats_cache')
              .select('*')
              .eq('team_id', awayTeamId)
              .single();
            awayStats = awayStatsData;
          }
          
          // Fetch H2H stats if we have both team IDs
          if (homeTeamId && awayTeamId) {
            h2hStats = await fetchHeadToHeadStats(homeTeamId, awayTeamId, supabase, 7);
          }
        }
      } catch (statsError) {
        console.error(`[analyze-ticket] Error fetching stats for fixture ${leg.fixture_id}:`, statsError);
        // Continue without stats - non-fatal
      }
      
      return {
        match_number: index + 1,
        fixture_id: leg.fixture_id,
        teams: `${leg.home_team} vs ${leg.away_team}`,
        home_team: leg.home_team,
        away_team: leg.away_team,
        league_id: leg.league_id,
        league_name: league?.name || null,
        country_code: country?.code || null,
        country_name: country?.name || null,
        kickoff: leg.kickoff || 'TBD',
        market: leg.market,
        side: side,
        line: line,
        odds: leg.odds,
        bookmaker: leg.bookmaker,
        model_prob: leg.model_prob || enrichedSelection?.model_prob || null,
        book_prob: leg.book_prob || null,
        edge: leg.edge || enrichedSelection?.edge_pct || null,
        combined_snapshot: combinedSnapshot,
        home_stats: homeStats ? {
          goals: Number(homeStats.goals),
          corners: Number(homeStats.corners),
          cards: Number(homeStats.cards),
          fouls: Number(homeStats.fouls),
          offsides: Number(homeStats.offsides),
          sample_size: homeStats.sample_size
        } : null,
        away_stats: awayStats ? {
          goals: Number(awayStats.goals),
          corners: Number(awayStats.corners),
          cards: Number(awayStats.cards),
          fouls: Number(awayStats.fouls),
          offsides: Number(awayStats.offsides),
          sample_size: awayStats.sample_size
        } : null,
        h2h_stats: h2hStats,
        qualification_rule: buildQualificationRule(leg.market, marketValue, side, line),
        rules_version: enrichedSelection?.rules_version || 'v2_combined_matrix_v1',
        odds_band_enforced: '[1.25, 5.00]'
      };
    }));

    const ticketSummary = {
      rules_version: 'v2_combined_matrix_v1',
      mode: ticket.mode || 'balanced',
      used_live: ticket.used_live || false,
      target_total_odds_band: ticket.target_min && ticket.target_max 
        ? `${ticket.target_min}–${ticket.target_max}x` 
        : null,
      combined_total_odds: ticket.total_odds,
      estimated_win_prob: ticket.estimated_win_prob || null,
      number_of_legs: ticket.legs.length,
      search: ticket.search || null
    };

    console.log(`[analyze-ticket] Payload: ${ticket.legs.length} legs, total odds ${ticket.total_odds.toFixed(2)}x, first leg: ${matchesData[0]?.teams || 'N/A'}`);

    // Language-specific instructions
    const languageInstruction = language === 'ka' 
      ? `\n\n**CRITICAL LANGUAGE REQUIREMENT:**
You MUST write your ENTIRE response in Georgian (ქართული ენა). This includes:
- The overall_summary field - write completely in Georgian
- All match analysis text - write completely in Georgian  
- All explanations and reasoning - write completely in Georgian
- The confidence_level values should be: "მაღალი" (High), "საშუალო" (Medium), or "დაბალი" (Low)
- Keep only match_title and recommended_bet in English format (team names, odds)

Example confidence levels in Georgian:
- "მაღალი" for High confidence
- "საშუალო" for Medium confidence  
- "დაბალი" for Low confidence

Remember: Write ALL analysis text in Georgian language!`
      : '';

    // Structured prompt for Gemini
    const prompt = `You are Gemini 2.5 Flash — an advanced AI sports analyst integrated into the BET AI system.

Your task: Analyze the following betting ticket that was generated by our Optimized Bets engine.${languageInstruction}

TICKET SUMMARY:
${JSON.stringify(ticketSummary, null, 2)}

MATCHES DATA:
${JSON.stringify(matchesData, null, 2)}

---

### 🎯 Your Objective:
Provide a detailed, expert-level analysis of the entire ticket.
For each match, explain **why the bet makes sense**, referring to the provided data and adding your own deeper contextual reasoning based on football knowledge.

**Important:**
- Never contradict the provided optimized bet. Your role is to justify and expand upon it.
- Use factual, professional language — like a sports analyst report.
- Focus on key factors such as team form, tactical matchups, and statistical trends.
- If possible, identify *supporting factors* (why the bet is strong) and *risk factors* (what could affect it).

---

### 🧩 Output Format:
Return a structured JSON with this format:
{
  "overall_summary": "General analysis of the entire ticket — e.g. overall logic, consistency, and confidence.${language === 'ka' ? ' [WRITE IN GEORGIAN]' : ''}",
  "matches": [
    {
      "match_title": "Team A vs Team B (League Name, Country)",
      "recommended_bet": "Over 2.5 Goals @ 1.75",
      "analysis": "Detailed 3–5 sentence analysis explaining why this bet was generated and what factors support it. Mention form, key players, match context, etc.${language === 'ka' ? ' [WRITE IN GEORGIAN]' : ''}",
      "confidence_level": "${language === 'ka' ? 'მაღალი / საშუალო / დაბალი' : 'High / Medium / Low'}"
    }
  ]
}

**Important for match_title formatting:**
- Use the provided league_name and country_name in the title format: "Home Team vs Away Team (League Name, Country)"
- If league_name is missing, omit the parentheses entirely (do NOT write "Unknown League")
- Example: "Real Betis vs Atletico Madrid (La Liga, Spain)" or "Arsenal vs Chelsea (Premier League, England)"

Generate the JSON response only — no extra commentary. Ensure it's valid JSON.`;

    console.log('[analyze-ticket] Calling Gemini 2.5 Flash with enriched payload...');

    // Helper function to call Gemini
    const callGemini = async (promptText: string, temperature: number = 0.5) => {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'user', content: promptText }
          ],
          temperature: temperature,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[analyze-ticket] Gemini API error:', response.status, errorText);
        
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        }
        
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('No response from Gemini');
      }

      return content;
    };

    // First attempt
    let geminiResponse = await callGemini(prompt);
    console.log('[analyze-ticket] Gemini response received, validating...');

    // Parse and validate JSON response
    let analysis;
    let parseAttempts = 0;
    const maxAttempts = 2;

    while (parseAttempts < maxAttempts) {
      try {
        // Extract JSON from markdown code blocks if present
        const jsonMatch = geminiResponse.match(/```json\s*([\s\S]*?)\s*```/) || 
                         geminiResponse.match(/```\s*([\s\S]*?)\s*```/);
        const jsonText = jsonMatch ? jsonMatch[1] : geminiResponse;
        
        const parsed = JSON.parse(jsonText);
        
        // Validate schema
        if (!parsed.overall_summary || typeof parsed.overall_summary !== 'string') {
          throw new Error('Missing or invalid overall_summary');
        }
        if (!Array.isArray(parsed.matches) || parsed.matches.length !== ticket.legs.length) {
          throw new Error(`Expected ${ticket.legs.length} matches, got ${parsed.matches?.length || 0}`);
        }
        
        // Validate each match
        const validConfidenceLevels = language === 'ka' 
          ? ['მაღალი', 'საშუალო', 'დაბალი', 'High', 'Medium', 'Low']
          : ['High', 'Medium', 'Low'];
          
        for (let i = 0; i < parsed.matches.length; i++) {
          const match = parsed.matches[i];
          if (!match.match_title || !match.recommended_bet || !match.analysis || !match.confidence_level) {
            throw new Error(`Match ${i + 1} missing required fields`);
          }
          if (!validConfidenceLevels.includes(match.confidence_level)) {
            throw new Error(`Match ${i + 1} has invalid confidence_level: ${match.confidence_level}`);
          }
          
          // Enrich with stats from matchesData
          const matchData = matchesData[i];
          if (matchData) {
            match.home_team = matchData.home_team;
            match.away_team = matchData.away_team;
            match.home_stats = matchData.home_stats;
            match.away_stats = matchData.away_stats;
            match.h2h_stats = matchData.h2h_stats;
            match.combined_snapshot = matchData.combined_snapshot;
          }
        }
        
        // Valid!
        analysis = parsed;
        console.log('[analyze-ticket] Schema validation passed');
        break;
        
      } catch (parseError) {
        parseAttempts++;
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        console.error(`[analyze-ticket] Parse attempt ${parseAttempts} failed:`, errorMsg);
        
        if (parseAttempts < maxAttempts) {
          console.log('[analyze-ticket] Retrying with format-fix prompt...');
          const retryPrompt = `${prompt}\n\nIMPORTANT: Your previous response had formatting issues. Return ONLY valid JSON exactly matching the required schema; do not include markdown code fences or any other text.`;
          geminiResponse = await callGemini(retryPrompt);
        } else {
          // Final fallback
          console.error('[analyze-ticket] All parse attempts failed, returning fallback structure');
          analysis = {
            overall_summary: `Analysis of ${ticket.legs.length}-leg ${ticket.mode} ticket with total odds ${ticket.total_odds.toFixed(2)}x. Detailed breakdown unavailable due to formatting error.`,
            matches: matchesData.map((m: any) => {
              const leagueText = m.league_name && m.country_name 
                ? ` (${m.league_name}, ${m.country_name})` 
                : m.league_name 
                  ? ` (${m.league_name})` 
                  : '';
              return {
                match_title: `${m.teams}${leagueText}`,
                recommended_bet: `${m.market} ${m.side} ${m.line} @ ${m.odds.toFixed(2)}`,
                analysis: `Qualified via ${m.qualification_rule}. Combined snapshot: ${JSON.stringify(m.combined_snapshot)}.`,
                confidence_level: 'Medium'
              };
            })
          };
        }
      }
    }

    return new Response(
      JSON.stringify({ analysis }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[analyze-ticket] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
