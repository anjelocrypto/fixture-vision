import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Check, X, TrendingUp } from "lucide-react";
import { DemoSelection } from "@/config/demoSelections";

interface DemoFilterizerResultsProps {
  selections: DemoSelection[];
  onSignUpClick: () => void;
}

export function DemoFilterizerResults({ selections, onSignUpClick }: DemoFilterizerResultsProps) {
  if (selections.length === 0) {
    return (
      <Card className="p-6 text-center">
        <p className="text-muted-foreground">
          No selections match your filters. Try adjusting the criteria.
        </p>
      </Card>
    );
  }

  const hitCount = selections.filter(s => s.result.hit).length;
  const hitRate = Math.round((hitCount / selections.length) * 100);

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <Card className="p-4 bg-primary/5 border-primary/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <span className="font-medium">Historical Results</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span>
              <span className="font-semibold text-green-500">{hitCount}</span> / {selections.length} hit
            </span>
            <Badge variant={hitRate >= 60 ? "default" : "secondary"}>
              {hitRate}% hit rate
            </Badge>
          </div>
        </div>
      </Card>

      {/* Selections List */}
      <div className="space-y-2">
        {selections.map((selection, idx) => (
          <Card 
            key={`${selection.fixtureId}-${selection.market}-${selection.side}-${selection.line}-${idx}`}
            className={`p-4 transition-all ${
              selection.result.hit 
                ? 'border-green-500/30 bg-green-500/5' 
                : 'border-red-500/30 bg-red-500/5'
            }`}
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
                  <div className="text-xs text-muted-foreground">Actual</div>
                  <div className="font-bold text-lg">{selection.result.actual}</div>
                </div>
                <div className={`flex items-center justify-center w-10 h-10 rounded-full ${
                  selection.result.hit 
                    ? 'bg-green-500/20 text-green-500' 
                    : 'bg-red-500/20 text-red-500'
                }`}>
                  {selection.result.hit ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <X className="h-5 w-5" />
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* CTA */}
      <Card className="p-4 border-dashed border-primary/40 bg-primary/5 text-center">
        <p className="text-sm text-muted-foreground mb-2">
          These are historical results. Want to filter live picks for today's matches?
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
