import { useState, useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Shield, TrendingUp, Clock, AlertTriangle, Info, X,
  CheckCircle2, BarChart3, Loader2, Eye,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface DailyInsightsPanelProps {
  onClose: () => void;
}

interface Insight {
  id: string;
  fixture_id: number;
  league_id: number;
  league_name: string;
  home_team: string;
  away_team: string;
  market: string;
  side: string;
  line: number;
  confidence_tier: string;
  daily_safety_score: number;
  historical_hit_rate: number;
  sample_size: number;
  supporting_reason: string;
  freshness_status: string;
  warning_flags: string[];
  odds: number | null;
  kickoff_at: string;
  computed_at: string;
  generation_metadata: any;
}

const CONFIDENCE_CONFIG: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  very_high: { label: "Very High", color: "text-emerald-400", icon: Shield },
  high: { label: "High", color: "text-green-400", icon: Shield },
  moderate: { label: "Moderate", color: "text-yellow-400", icon: AlertTriangle },
};

const MARKET_LABELS: Record<string, string> = {
  goals: "Goals",
  corners: "Corners",
  cards: "Cards",
};

export function DailyInsightsPanel({ onClose }: DailyInsightsPanelProps) {
  const isMobile = useIsMobile();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchInsights();
  }, []);

  const fetchInsights = async () => {
    setLoading(true);
    setError(null);
    try {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const { data, error: dbError } = await supabase
        .from("daily_safest_insights")
        .select("*")
        .gte("computed_at", todayStart.toISOString())
        .order("daily_safety_score", { ascending: false })
        .limit(2);

      if (dbError) throw dbError;
      setInsights((data as any[]) || []);
    } catch (err: any) {
      console.error("[DailyInsights] Error:", err);
      setError("Unable to load today's insights");
    } finally {
      setLoading(false);
    }
  };

  const generatedAt = insights[0]?.computed_at;

  return (
    <div className={cn(
      "flex flex-col bg-card border border-border rounded-lg overflow-hidden",
      isMobile ? "mx-2 my-2" : "h-full"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-card/50">
        <div className="flex items-center gap-2">
          <Eye className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-foreground">Daily Safest Insights</h3>
          <Badge variant="outline" className="text-xs border-primary/30 text-primary">
            {insights.length}/2
          </Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Confidence explainer */}
      <div className="px-4 py-2 border-b border-border bg-muted/30">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-help">
                <Info className="h-3.5 w-3.5" />
                <span>How confidence is calculated</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-xs">
                Each insight is scored using a composite formula: historical hit rate (30%), 
                sample size (20%), league reliability (15%), market stability (10%), 
                recent team form (10%), data freshness (10%), and ROI (5%). 
                Penalties are applied for stale data, suspicious pricing, or low team samples.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mb-3" />
            <p className="text-sm">Analyzing today's data…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <AlertTriangle className="h-8 w-8 mb-3 text-yellow-400" />
            <p className="text-sm">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={fetchInsights}>
              Retry
            </Button>
          </div>
        ) : insights.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Shield className="h-8 w-8 mb-3" />
            <p className="text-sm font-medium">No Insights Available Today</p>
            <p className="text-xs mt-1 text-center max-w-[250px]">
              No fixtures met our strict quality, freshness, and historical performance thresholds today.
            </p>
          </div>
        ) : (
          <>
            {insights.map((insight, index) => (
              <InsightCard
                key={insight.id}
                insight={insight}
                rank={index + 1}
                expanded={expandedId === insight.id}
                onToggle={() => setExpandedId(expandedId === insight.id ? null : insight.id)}
              />
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      {generatedAt && (
        <div className="px-4 py-2 border-t border-border bg-muted/20 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Generated {format(new Date(generatedAt), "MMM d, HH:mm")} UTC</span>
          </div>
          <Badge variant="outline" className="text-[10px]">Analytics Only</Badge>
        </div>
      )}
    </div>
  );
}

// ── Individual Insight Card ─────────────────────────────────────────────────

function InsightCard({
  insight,
  rank,
  expanded,
  onToggle,
}: {
  insight: Insight;
  rank: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const conf = CONFIDENCE_CONFIG[insight.confidence_tier] || CONFIDENCE_CONFIG.moderate;
  const ConfIcon = conf.icon;
  const marketLabel = MARKET_LABELS[insight.market] || insight.market;
  const sideLabel = insight.side === "over" ? "Over" : "Under";

  return (
    <Card
      className={cn(
        "border border-border/60 bg-card/80 transition-all cursor-pointer hover:border-primary/30",
        expanded && "border-primary/40"
      )}
      onClick={onToggle}
    >
      <div className="p-3 space-y-2.5">
        {/* Top row: rank + fixture + confidence */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
              {rank}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {insight.home_team} vs {insight.away_team}
              </p>
              <p className="text-xs text-muted-foreground">
                {insight.league_name} · {format(new Date(insight.kickoff_at), "HH:mm")}
              </p>
            </div>
          </div>
          <div className={cn("flex items-center gap-1 shrink-0", conf.color)}>
            <ConfIcon className="h-4 w-4" />
            <span className="text-xs font-medium">{conf.label}</span>
          </div>
        </div>

        {/* Market + Stats row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-xs">
            {marketLabel} {sideLabel} {insight.line}
          </Badge>
          <FreshnessBadge status={insight.freshness_status} />
          {insight.warning_flags.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-400/30">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {insight.warning_flags.length}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <ul className="text-xs space-y-0.5">
                    {insight.warning_flags.map((w, i) => (
                      <li key={i}>• {w.replace(/_/g, " ")}</li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-3 gap-2">
          <MetricPill
            icon={TrendingUp}
            label="Hit Rate"
            value={`${(insight.historical_hit_rate * 100).toFixed(1)}%`}
          />
          <MetricPill
            icon={BarChart3}
            label="Sample"
            value={String(insight.sample_size)}
          />
          <MetricPill
            icon={Shield}
            label="Score"
            value={insight.daily_safety_score.toFixed(2)}
          />
        </div>

        {/* Expanded: supporting reason */}
        {expanded && (
          <div className="pt-2 border-t border-border/40 space-y-2 animate-in fade-in-50 duration-200">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {insight.supporting_reason}
            </p>
            {insight.odds && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="font-medium">Market price:</span> {insight.odds.toFixed(2)}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function FreshnessBadge({ status }: { status: string }) {
  if (status === "fresh") {
    return (
      <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30">
        <CheckCircle2 className="h-3 w-3 mr-0.5" />
        Fresh
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] text-yellow-400 border-yellow-400/30">
      <Clock className="h-3 w-3 mr-0.5" />
      Partial
    </Badge>
  );
}

function MetricPill({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Shield;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 bg-muted/30 rounded-md py-1.5 px-1">
      <Icon className="h-3 w-3 text-muted-foreground" />
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold text-foreground">{value}</span>
    </div>
  );
}