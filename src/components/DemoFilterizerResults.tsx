import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Check, TrendingUp } from "lucide-react";
import { DemoSelection } from "@/config/demoSelections";

interface DemoFilterizerResultsProps {
  selections: DemoSelection[];
  onSignUpClick: () => void;
}

export function DemoFilterizerResults({ selections, onSignUpClick }: DemoFilterizerResultsProps) {
  // Only show winning selections
  const winningSelections = selections.filter(s => s.result.hit);

  if (winningSelections.length === 0) {
    return (
      <Card className="p-6 text-center">
        <p className="text-muted-foreground">
          No selections match your filters. Try adjusting the criteria.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <Card className="p-4 bg-green-500/10 border-green-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-500" />
            <span className="font-medium">Winning Picks</span>
          </div>
          <Badge className="bg-green-500">
            {winningSelections.length} picks found
          </Badge>
        </div>
      </Card>

      {/* Selections List */}
      <div className="space-y-2">
        {winningSelections.map((selection, idx) => (
          <Card 
            key={`${selection.fixtureId}-${selection.market}-${selection.side}-${selection.line}-${idx}`}
            className="p-4 border-green-500/30 bg-green-500/5"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">
                    {selection.homeTeam} vs {selection.awayTeam}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {selection.leagueName}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Badge variant="secondary" className="capitalize">
                    {selection.market} {selection.side} {selection.line}
                  </Badge>
                  <span className="text-muted-foreground">
                    @ <span className="font-semibold text-foreground">{selection.odds.toFixed(2)}</span>
                  </span>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Result</div>
                  <div className="font-bold text-lg">{selection.result.actual}</div>
                </div>
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-500/20 text-green-500">
                  <Check className="h-5 w-5" />
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* CTA */}
      <Card className="p-4 border-dashed border-primary/40 bg-primary/5 text-center">
        <p className="text-sm text-muted-foreground mb-2">
          These are verified historical results. Want to filter live picks for today's matches?
        </p>
        <button 
          onClick={onSignUpClick}
          className="text-primary font-medium hover:underline"
        >
          Create account for live Filterizer →
        </button>
      </Card>
    </div>
  );
}
