import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Activity, Database, TrendingUp, Zap, Clock, CheckCircle2, XCircle, ShieldAlert, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { StatsHealthDashboard } from "@/components/StatsHealthDashboard";

type AdminHealthResponse = {
  fixturesCoverage: {
    total_finished: number;
    with_results: number;
    missing: number;
    coverage_pct: number;
  };
  statsUpcomingTeams: {
    total_teams: number;
    teams_with_stats: number;
    fresh_stats_24h: number;
    zero_sample_teams: number;
    usable_teams: number;
    usable_pct: number;
  };
  selectionsCoverage: {
    upcoming_fixtures_48h: number;
    fixtures_with_selections_48h: number;
    fixtures_without_selections_48h: number;
    selection_coverage_pct_48h: number;
  };
  fixturesWithLast5Stats: {
    total_fixtures: number;
    fixtures_with_complete_stats: number;
    fixtures_missing_stats: number;
    complete_stats_pct: number;
  };
  lastStatsRefresh: {
    started_at: string | null;
    duration_ms: number | null;
    scanned: number | null;
    upserted: number | null;
    failed: number | null;
  };
  fixturesDetail: {
    total_finished: number;
    with_results: number;
    missing: number;
  };
  recentRuns: {
    started_at: string;
    run_type: string;
    duration_ms: number | null;
    scanned: number | null;
    upserted: number | null;
    skipped: number | null;
    failed: number | null;
    notes: string | null;
    status: 'success' | 'warning' | 'error';
  }[];
  cronJobs: {
    jobname: string;
    schedule: string;
    active: boolean;
  }[];
  sampleTeams: {
    team_id: number;
    goals: number;
    corners: number;
    cards: number;
    fouls: number;
    offsides: number;
    sample_size: number;
    last_five_fixture_ids: number[];
    computed_at: string;
  }[];
  timestamp: string;
};

const AdminHealth = () => {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    const checkAdminStatus = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast.error("You must be logged in to view this page");
        navigate("/auth");
        return;
      }

      // Check admin role
      const { data: hasAdminRole, error } = await supabase.rpc("has_role", {
        _user_id: session.user.id,
        _role: "admin",
      });

      if (error || !hasAdminRole) {
        toast.error("You do not have permission to view the admin dashboard");
        navigate("/");
        return;
      }

      setIsAdmin(true);
    };

    checkAdminStatus();
  }, [navigate]);

  const [isTurboRunning, setIsTurboRunning] = useState(false);
  const [isTopLeaguesTurboRunning, setIsTopLeaguesTurboRunning] = useState(false);

  // All leagues for turbo backfill (matching ALLOWED_LEAGUE_IDS)
  const ALL_TURBO_LEAGUES = {
    ids: [
      // UEFA Club Competitions
      2, 3, 848,
      // Domestic Cups
      45, 48, 143, 137, 81, 66,
      // England
      39, 40, 41, 42, 43, 50, 51, 667,
      // Spain
      140, 141, 435, 436, 663,
      // Italy
      135, 136, 269,
      // Germany
      78, 79, 80,
      // France
      61, 62, 556,
      // Netherlands
      88, 89,
      // Portugal
      94, 95,
      // Turkey
      203, 204,
      // Belgium
      144, 145,
      // Scotland
      179, 180,
      // Austria
      218, 219,
      // Switzerland
      207, 208,
      // Greece
      197, 198,
      // Denmark
      119,
      // Norway
      103,
      // Sweden
      113, 114,
      // Poland
      106, 107,
      // Czech Republic
      345,
      // Romania
      283,
      // Croatia
      210,
      // Serbia
      286,
      // Bulgaria
      172,
      // Hungary
      271,
      // Ukraine
      333,
      // Russia
      235,
      // USA
      253, 254,
      // Mexico
      262, 263,
      // Brazil
      71, 72,
      // Argentina
      128, 129,
      // Colombia
      239,
      // Chile
      265,
      // Uruguay
      274,
      // Paraguay
      250,
      // Ecuador
      242,
      // Japan
      98, 99,
      // South Korea
      292,
      // Australia
      188,
      // China
      17,
      // Saudi Arabia
      307,
      // UAE
      301,
      // Qatar
      305,
      // South Africa
      288,
      // Egypt
      233,
      // Morocco
      200,
      // Algeria
      185,
      // Tunisia
      202,
      // Israel
      383,
      // Iceland
      165,
      // Finland
      244
    ],
    names: {
      2: "Champions League", 3: "Europa League", 848: "Conference League",
      45: "FA Cup", 48: "EFL Cup", 143: "Copa del Rey", 137: "Coppa Italia", 81: "DFB-Pokal", 66: "Coupe de France",
      39: "Premier League", 40: "Championship", 41: "League One", 42: "League Two", 43: "National League", 50: "NL North", 51: "NL South", 667: "PL2",
      140: "La Liga", 141: "La Liga 2", 435: "Primera RFEF G1", 436: "Primera RFEF G2", 663: "Primera Fem",
      135: "Serie A", 136: "Serie B", 269: "Serie C",
      78: "Bundesliga", 79: "2. Bundesliga", 80: "3. Liga",
      61: "Ligue 1", 62: "Ligue 2", 556: "National 1",
      88: "Eredivisie", 89: "Eerste Divisie",
      94: "Primeira Liga", 95: "Liga Portugal 2",
      203: "Super Lig", 204: "1. Lig",
      144: "Pro League", 145: "Challenger Pro League",
      179: "Scottish Prem", 180: "Scottish Champ",
      218: "Austrian BL", 219: "Austrian 2. Liga",
      207: "Swiss Super League", 208: "Challenge League",
      197: "Greek Super League", 198: "Greek Super League 2",
      119: "Danish Superliga", 103: "Eliteserien", 113: "Allsvenskan", 114: "Superettan",
      106: "Ekstraklasa", 107: "I Liga", 345: "Czech First League", 283: "Liga I",
      210: "HNL", 286: "Serbian Super Liga", 172: "Bulgarian First League", 271: "NB I",
      333: "Ukrainian Premier", 235: "Russian Premier",
      253: "MLS", 254: "USL Championship", 262: "Liga MX", 263: "Liga de Expansion",
      71: "Brasileirão", 72: "Serie B Brazil", 128: "Liga Profesional", 129: "Primera B",
      239: "Primera A Colombia", 265: "Primera Chile", 274: "Primera Uruguay", 250: "Division Paraguay", 242: "Serie A Ecuador",
      98: "J1 League", 99: "J2 League", 292: "K League 1", 188: "A-League", 17: "Chinese Super League",
      307: "Saudi Pro League", 301: "UAE Pro League", 305: "Qatar Stars League",
      288: "South African Premier", 233: "Egyptian Premier", 200: "Botola Pro", 185: "Algerian Ligue 1", 202: "Tunisian Ligue 1",
      383: "Ligat ha'Al", 165: "Icelandic Úrvalsdeild", 244: "Veikkausliiga"
    }
  };

  const { data, isLoading, error, refetch } = useQuery<AdminHealthResponse>({
    queryKey: ["admin-health"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");

      const response = await supabase.functions.invoke("admin-health", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) throw response.error;
      return response.data;
    },
    enabled: isAdmin === true,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const handleTurboBackfill = async () => {
    setIsTurboRunning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("No session");
        return;
      }

      toast.info("Starting Turbo Backfill... This may take several minutes.");

      const response = await supabase.functions.invoke("stats-turbo-backfill", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: {
          maxAPICallsTotal: 25000,
          targetCoveragePct: 90,
          skipBudgetCheck: true, // Force run - we know our real usage is safe
        },
      });

      if (response.error) {
        toast.error(`Turbo Backfill failed: ${response.error.message}`);
        return;
      }

      const result = response.data;
      
      if (result.success === false) {
        toast.error(result.message || "Turbo Backfill was skipped");
        return;
      }

      // Handle background job started response
      if (result.status === "started") {
        const beforeCoverage = result.before_metrics?.coverage_pct_gte3 ?? result.before?.coverage_pct_gte3;
        toast.success(
          `Turbo Backfill started! Current coverage: ${beforeCoverage?.toFixed?.(1) ?? beforeCoverage ?? 'N/A'}%. Budget: ${result.allowed_budget || 0} API calls. Check logs for progress.`,
          { duration: 8000 }
        );
      } else {
        // Handle complete response (if function completes synchronously)
        toast.success(
          `Turbo Backfill complete! Coverage: ${result.after_metrics?.coverage_pct_gte3?.toFixed(1) || result.after?.coverage_pct_gte3?.toFixed(1) || 'N/A'}% (was ${result.before_metrics?.coverage_pct_gte3?.toFixed(1) || result.before?.coverage_pct_gte3?.toFixed(1) || 'N/A'}%). API calls: ${result.api_calls_used || result.apiCallsUsed || 0}`
        );
      }
      
      // Refresh the dashboard data
      refetch();
    } catch (err: any) {
      toast.error(`Turbo Backfill error: ${err.message}`);
    } finally {
      setIsTurboRunning(false);
    }
  };

  const handleTopLeaguesTurboBackfill = async () => {
    setIsTopLeaguesTurboRunning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("No session");
        return;
      }

      toast.info(`Starting All Leagues Turbo Backfill (${ALL_TURBO_LEAGUES.ids.length} leagues)`, { duration: 5000 });

      const response = await supabase.functions.invoke("stats-turbo-backfill", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: {
          maxAPICallsTotal: 20000,
          targetCoveragePct: 95,
          upcomingDays: 10,
          daysLookback: 90,
          priorityLeagues: ALL_TURBO_LEAGUES.ids,
          skipBudgetCheck: true,
          runType: "stats-turbo-backfill-top-leagues",
        },
      });

      if (response.error) {
        toast.error(`All Leagues Turbo failed: ${response.error.message}`);
        return;
      }

      const result = response.data;
      
      if (result.success === false) {
        toast.error(result.message || "All Leagues Turbo was skipped");
        return;
      }

      // Handle background job started response
      if (result.status === "started") {
        const beforeCoverage = result.before_metrics?.coverage_pct_gte3 ?? result.before?.coverage_pct_gte3;
        toast.success(
          `All Leagues Turbo started! Coverage: ${beforeCoverage?.toFixed?.(1) ?? beforeCoverage ?? 'N/A'}%. Budget: ${result.allowed_budget || 0} API calls.`,
          { duration: 10000 }
        );
      } else {
        toast.success(
          `All Leagues Turbo complete! Coverage: ${result.after_metrics?.coverage_pct_gte3?.toFixed(1) || 'N/A'}% (was ${result.before_metrics?.coverage_pct_gte3?.toFixed(1) || 'N/A'}%). API calls: ${result.api_calls_used || 0}`,
          { duration: 8000 }
        );
      }
      
      refetch();
    } catch (err: any) {
      toast.error(`All Leagues Turbo error: ${err.message}`);
    } finally {
      setIsTopLeaguesTurboRunning(false);
    }
  };

  if (isAdmin === null || isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3 mb-8">
          <Activity className="w-8 h-8 text-primary" />
          <h1 className="text-3xl font-bold">System Health Dashboard</h1>
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-12 w-full mb-2" />
                <Skeleton className="h-3 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <XCircle className="w-5 h-5" />
              <p>Unable to load health data: {error.message}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const getFixtureCoverageColor = (pct: number) => {
    if (pct >= 97) return "text-green-500";
    if (pct >= 90) return "text-yellow-500";
    return "text-red-500";
  };

  const getFixtureCoverageBg = (pct: number) => {
    if (pct >= 97) return "bg-green-500/10 border-green-500/20";
    if (pct >= 90) return "bg-yellow-500/10 border-yellow-500/20";
    return "bg-red-500/10 border-red-500/20";
  };

  const getTeamsCoverageColor = (pct: number) => {
    if (pct >= 80) return "text-green-500";
    if (pct >= 60) return "text-yellow-500";
    return "text-red-500";
  };

  const getTeamsCoverageBg = (pct: number) => {
    if (pct >= 80) return "bg-green-500/10 border-green-500/20";
    if (pct >= 60) return "bg-yellow-500/10 border-yellow-500/20";
    return "bg-red-500/10 border-red-500/20";
  };

  const getSelectionCoverageColor = (pct: number) => {
    if (pct >= 70) return "text-green-500";
    if (pct >= 40) return "text-yellow-500";
    return "text-red-500";
  };

  const getSelectionCoverageBg = (pct: number) => {
    if (pct >= 70) return "bg-green-500/10 border-green-500/20";
    if (pct >= 40) return "bg-yellow-500/10 border-yellow-500/20";
    return "bg-red-500/10 border-red-500/20";
  };

  const getLast5StatsCoverageColor = (pct: number) => {
    if (pct >= 80) return "text-green-500";
    if (pct >= 60) return "text-yellow-500";
    return "text-red-500";
  };

  const getLast5StatsCoverageBg = (pct: number) => {
    if (pct >= 80) return "bg-green-500/10 border-green-500/20";
    if (pct >= 60) return "bg-yellow-500/10 border-yellow-500/20";
    return "bg-red-500/10 border-red-500/20";
  };

  const getStatsRefreshStatus = () => {
    if (!data.lastStatsRefresh.started_at) return { variant: "secondary" as const, text: "No data" };
    if ((data.lastStatsRefresh.failed || 0) > 0) return { variant: "destructive" as const, text: "Failed" };
    if ((data.lastStatsRefresh.upserted || 0) === 0) return { variant: "secondary" as const, text: "No changes" };
    return { variant: "default" as const, text: "OK" };
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Activity className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">System Health Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Last updated: {formatDistanceToNow(new Date(data.timestamp), { addSuffix: true })}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={handleTopLeaguesTurboBackfill} 
            disabled={isTopLeaguesTurboRunning || isTurboRunning}
            variant="default"
            className="gap-2"
            title={`All ${ALL_TURBO_LEAGUES.ids.length} supported leagues`}
          >
            <Rocket className="w-4 h-4" />
            {isTopLeaguesTurboRunning ? "Running..." : "All Leagues Turbo"}
          </Button>
          <Button 
            onClick={handleTurboBackfill} 
            disabled={isTurboRunning || isTopLeaguesTurboRunning}
            variant="outline"
            className="gap-2"
          >
            <Rocket className="w-4 h-4" />
            {isTurboRunning ? "Running..." : "All Leagues Turbo"}
          </Button>
        </div>
      </div>

      {/* Tabs for different sections */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">
            <Activity className="w-4 h-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="stats-health">
            <ShieldAlert className="w-4 h-4 mr-2" />
            Stats Health
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stats-health">
          <StatsHealthDashboard />
        </TabsContent>

        <TabsContent value="overview" className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <Card className={getFixtureCoverageBg(data.fixturesCoverage.coverage_pct)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Fixture Results Coverage</CardTitle>
            <Database className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${getFixtureCoverageColor(data.fixturesCoverage.coverage_pct)}`}>
              {data.fixturesCoverage.coverage_pct.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.fixturesCoverage.with_results.toLocaleString()} / {data.fixturesCoverage.total_finished.toLocaleString()} fixtures
            </p>
            <p className="text-xs text-destructive mt-1">
              {data.fixturesCoverage.missing.toLocaleString()} missing
            </p>
          </CardContent>
        </Card>

        <Card className={getLast5StatsCoverageBg(data.fixturesWithLast5Stats.complete_stats_pct)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Complete Last-5 Stats (48h)</CardTitle>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${getLast5StatsCoverageColor(data.fixturesWithLast5Stats.complete_stats_pct)}`}>
              {data.fixturesWithLast5Stats.complete_stats_pct.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.fixturesWithLast5Stats.fixtures_with_complete_stats} / {data.fixturesWithLast5Stats.total_fixtures} fixtures
            </p>
            <p className="text-xs text-muted-foreground">
              Both teams have 5+ games
            </p>
          </CardContent>
        </Card>

        <Card className={getTeamsCoverageBg(data.statsUpcomingTeams.usable_pct)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Usable Teams (Next 120h)</CardTitle>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${getTeamsCoverageColor(data.statsUpcomingTeams.usable_pct)}`}>
              {data.statsUpcomingTeams.usable_pct.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.statsUpcomingTeams.usable_teams} / {data.statsUpcomingTeams.total_teams} teams
            </p>
            <p className="text-xs text-muted-foreground">
              {data.statsUpcomingTeams.fresh_stats_24h} fresh (24h)
            </p>
          </CardContent>
        </Card>

        <Card className={getSelectionCoverageBg(data.selectionsCoverage.selection_coverage_pct_48h)}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Selection Coverage (Next 48h)</CardTitle>
            <Zap className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${getSelectionCoverageColor(data.selectionsCoverage.selection_coverage_pct_48h)}`}>
              {data.selectionsCoverage.selection_coverage_pct_48h.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.selectionsCoverage.fixtures_with_selections_48h} / {data.selectionsCoverage.upcoming_fixtures_48h} fixtures
            </p>
            <p className="text-xs text-destructive mt-1">
              {data.selectionsCoverage.fixtures_without_selections_48h} without selections
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Last Stats Refresh</CardTitle>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {data.lastStatsRefresh.started_at ? (
              <>
                <div className="text-2xl font-bold">
                  {((data.lastStatsRefresh.duration_ms || 0) / 1000).toFixed(1)}s
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {data.lastStatsRefresh.upserted || 0} upserted
                </p>
                <div className="mt-2">
                  <Badge variant={getStatsRefreshStatus().variant}>
                    {getStatsRefreshStatus().text}
                  </Badge>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No recent stats refresh</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Data Coverage & Samples */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Fixtures & Results Detail</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                <span className="text-sm font-medium">Total Finished Fixtures</span>
                <span className="text-lg font-bold">{data.fixturesDetail.total_finished.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                <span className="text-sm font-medium">With Results</span>
                <span className="text-lg font-bold text-green-500">{data.fixturesDetail.with_results.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                <span className="text-sm font-medium">Missing Results</span>
                <span className="text-lg font-bold text-red-500">{data.fixturesDetail.missing.toLocaleString()}</span>
              </div>
              <div className="mt-4">
                <div className="w-full bg-secondary rounded-full h-3">
                  <div
                    className={`h-3 rounded-full transition-all ${
                      data.fixturesCoverage.coverage_pct >= 97 ? "bg-green-500" :
                      data.fixturesCoverage.coverage_pct >= 90 ? "bg-yellow-500" : "bg-red-500"
                    }`}
                    style={{ width: `${Math.min(data.fixturesCoverage.coverage_pct, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sample Teams (Last 5 Stats)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.sampleTeams.length > 0 ? (
                data.sampleTeams.map((team) => (
                  <div key={team.team_id} className="p-3 bg-secondary/50 rounded-lg space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold">Team {team.team_id}</span>
                      <Badge variant="outline">{team.sample_size} matches</Badge>
                    </div>
                    <div className="grid grid-cols-5 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">Goals</div>
                        <div className="font-bold">{team.goals.toFixed(1)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Corners</div>
                        <div className="font-bold">{team.corners.toFixed(1)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Cards</div>
                        <div className="font-bold">{team.cards.toFixed(1)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Fouls</div>
                        <div className="font-bold">{team.fouls.toFixed(1)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Offs</div>
                        <div className="font-bold">{team.offsides.toFixed(1)}</div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Updated {formatDistanceToNow(new Date(team.computed_at), { addSuffix: true })}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No sample teams available</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Jobs & Runs */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cron Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.cronJobs.length > 0 ? (
                data.cronJobs.map((job, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      {job.active ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-500" />
                      )}
                      <div>
                        <div className="text-sm font-medium">{job.jobname}</div>
                        <div className="text-xs text-muted-foreground font-mono">{job.schedule}</div>
                      </div>
                    </div>
                    <Badge variant={job.active ? "default" : "destructive"}>
                      {job.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No cron jobs configured</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Runs (Last 10)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {data.recentRuns.map((run, idx) => (
                <div key={idx} className="p-3 bg-secondary/50 rounded-lg space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{run.run_type}</span>
                    <Badge variant={
                      run.status === 'error' ? 'destructive' : 
                      run.status === 'warning' ? 'secondary' : 
                      'default'
                    }>
                      {run.status === 'error' && `${run.failed} failed`}
                      {run.status === 'warning' && `${run.skipped} skipped`}
                      {run.status === 'success' && 'Success'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>
                      <span className="font-medium">Duration:</span> {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : "N/A"}
                    </div>
                    <div>
                      <span className="font-medium">Scanned:</span> {run.scanned || 0}
                    </div>
                    <div>
                      <span className="font-medium">Upserted:</span> {run.upserted || 0}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(run.started_at), { addSuffix: true })}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminHealth;
