import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";

interface TeamStats {
  goals: number;
  cards: number;
  offsides: number;
  corners: number;
  fouls: number;
}

interface Analysis {
  home: {
    name: string;
    logo: string;
    stats: TeamStats & { sample_size: number };
  };
  away: {
    name: string;
    logo: string;
    stats: TeamStats & { sample_size: number };
  };
  combined: TeamStats;
  is_stale?: boolean;
  computed_at: string;
  odds_available?: boolean;
}

interface RightRailProps {
  analysis: Analysis | null;
  loading: boolean;
}

function StatRow({ label, value }: { label: string; value: number }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const duration = 200;
    const steps = 10;
    const increment = value / steps;
    let current = 0;

    const timer = setInterval(() => {
      current += increment;
      if (current >= value) {
        setDisplayValue(value);
        clearInterval(timer);
      } else {
        setDisplayValue(Math.round(current * 10) / 10);
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [value]);

  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-bold tabular-nums">{displayValue.toFixed(1)}</span>
    </div>
  );
}

export function RightRail({ analysis, loading }: RightRailProps) {
  if (!analysis && !loading) {
    return (
      <div className="w-[380px] border-l border-border bg-card/30 backdrop-blur-sm p-6">
        <Card className="p-6 text-center">
          <p className="text-muted-foreground">
            Select a fixture and click <span className="text-primary font-medium">Analyse</span> to
            view AI predictions
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-[380px] border-l border-border bg-card/30 backdrop-blur-sm p-6 overflow-y-auto">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : analysis ? (
        <div className="space-y-4">
          {/* Header */}
          <Card className="p-4 bg-primary/5 border-primary/20">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">AI Analysis</h3>
              <Badge variant="outline" className="border-primary/30 text-primary">
                BETAI 0.1
              </Badge>
            </div>
            
            {/* Status Chips */}
            <div className="flex flex-wrap gap-2">
              {analysis.is_stale && (
                <div className="flex items-center gap-1 text-xs bg-amber-500/10 text-amber-500 px-2 py-1 rounded-full border border-amber-500/20">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Uncertainty: Low Sample Size</span>
                </div>
              )}
              {analysis.odds_available && (
                <div className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full border border-primary/20">
                  <TrendingUp className="h-3 w-3" />
                  <span>Odds Available</span>
                </div>
              )}
            </div>
          </Card>

          {/* Home Team */}
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-4">
              <img src={analysis.home.logo} alt={analysis.home.name} className="w-8 h-8" />
              <h4 className="font-semibold">{analysis.home.name}</h4>
            </div>
            <div className="space-y-1">
              <StatRow label="Goals" value={analysis.home.stats.goals} />
              <StatRow label="Cards" value={analysis.home.stats.cards} />
              <StatRow label="Offsides" value={analysis.home.stats.offsides} />
              <StatRow label="Corners" value={analysis.home.stats.corners} />
              <StatRow label="Fouls" value={analysis.home.stats.fouls} />
            </div>
          </Card>

          {/* Away Team */}
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-4">
              <img src={analysis.away.logo} alt={analysis.away.name} className="w-8 h-8" />
              <h4 className="font-semibold">{analysis.away.name}</h4>
            </div>
            <div className="space-y-1">
              <StatRow label="Goals" value={analysis.away.stats.goals} />
              <StatRow label="Cards" value={analysis.away.stats.cards} />
              <StatRow label="Offsides" value={analysis.away.stats.offsides} />
              <StatRow label="Corners" value={analysis.away.stats.corners} />
              <StatRow label="Fouls" value={analysis.away.stats.fouls} />
            </div>
          </Card>

          {/* Combined Stats */}
          <Card className="p-4 border-primary/30">
            <h4 className="font-semibold mb-3 text-primary">Combined Stats</h4>
            <div className="space-y-1">
              <StatRow label="Goals" value={analysis.combined.goals} />
              <StatRow label="Cards" value={analysis.combined.cards} />
              <StatRow label="Offsides" value={analysis.combined.offsides} />
              <StatRow label="Corners" value={analysis.combined.corners} />
              <StatRow label="Fouls" value={analysis.combined.fouls} />
            </div>
          </Card>

          {/* Metadata */}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground text-center">
              Last updated: {new Date(analysis.computed_at).toLocaleString()}
            </p>
            {analysis.is_stale && (
              <p className="text-xs text-amber-500 text-center">
                Sample size: {Math.min(analysis.home.stats.sample_size, analysis.away.stats.sample_size)} matches
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
