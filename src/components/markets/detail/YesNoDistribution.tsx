import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { TrendingUp, TrendingDown, PieChart } from "lucide-react";
import { MarketAggregates } from "@/hooks/useMarketDetail";

interface YesNoDistributionProps {
  aggregates: MarketAggregates | null | undefined;
}

export function YesNoDistribution({ aggregates }: YesNoDistributionProps) {
  const [showByStake, setShowByStake] = useState(true);

  // By stake (amount) or by votes (count)
  const yesValue = showByStake
    ? aggregates?.yes_stake ?? 0
    : aggregates?.yes_positions ?? 0;
  const noValue = showByStake
    ? aggregates?.no_stake ?? 0
    : aggregates?.no_positions ?? 0;
  const total = yesValue + noValue;

  const yesPercent = total > 0 ? (yesValue / total) * 100 : 50;
  const noPercent = total > 0 ? (noValue / total) * 100 : 50;

  // Labels for display
  const yesLabel = showByStake ? "coins" : "votes";
  const noLabel = showByStake ? "coins" : "votes";

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-3 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <PieChart className="h-4 w-4 text-primary" />
            Distribution
          </CardTitle>
          <div className="flex items-center gap-2 bg-muted/50 rounded-full px-3 py-1.5">
            <Label 
              htmlFor="stake-toggle" 
              className={`text-xs cursor-pointer transition-colors ${!showByStake ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
            >
              Votes
            </Label>
            <Switch
              id="stake-toggle"
              checked={showByStake}
              onCheckedChange={setShowByStake}
              className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/30"
            />
            <Label 
              htmlFor="stake-toggle" 
              className={`text-xs cursor-pointer transition-colors ${showByStake ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
            >
              Stake
            </Label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        {/* YES Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/15">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
              </div>
              <span className="font-semibold text-emerald-500">YES</span>
            </div>
            <div className="text-sm">
              <span className="font-bold text-foreground">{yesValue.toLocaleString()}</span>
              <span className="text-muted-foreground ml-1">{yesLabel}</span>
              <span className="text-muted-foreground ml-1.5">
                ({yesPercent.toFixed(1)}%)
              </span>
            </div>
          </div>
          <div className="h-3.5 bg-muted/60 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${yesPercent}%` }}
            />
          </div>
        </div>

        {/* NO Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-red-500/15">
                <TrendingDown className="h-4 w-4 text-red-500" />
              </div>
              <span className="font-semibold text-red-500">NO</span>
            </div>
            <div className="text-sm">
              <span className="font-bold text-foreground">{noValue.toLocaleString()}</span>
              <span className="text-muted-foreground ml-1">{noLabel}</span>
              <span className="text-muted-foreground ml-1.5">
                ({noPercent.toFixed(1)}%)
              </span>
            </div>
          </div>
          <div className="h-3.5 bg-muted/60 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${noPercent}%` }}
            />
          </div>
        </div>

        {/* Summary */}
        <div className="pt-3 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
          <span>{showByStake ? "Distribution by stake amount" : "Distribution by vote count"}</span>
          <span className="font-medium">
            Total: {total.toLocaleString()} {showByStake ? "coins" : "votes"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
