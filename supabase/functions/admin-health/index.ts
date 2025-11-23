import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    // Verify user session
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user is admin using has_role function
    const { data: isAdmin, error: roleError } = await supabaseClient.rpc("has_role", {
      _user_id: user.id,
      _role: "admin",
    });

    if (roleError || !isAdmin) {
      console.log(`[admin-health] Access denied for user ${user.id}`);
      return new Response(
        JSON.stringify({ error: "forbidden", message: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[admin-health] Admin access granted for user ${user.id}`);

    // Use service role for data queries
    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Fixtures & Results Coverage (last 12 months)
    const { data: coverageData } = await supabaseService.rpc("get_fixtures_coverage");
    
    // Fallback if RPC doesn't exist - use direct query
    let fixturesCoverage;
    if (!coverageData) {
      const { data: fixtures } = await supabaseService
        .from("fixtures")
        .select("id, status")
        .in("status", ["FT", "AET", "PEN"])
        .gte("timestamp", Math.floor(Date.now() / 1000) - (12 * 30 * 24 * 60 * 60));
      
      const fixtureIds = fixtures?.map(f => f.id) || [];
      const { data: results } = await supabaseService
        .from("fixture_results")
        .select("fixture_id")
        .in("fixture_id", fixtureIds);
      
      const totalFinished = fixtures?.length || 0;
      const withResults = results?.length || 0;
      const missing = totalFinished - withResults;
      const coveragePct = totalFinished > 0 ? (withResults / totalFinished) * 100 : 0;
      
      fixturesCoverage = {
        total_finished: totalFinished,
        with_results: withResults,
        missing,
        coverage_pct: Math.round(coveragePct * 100) / 100,
      };
    } else {
      fixturesCoverage = coverageData;
    }

    // 2. Stats Coverage for Upcoming Teams (next 120 hours)
    const nowEpoch = Math.floor(Date.now() / 1000);
    const in120h = nowEpoch + (120 * 60 * 60);
    
    const { data: upcomingFixtures } = await supabaseService
      .from("fixtures")
      .select("teams_home, teams_away")
      .gte("timestamp", nowEpoch)
      .lte("timestamp", in120h)
      .in("status", ["NS", "TBD"]);
    
    const teamIds = new Set<number>();
    upcomingFixtures?.forEach(f => {
      const homeId = f.teams_home?.id;
      const awayId = f.teams_away?.id;
      if (homeId) teamIds.add(Number(homeId));
      if (awayId) teamIds.add(Number(awayId));
    });
    
    const { data: statsData } = await supabaseService
      .from("stats_cache")
      .select("team_id, sample_size, computed_at")
      .in("team_id", Array.from(teamIds));
    
    const totalTeams = teamIds.size;
    const teamsWithStats = statsData?.length || 0;
    const fresh24h = statsData?.filter(s => {
      const computedAt = new Date(s.computed_at);
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return computedAt >= dayAgo;
    }).length || 0;
    const zeroSample = statsData?.filter(s => s.sample_size === 0).length || 0;
    const usableTeams = statsData?.filter(s => s.sample_size >= 3).length || 0;
    const usablePct = totalTeams > 0 ? (usableTeams / totalTeams) * 100 : 0;
    
    const statsUpcomingTeams = {
      total_teams: totalTeams,
      teams_with_stats: teamsWithStats,
      fresh_stats_24h: fresh24h,
      zero_sample_teams: zeroSample,
      usable_teams: usableTeams,
      usable_pct: Math.round(usablePct * 100) / 100,
    };

    // 3. Selection Coverage (next 48 hours)
    const in48h = nowEpoch + (48 * 60 * 60);
    
    const { data: upcoming48h } = await supabaseService
      .from("fixtures")
      .select("id")
      .gte("timestamp", nowEpoch)
      .lte("timestamp", in48h)
      .in("status", ["NS", "TBD"]);
    
    const upcomingFixtureIds48h = upcoming48h?.map(f => f.id) || [];
    
    const { data: selectionsData } = await supabaseService
      .from("optimized_selections")
      .select("fixture_id")
      .eq("is_live", false)
      .in("fixture_id", upcomingFixtureIds48h);
    
    const uniqueFixturesWithSelections = new Set(selectionsData?.map(s => s.fixture_id) || []).size;
    const upcomingFixtures48h = upcomingFixtureIds48h.length;
    const fixturesWithSelections48h = uniqueFixturesWithSelections;
    const fixturesWithoutSelections48h = upcomingFixtures48h - fixturesWithSelections48h;
    const selectionCoveragePct48h = upcomingFixtures48h > 0 
      ? (fixturesWithSelections48h / upcomingFixtures48h) * 100 
      : 0;
    
    const selectionsCoverage = {
      upcoming_fixtures_48h: upcomingFixtures48h,
      fixtures_with_selections_48h: fixturesWithSelections48h,
      fixtures_without_selections_48h: fixturesWithoutSelections48h,
      selection_coverage_pct_48h: Math.round(selectionCoveragePct48h * 100) / 100,
    };

    // 4. Last Stats Refresh
    const { data: lastStatsData } = await supabaseService
      .from("optimizer_run_logs")
      .select("started_at, duration_ms, scanned, upserted, failed")
      .eq("run_type", "stats-refresh-batch")
      .order("started_at", { ascending: false })
      .limit(1)
      .single();
    
    const lastStatsRefresh = lastStatsData ? {
      started_at: lastStatsData.started_at,
      duration_ms: lastStatsData.duration_ms,
      scanned: lastStatsData.scanned,
      upserted: lastStatsData.upserted,
      failed: lastStatsData.failed,
    } : {
      started_at: null,
      duration_ms: null,
      scanned: null,
      upserted: null,
      failed: null,
    };

    // 5. Sample Teams (5 random with good stats)
    const { data: sampleTeamsData } = await supabaseService
      .from("stats_cache")
      .select("team_id, goals, corners, cards, fouls, offsides, sample_size, last_five_fixture_ids, computed_at")
      .in("team_id", Array.from(teamIds))
      .gte("sample_size", 3)
      .not("last_five_fixture_ids", "is", null)
      .limit(5);
    
    const sampleTeams = sampleTeamsData?.map(s => ({
      team_id: s.team_id,
      goals: Number(s.goals),
      corners: Number(s.corners),
      cards: Number(s.cards),
      fouls: Number(s.fouls),
      offsides: Number(s.offsides),
      sample_size: s.sample_size,
      last_five_fixture_ids: s.last_five_fixture_ids || [],
      computed_at: s.computed_at,
    })) || [];

    // 6. Recent Runs (last 10 with status)
    const { data: recentRunsData } = await supabaseService
      .from("optimizer_run_logs")
      .select("run_type, started_at, finished_at, duration_ms, scanned, upserted, skipped, failed, notes")
      .order("started_at", { ascending: false })
      .limit(10);
    
    const recentRuns = (recentRunsData || []).map(run => {
      let status: 'success' | 'warning' | 'error' = 'success';
      if ((run.failed || 0) > 0) {
        status = 'error';
      } else if ((run.skipped || 0) > 0) {
        status = 'warning';
      }
      
      return {
        started_at: run.started_at,
        run_type: run.run_type,
        duration_ms: run.duration_ms,
        scanned: run.scanned,
        upserted: run.upserted,
        skipped: run.skipped,
        failed: run.failed,
        notes: run.notes,
        status,
      };
    });

    // 7. Cron Jobs (pg_cron)
    // Note: Direct pg_cron access may not be available, return empty array
    const cronJobs: { jobname: string; schedule: string; active: boolean }[] = [];

    const response = {
      fixturesCoverage,
      statsUpcomingTeams,
      selectionsCoverage,
      lastStatsRefresh,
      fixturesDetail: {
        total_finished: fixturesCoverage.total_finished,
        with_results: fixturesCoverage.with_results,
        missing: fixturesCoverage.missing,
      },
      recentRuns,
      cronJobs,
      sampleTeams,
      timestamp: new Date().toISOString(),
    };

    console.log(`[admin-health] Response generated successfully`);

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error: any) {
    console.error("[admin-health] Error:", error);
    return new Response(
      JSON.stringify({ error: "internal_server_error", message: error?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
