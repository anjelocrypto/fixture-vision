import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Clock, Users, TrendingUp } from "lucide-react";
import { Market } from "@/hooks/useMarkets";
import { formatDistanceToNow } from "date-fns";

interface MarketCardProps {
  market: Market;
  onBet: (market: Market) => void;
}

export function MarketCard({ market, onBet }: MarketCardProps) {
  const totalStaked = market.total_staked_yes + market.total_staked_no;
  const yesPercent = totalStaked > 0 ? (market.total_staked_yes / totalStaked) * 100 : 50;
  
  const closesIn = formatDistanceToNow(new Date(market.closes_at), { addSuffix: true });
  
  const categoryColors: Record<string, string> = {
    football: "bg-green-500/20 text-green-600",
    basketball: "bg-orange-500/20 text-orange-600",
    entertainment: "bg-purple-500/20 text-purple-600",
    politics: "bg-blue-500/20 text-blue-600",
    crypto: "bg-yellow-500/20 text-yellow-600",
  };

  return (
    <Card className="overflow-hidden hover:border-primary/50 transition-colors">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2">
              <Badge 
                variant="outline" 
                className={categoryColors[market.category] || "bg-muted"}
              >
                {market.category}
              </Badge>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {closesIn}
              </span>
            </div>
            <h3 className="font-medium text-sm leading-tight">{market.title}</h3>
            {market.description && (
              <p className="text-xs text-muted-foreground line-clamp-1">
                {market.description}
              </p>
            )}
          </div>
        </div>

        {/* Pool Progress */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="text-green-600">YES {yesPercent.toFixed(0)}%</span>
            <span className="text-red-600">NO {(100 - yesPercent).toFixed(0)}%</span>
          </div>
          <Progress value={yesPercent} className="h-2" />
          <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <Users className="h-3 w-3" />
            <span>Pool: {totalStaked.toLocaleString()} coins</span>
          </div>
        </div>

        {/* Odds & Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 border-green-500/50 text-green-600 hover:bg-green-500/10 hover:text-green-600"
            onClick={() => onBet(market)}
          >
            <TrendingUp className="h-3 w-3 mr-1" />
            YES @ {market.odds_yes.toFixed(2)}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 border-red-500/50 text-red-600 hover:bg-red-500/10 hover:text-red-600"
            onClick={() => onBet(market)}
          >
            <TrendingUp className="h-3 w-3 mr-1 rotate-180" />
            NO @ {market.odds_no.toFixed(2)}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
