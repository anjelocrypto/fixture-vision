import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
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
    stats: TeamStats;
  };
  away: {
    name: string;
    logo: string;
    stats: TeamStats;
  };
  combined: TeamStats;
  computed_at: string;
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
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">AI Analysis</h3>
              <Badge variant="outline" className="border-primary/30 text-primary">
                BETAI 0.1
              </Badge>
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

          {/* Timestamp */}
          <p className="text-xs text-muted-foreground text-center">
            Last updated: {new Date(analysis.computed_at).toLocaleString()}
          </p>
        </div>
      ) : null}
    </div>
  );
}
