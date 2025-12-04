import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, XCircle, RefreshCw, Activity, Database, Info, Shield } from "lucide-react";
import { format } from "date-fns";

// Top 5 leagues that matter for CRITICAL status
const TOP_LEAGUE_IDS = [39, 140, 135, 78, 61];
// All allowed leagues
const ALLOWED_LEAGUE_IDS = [39, 140, 135, 78, 61, 45, 48, 143, 137, 81, 66, 2, 3, 848, 5, 1, 4, 960, 32, 34, 33, 31, 29, 30, 9, 36, 964];

interface Violation {
  id: number;
  created_at: string;
  team_id: number;
  team_name: string | null;
  league_ids: number[] | null;
  metric: string;
  db_value: number | null;
  cache_value: number | null;
  diff: number | null;
  sample_size: number | null;
  severity: string;
  notes: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

interface HealthSummary {
  total_24h: number;
  critical: number;
  error: number;
  warning: number;
  info: number;
  by_metric: Record<string, number>;
  top_league_goals_critical: number;
}

const isTopLeague = (leagueIds: number[] | null) => {
  if (!leagueIds) return false;
  return leagueIds.some(lid => TOP_LEAGUE_IDS.includes(lid));
};

const isAllowedLeague = (leagueIds: number[] | null) => {
  if (!leagueIds) return false;
  return leagueIds.some(lid => ALLOWED_LEAGUE_IDS.includes(lid));
};

export const StatsHealthDashboard = () => {
  const queryClient = useQueryClient();
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [metricFilter, setMetricFilter] = useState<string>("all");
  const [leagueTierFilter, setLeagueTierFilter] = useState<string>("all");
  const [isRunningCheck, setIsRunningCheck] = useState(false);

  // Fetch violations summary
  const { data: summary, isLoading: summaryLoading } = useQuery<HealthSummary>({
    queryKey: ["stats-health-summary"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const { data, error } = await supabase
        .from("stats_health_violations")
        .select("severity, metric, league_ids")
        .gte("created_at", since)
        .is("resolved_at", null); // Only count unresolved

      if (error) throw error;

      const result: HealthSummary = {
        total_24h: data?.length || 0,
        critical: 0,
        error: 0,
        warning: 0,
        info: 0,
        by_metric: {},
        top_league_goals_critical: 0
      };

      for (const v of data || []) {
        if (v.severity === 'critical') result.critical++;
        else if (v.severity === 'error') result.error++;
        else if (v.severity === 'warning') result.warning++;
        else result.info++;

        result.by_metric[v.metric] = (result.by_metric[v.metric] || 0) + 1;

        // Count top-league goals critical
        if (v.severity === 'critical' && v.metric === 'goals' && isTopLeague(v.league_ids)) {
          result.top_league_goals_critical++;
        }
      }

      return result;
    },
    refetchInterval: 60000
  });

  // Fetch violations list
  const { data: violations, isLoading: violationsLoading } = useQuery<Violation[]>({
    queryKey: ["stats-health-violations", severityFilter, metricFilter, leagueTierFilter],
    queryFn: async () => {
      let query = supabase
        .from("stats_health_violations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (severityFilter !== "all") {
        query = query.eq("severity", severityFilter);
      }
      if (metricFilter !== "all") {
        query = query.eq("metric", metricFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      // Filter by league tier client-side
      let filtered = data || [];
      if (leagueTierFilter === "top") {
        filtered = filtered.filter(v => isTopLeague(v.league_ids));
      } else if (leagueTierFilter === "allowed") {
        filtered = filtered.filter(v => isAllowedLeague(v.league_ids));
      } else if (leagueTierFilter === "other") {
        filtered = filtered.filter(v => !isAllowedLeague(v.league_ids));
      }
      
      return filtered;
    },
    refetchInterval: 60000
  });

  // Run health check mutation
  const runHealthCheck = useMutation({
    mutationFn: async () => {
      setIsRunningCheck(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const response = await supabase.functions.invoke("stats-health-check", {
        headers: { Authorization: `Bearer ${session.access_token}` }
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: (data) => {
      toast.success(`Health check complete: ${data.top_league_goals_critical || 0} top-league critical, ${data.auto_healed || 0} auto-healed`);
      queryClient.invalidateQueries({ queryKey: ["stats-health-summary"] });
      queryClient.invalidateQueries({ queryKey: ["stats-health-violations"] });
      setIsRunningCheck(false);
    },
    onError: (error) => {
      toast.error(`Health check failed: ${error.message}`);
      setIsRunningCheck(false);
    }
  });

  // Auto-heal team mutation (clear cache + mark resolved)
  const autoHealTeam = useMutation({
    mutationFn: async (teamId: number) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      // Delete from stats_cache
      await supabase.from("stats_cache").delete().eq("team_id", teamId);
      
      // Mark violations as resolved
      await supabase
        .from("stats_health_violations")
        .update({ 
          resolved_at: new Date().toISOString(),
          resolved_by: 'manual-heal'
        })
        .eq("team_id", teamId)
        .is("resolved_at", null);

      return teamId;
    },
    onSuccess: (teamId) => {
      toast.success(`Auto-healed team ${teamId}. Cache cleared and violations marked resolved.`);
      queryClient.invalidateQueries({ queryKey: ["stats-health-violations"] });
      queryClient.invalidateQueries({ queryKey: ["stats-health-summary"] });
    },
    onError: (error) => {
      toast.error(`Auto-heal failed: ${error.message}`);
    }
  });

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <Badge variant="destructive">Critical</Badge>;
      case 'error':
        return <Badge variant="destructive" className="bg-orange-500">Error</Badge>;
      case 'warning':
        return <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-600">Warning</Badge>;
      default:
        return <Badge variant="outline">Info</Badge>;
    }
  };

  const getLeagueTierBadge = (leagueIds: number[] | null) => {
    if (isTopLeague(leagueIds)) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="default" className="bg-primary">Top 5</Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Premier League, La Liga, Serie A, Bundesliga, or Ligue 1</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    if (isAllowedLeague(leagueIds)) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="secondary">Tracked</Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Tracked league with full stats support</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="outline" className="text-muted-foreground">Other</Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>Lower division or limited coverage league - safe to ignore</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  // CRITICAL status only if there are unresolved top-league GOALS critical violations
  const getOverallStatus = () => {
    if (!summary) return { status: 'Loading', color: 'text-muted-foreground', icon: Activity };
    
    // Only top-league GOALS critical violations matter for CRITICAL status
    if (summary.top_league_goals_critical > 3) {
      return { status: 'CRITICAL', color: 'text-destructive', icon: XCircle };
    }
    if (summary.top_league_goals_critical > 0 || summary.critical > 50) {
      return { status: 'DEGRADED', color: 'text-yellow-500', icon: AlertTriangle };
    }
    return { status: 'HEALTHY', color: 'text-green-500', icon: CheckCircle2 };
  };

  const overallStatus = getOverallStatus();
  const StatusIcon = overallStatus.icon;

  if (summaryLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Database className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold">Stats Health Monitor</h2>
        </div>
        <Button 
          onClick={() => runHealthCheck.mutate()} 
          disabled={isRunningCheck}
          size="sm"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isRunningCheck ? 'animate-spin' : ''}`} />
          {isRunningCheck ? 'Running...' : 'Run Health Check'}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-6">
        <Card className={`border-2 ${overallStatus.color.replace('text-', 'border-')}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Overall Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`flex items-center gap-2 ${overallStatus.color}`}>
              <StatusIcon className="w-5 h-5" />
              <span className="text-xl font-bold">{overallStatus.status}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-destructive/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1">
              Top League Critical
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="w-3 h-3" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>GOALS critical violations in Top 5 leagues only</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold text-destructive">
              {summary?.top_league_goals_critical || 0}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">All Critical</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold text-destructive/70">
              {summary?.critical || 0}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold text-orange-500">
              {summary?.error || 0}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Warnings</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold text-yellow-500">
              {summary?.warning || 0}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Unresolved (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold">
              {summary?.total_24h || 0}
            </span>
          </CardContent>
        </Card>
      </div>

      {/* By Metric */}
      {summary && Object.keys(summary.by_metric).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Violations by Metric (Unresolved)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(summary.by_metric).map(([metric, count]) => (
                <Badge key={metric} variant="outline" className="text-sm">
                  {metric}: {count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>

        <Select value={metricFilter} onValueChange={setMetricFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Metric" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Metrics</SelectItem>
            <SelectItem value="goals">Goals</SelectItem>
            <SelectItem value="corners">Corners</SelectItem>
            <SelectItem value="cards">Cards</SelectItem>
            <SelectItem value="fouls">Fouls</SelectItem>
            <SelectItem value="offsides">Offsides</SelectItem>
            <SelectItem value="sample_size">Sample Size</SelectItem>
            <SelectItem value="missing_cache">Missing Cache</SelectItem>
            <SelectItem value="missing_results">Missing Results</SelectItem>
          </SelectContent>
        </Select>

        <Select value={leagueTierFilter} onValueChange={setLeagueTierFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="League Tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Leagues</SelectItem>
            <SelectItem value="top">Top 5 Only</SelectItem>
            <SelectItem value="allowed">Tracked Leagues</SelectItem>
            <SelectItem value="other">Other/Lower</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Violations Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Violations</CardTitle>
        </CardHeader>
        <CardContent>
          {violationsLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : violations && violations.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Team</TableHead>
                    <TableHead>League Tier</TableHead>
                    <TableHead>Metric</TableHead>
                    <TableHead>DB Value</TableHead>
                    <TableHead>Cache Value</TableHead>
                    <TableHead>Diff</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {violations.map((v) => (
                    <TableRow key={v.id} className={v.resolved_at ? 'opacity-50' : ''}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{v.team_name || `Team ${v.team_id}`}</div>
                          <div className="text-xs text-muted-foreground">ID: {v.team_id}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {getLeagueTierBadge(v.league_ids)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{v.metric}</Badge>
                      </TableCell>
                      <TableCell>{v.db_value?.toFixed(2) ?? '-'}</TableCell>
                      <TableCell>{v.cache_value?.toFixed(2) ?? '-'}</TableCell>
                      <TableCell className={v.diff && v.diff >= 1.0 ? 'text-destructive font-bold' : ''}>
                        {v.diff?.toFixed(2) ?? '-'}
                      </TableCell>
                      <TableCell>{getSeverityBadge(v.severity)}</TableCell>
                      <TableCell>
                        {v.resolved_at ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <Badge variant="secondary" className="bg-green-500/20 text-green-600">
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  Healed
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Resolved by: {v.resolved_by}</p>
                                <p>At: {format(new Date(v.resolved_at), 'MMM d, HH:mm')}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <Badge variant="outline" className="text-orange-500">
                            Open
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {format(new Date(v.created_at), 'MMM d, HH:mm')}
                      </TableCell>
                      <TableCell>
                        {!v.resolved_at && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => autoHealTeam.mutate(v.team_id)}
                          >
                            <Shield className="w-3 h-3 mr-1" />
                            Auto-Heal
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-2 text-green-500" />
              <p>No violations found with current filters</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
