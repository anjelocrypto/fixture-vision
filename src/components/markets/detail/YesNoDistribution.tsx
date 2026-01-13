import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { TrendingUp, TrendingDown } from "lucide-react";
import { MarketAggregates } from "@/hooks/useMarketDetail";

interface YesNoDistributionProps {
  aggregates: MarketAggregates | null | undefined;
}

export function YesNoDistribution({ aggregates }: YesNoDistributionProps) {
  const [showByStake, setShowByStake] = useState(true);

  const yesValue = showByStake
    ? aggregates?.yes_stake ?? 0
    : aggregates?.yes_votes ?? 0;
  const noValue = showByStake
    ? aggregates?.no_stake ?? 0
    : aggregates?.no_votes ?? 0;
  const total = yesValue + noValue;

  const yesPercent = total > 0 ? (yesValue / total) * 100 : 50;
  const noPercent = total > 0 ? (noValue / total) * 100 : 50;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Distribution</CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="stake-toggle" className="text-xs text-muted-foreground">
              Votes
            </Label>
            <Switch
              id="stake-toggle"
              checked={showByStake}
              onCheckedChange={setShowByStake}
            />
            <Label htmlFor="stake-toggle" className="text-xs text-muted-foreground">
              Stake
            </Label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* YES Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <span className="font-medium text-green-600">YES</span>
            </div>
            <div className="text-sm">
              <span className="font-bold">{yesValue.toLocaleString()}</span>
              <span className="text-muted-foreground ml-1">
                ({yesPercent.toFixed(1)}%)
              </span>
            </div>
          </div>
          <Progress value={yesPercent} className="h-3 [&>div]:bg-green-500" />
        </div>

        {/* NO Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-600" />
              <span className="font-medium text-red-600">NO</span>
            </div>
            <div className="text-sm">
              <span className="font-bold">{noValue.toLocaleString()}</span>
              <span className="text-muted-foreground ml-1">
                ({noPercent.toFixed(1)}%)
              </span>
            </div>
          </div>
          <Progress value={noPercent} className="h-3 [&>div]:bg-red-500" />
        </div>

        {/* Summary */}
        <div className="pt-2 border-t text-center text-xs text-muted-foreground">
          {showByStake ? "Showing by stake amount" : "Showing by vote count"}
        </div>
      </CardContent>
    </Card>
  );
}
