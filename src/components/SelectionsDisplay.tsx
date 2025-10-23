import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { TrendingUp, Users, Trophy } from "lucide-react";

interface Selection {
  id: string;
  fixture_id: number;
  league_id: number;
  country_code: string | null;
  utc_kickoff: string;
  market: string;
  side: string;
  line: number;
  bookmaker: string;
  odds: number;
  is_live: boolean;
  edge_pct: number | null;
  model_prob: number | null;
  sample_size: number | null;
  combined_snapshot: {
    goals: number;
    corners: number;
    cards: number;
    fouls: number;
    offsides: number;
  };
}

interface SelectionsDisplayProps {
  selections: Selection[];
  onSelectionClick?: (selection: Selection) => void;
}

export function SelectionsDisplay({ selections, onSelectionClick }: SelectionsDisplayProps) {
  if (!selections || selections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 text-muted-foreground">
          <Trophy className="h-16 w-16 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">No selections found</p>
          <p className="text-sm mt-2">
            Try adjusting your filters or min odds threshold
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {selections.map((selection) => {
        const kickoff = new Date(selection.utc_kickoff);
        const hasEdge = selection.edge_pct !== null && selection.edge_pct > 0;
        
        return (
          <Card
            key={selection.id}
            className="p-4 hover:bg-accent/50 transition-colors cursor-pointer border-l-4"
            style={{
              borderLeftColor: hasEdge && selection.edge_pct > 5 
                ? "hsl(var(--primary))" 
                : "hsl(var(--border))"
            }}
            onClick={() => onSelectionClick?.(selection)}
          >
            <div className="flex items-start justify-between gap-4">
              {/* Left: Market Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="default" className="font-semibold">
                    {selection.market.toUpperCase()}
                  </Badge>
                  <Badge variant="outline">
                    {selection.side} {selection.line}
                  </Badge>
                  {selection.is_live && (
                    <Badge variant="destructive" className="animate-pulse">
                      LIVE
                    </Badge>
                  )}
                </div>
                
                <div className="text-sm text-muted-foreground space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {format(kickoff, "MMM d, HH:mm")}
                    </span>
                    {selection.bookmaker && (
                      <span className="text-xs">• {selection.bookmaker}</span>
                    )}
                  </div>
                  
                  {selection.combined_snapshot && (
                    <div className="text-xs">
                      Combined avg: {selection.combined_snapshot[selection.market as keyof typeof selection.combined_snapshot]?.toFixed(1)}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Stats */}
              <div className="flex flex-col items-end gap-2 min-w-[120px]">
                <div className="text-right">
                  <div className="text-2xl font-bold text-primary tabular-nums">
                    {selection.odds.toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground">odds</div>
                </div>

                {hasEdge && (
                  <div className="flex items-center gap-1 text-xs">
                    <TrendingUp className="h-3 w-3 text-primary" />
                    <span className={`font-medium ${selection.edge_pct > 5 ? 'text-primary' : 'text-muted-foreground'}`}>
                      {selection.edge_pct.toFixed(1)}% edge
                    </span>
                  </div>
                )}

                {selection.sample_size && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    <span>{selection.sample_size} games</span>
                  </div>
                )}
              </div>
            </div>

            {/* Optional: Show model probability */}
            {selection.model_prob !== null && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Model probability</span>
                  <span className="font-medium">{(selection.model_prob * 100).toFixed(1)}%</span>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
