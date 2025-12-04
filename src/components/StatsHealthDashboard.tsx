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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, XCircle, RefreshCw, Activity, Database, Info, Shield, Calendar } from "lucide-react";
import { format } from "date-fns";

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

interface HealthCheckResult {
  timestamp: string;
  mode: string;
  teams_checked: number;
  upcoming_fixtures: number;
  violations_by_severity: {
    info: number;
    warning: number;
    error: number;
    critical: number;
  };
  violations_by_metric: Record<string, number>;
  status: "HEALTHY" | "DEGRADED" | "CRITICAL";
  auto_healed: number;
  excluded_teams: number;
  acceptance_checks: {
    teams_missing_cache: number;
    teams_with_goals_diff_gt_03: number;
    teams_with_sample_lt_3: number;
    all_passed: boolean;
  };
}

interface HealthSummary {
  total_24h: number;
  critical: number;
  error: number;
  warning: number;
  info: number;
  by_metric: Record<string, number>;
}

export const StatsHealthDashboard = () => {
  const queryClient = useQueryClient();
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [metricFilter, setMetricFilter] = useState<string>("all");
  const [isRunningCheck, setIsRunningCheck] = useState(false);
  const [lastCheckResult, setLastCheckResult] = useState<HealthCheckResult | null>(null);

  // Fetch violations summary
  const { data: summary, isLoading: summaryLoading } = useQuery<HealthSummary>({
    queryKey: ["stats-health-summary"],
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const { data, error } = await supabase
        .from("stats_health_violations")
        .select("severity, metric")
        .gte("created_at", since)
        .is("resolved_at", null);

      if (error) throw error;

      const result: HealthSummary = {
        total_24h: data?.length || 0,
        critical: 0,
        error: 0,
        warning: 0,
        info: 0,
        by_metric: {}
      };

      for (const v of data || []) {
        if (v.severity === 'critical') result.critical++;
        else if (v.severity === 'error') result.error++;
        else if (v.severity === 'warning') result.warning++;
        else result.info++;

        result.by_metric[v.metric] = (result.by_metric[v.metric] || 0) + 1;
      }

      return result;
    },
    refetchInterval: 60000
  });

  // Fetch violations list
  const { data: violations, isLoading: violationsLoading } = useQuery<Violation[]>({
    queryKey: ["stats-health-violations", severityFilter, metricFilter],
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
      return data || [];
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
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { mode: 'upcoming', autoHeal: true }
      });

      if (response.error) throw response.error;
      return response.data as HealthCheckResult;
    },
    onSuccess: (data) => {
      setLastCheckResult(data);
      const statusEmoji = data.status === 'HEALTHY' ? '✅' : data.status === 'DEGRADED' ? '⚠️' : '🚨';
      toast.success(`${statusEmoji} Health check: ${data.status} | Teams: ${data.teams_checked}, Critical: ${data.violations_by_severity.critical}, Auto-healed: ${data.auto_healed}`);
      queryClient.invalidateQueries({ queryKey: ["stats-health-summary"] });
      queryClient.invalidateQueries({ queryKey: ["stats-health-violations"] });
      setIsRunningCheck(false);
    },
    onError: (error) => {
      toast.error(`Health check failed: ${error.message}`);
      setIsRunningCheck(false);
    }
  });

  // Auto-heal team mutation
  const autoHealTeam = useMutation({
    mutationFn: async (teamId: number) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      await supabase.from("stats_cache").delete().eq("team_id", teamId);
      
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
      toast.success(`Auto-healed team ${teamId}. Cache cleared.`);
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

  const getOverallStatus = () => {
    if (!summary) return { status: 'Loading', color: 'text-muted-foreground', icon: Activity };
    
    if (summary.critical > 0) {
      return { status: 'CRITICAL', color: 'text-destructive', icon: XCircle };
    }
    if (summary.error > 0 || summary.warning > 10) {
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
          <Badge variant="outline" className="ml-2">
            <Calendar className="w-3 h-3 mr-1" />
            Upcoming Teams Only
          </Badge>
        </div>
        <Button 
          onClick={() => runHealthCheck.mutate()} 
          disabled={isRunningCheck}
          size="sm"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isRunningCheck ? 'animate-spin' : ''}`} />
          {isRunningCheck ? 'Running...' : 'Run Health Check & Auto-Heal'}
        </Button>
      </div>

      {/* Last Check Results */}
      {lastCheckResult && (
        <Card className="border-2 border-primary/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Last Check Results ({format(new Date(lastCheckResult.timestamp), 'HH:mm:ss')})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Upcoming Fixtures:</span>
                <span className="ml-2 font-bold">{lastCheckResult.upcoming_fixtures}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Teams Checked:</span>
                <span className="ml-2 font-bold">{lastCheckResult.teams_checked}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Auto-healed:</span>
                <span className="ml-2 font-bold text-green-500">{lastCheckResult.auto_healed}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Excluded:</span>
                <span className="ml-2 font-bold text-orange-500">{lastCheckResult.excluded_teams}</span>
              </div>
            </div>
            
            {/* Acceptance Checks */}
            <div className="mt-4 p-3 rounded-lg bg-muted/50">
              <div className="font-semibold mb-2 flex items-center gap-2">
                {lastCheckResult.acceptance_checks.all_passed ? (
                  <><CheckCircle2 className="w-4 h-4 text-green-500" /> Acceptance Checks: PASSED</>
                ) : (
                  <><XCircle className="w-4 h-4 text-destructive" /> Acceptance Checks: FAILED</>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className={lastCheckResult.acceptance_checks.teams_missing_cache === 0 ? 'text-green-500' : 'text-destructive'}>
                  Missing Cache: {lastCheckResult.acceptance_checks.teams_missing_cache}
                </div>
                <div className={lastCheckResult.acceptance_checks.teams_with_goals_diff_gt_03 === 0 ? 'text-green-500' : 'text-destructive'}>
                  Goals Diff &gt; 0.3: {lastCheckResult.acceptance_checks.teams_with_goals_diff_gt_03}
                </div>
                <div className={lastCheckResult.acceptance_checks.teams_with_sample_lt_3 === 0 ? 'text-green-500' : 'text-destructive'}>
                  Sample &lt; 3: {lastCheckResult.acceptance_checks.teams_with_sample_lt_3}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-5">
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
            <CardTitle className="text-sm">Critical</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold text-destructive">
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
            <CardTitle className="text-sm">Violations by Metric</CardTitle>
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
            <SelectItem value="low_sample">Low Sample</SelectItem>
            <SelectItem value="missing_cache">Missing Cache</SelectItem>
            <SelectItem value="missing_results">Missing Results</SelectItem>
            <SelectItem value="no_history">No History</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Violations Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Violations (Upcoming Teams)</CardTitle>
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
                        <Badge variant="outline">{v.metric}</Badge>
                      </TableCell>
                      <TableCell>{v.db_value?.toFixed(2) ?? '-'}</TableCell>
                      <TableCell>{v.cache_value?.toFixed(2) ?? '-'}</TableCell>
                      <TableCell className={v.diff && v.diff > 0.3 ? 'text-destructive font-bold' : ''}>
                        {v.diff?.toFixed(2) ?? '-'}
                      </TableCell>
                      <TableCell>{getSeverityBadge(v.severity)}</TableCell>
                      <TableCell>
                        {v.resolved_at ? (
                          <Badge variant="outline" className="text-green-500">Resolved</Badge>
                        ) : v.notes?.includes('Auto-heal') ? (
                          <Badge variant="secondary">Healing</Badge>
                        ) : (
                          <Badge variant="destructive">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(v.created_at), 'MMM d HH:mm')}
                      </TableCell>
                      <TableCell>
                        {!v.resolved_at && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => autoHealTeam.mutate(v.team_id)}
                            disabled={autoHealTeam.isPending}
                          >
                            <RefreshCw className="w-3 h-3 mr-1" />
                            Heal
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
              <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-500" />
              <p className="text-lg font-medium">All Clear!</p>
              <p className="text-sm">No violations found for upcoming teams.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
