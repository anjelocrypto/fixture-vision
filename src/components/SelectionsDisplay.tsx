import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { TrendingUp, Users, Trophy, Bug } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useState } from "react";

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
  // Fixture metadata
  home_team?: string;
  away_team?: string;
  home_team_logo?: string;
  away_team_logo?: string;
}

interface SelectionsDisplayProps {
  selections: Selection[];
  onSelectionClick?: (selection: Selection) => void;
}

export function SelectionsDisplay({ selections, onSelectionClick }: SelectionsDisplayProps) {
  const [showDebug, setShowDebug] = useState(false);
  
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
    <div className="space-y-4">
      {/* Debug Toggle */}
      <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
        <Bug className="h-4 w-4 text-muted-foreground" />
        <Label htmlFor="debug-mode" className="text-sm cursor-pointer">
          Debug Mode
        </Label>
        <Switch
          id="debug-mode"
          checked={showDebug}
          onCheckedChange={setShowDebug}
        />
        {showDebug && (
          <span className="text-xs text-muted-foreground ml-2">
            (Showing technical details)
          </span>
        )}
      </div>

      {/* Selections List */}
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
              {/* Left: Fixture & Market Info */}
              <div className="flex-1 min-w-0">
                {/* Team names */}
                {selection.home_team && selection.away_team && (
                  <div className="mb-2">
                    <h3 className="font-semibold text-base leading-tight">
                      {selection.home_team} <span className="text-muted-foreground">vs</span> {selection.away_team}
                    </h3>
                  </div>
                )}
                
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
                    <span>Sample: {selection.sample_size}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Debug Info Panel */}
            {showDebug && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fixture ID:</span>
                    <span className="font-medium">{selection.fixture_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Market/Side/Line:</span>
                    <span className="font-medium">
                      {selection.market}/{selection.side}/{selection.line}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bookmaker:</span>
                    <span className="font-medium">{selection.bookmaker}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Odds:</span>
                    <span className="font-medium">{selection.odds}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Selection ID:</span>
                    <span className="font-medium text-xs truncate max-w-[200px]">
                      {selection.id}
                    </span>
                  </div>
                  {selection.combined_snapshot && (
                    <div className="mt-2 pt-2 border-t border-border/30">
                      <div className="text-muted-foreground mb-1">Combined snapshot:</div>
                      <div className="grid grid-cols-2 gap-1 text-[10px]">
                        <span>Goals: {selection.combined_snapshot.goals.toFixed(2)}</span>
                        <span>Corners: {selection.combined_snapshot.corners.toFixed(2)}</span>
                        <span>Cards: {selection.combined_snapshot.cards.toFixed(2)}</span>
                        <span>Fouls: {selection.combined_snapshot.fouls.toFixed(2)}</span>
                        <span>Offsides: {selection.combined_snapshot.offsides.toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Optional: Show model probability */}
            {!showDebug && selection.model_prob !== null && (
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
    </div>
  );
}
