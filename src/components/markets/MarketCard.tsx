import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Clock, Users, TrendingUp, CheckCircle, XCircle } from "lucide-react";
import { Market } from "@/hooks/useMarkets";
import { formatDistanceToNow, format } from "date-fns";

export interface MarketCardProps {
  market: Market;
  onBet: (market: Market) => void;
  showBetButton?: boolean;
}

export function MarketCard({ market, onBet, showBetButton = true }: MarketCardProps) {
  const totalStaked = market.total_staked_yes + market.total_staked_no;
  const yesPercent = totalStaked > 0 ? (market.total_staked_yes / totalStaked) * 100 : 50;
  
  const isOpen = market.status === "open";
  const closesIn = isOpen 
    ? formatDistanceToNow(new Date(market.closes_at), { addSuffix: true })
    : format(new Date(market.closes_at), "MMM d, HH:mm");
  
  const categoryColors: Record<string, string> = {
    football: "bg-green-500/20 text-green-600",
    basketball: "bg-orange-500/20 text-orange-600",
    entertainment: "bg-purple-500/20 text-purple-600",
    politics: "bg-blue-500/20 text-blue-600",
    crypto: "bg-yellow-500/20 text-yellow-600",
  };

  const statusBadge = () => {
    if (market.status === "resolved" && market.winning_outcome) {
      return (
        <Badge variant="outline" className={market.winning_outcome === "yes" ? "bg-green-500/20 text-green-600" : "bg-red-500/20 text-red-600"}>
          {market.winning_outcome === "yes" ? <CheckCircle className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
          {market.winning_outcome.toUpperCase()} Won
        </Badge>
      );
    }
    if (market.status === "resolved" && !market.winning_outcome) {
      return <Badge variant="outline" className="bg-muted text-muted-foreground">Voided</Badge>;
    }
    if (market.status === "closed") {
      return <Badge variant="outline" className="bg-yellow-500/20 text-yellow-600">Closed</Badge>;
    }
    return null;
  };

  return (
    <Card className="overflow-hidden hover:border-primary/50 transition-colors">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge 
                variant="outline" 
                className={categoryColors[market.category] || "bg-muted"}
              >
                {market.category}
              </Badge>
              {statusBadge()}
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {isOpen ? closesIn : `Closed ${closesIn}`}
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

        {/* Odds & Actions - only show for open markets */}
        {showBetButton && isOpen && (
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
        )}

        {/* Show final odds for closed/resolved markets */}
        {!isOpen && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Final Odds: YES @ {market.odds_yes.toFixed(2)} | NO @ {market.odds_no.toFixed(2)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
