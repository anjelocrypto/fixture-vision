import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, TrendingUp, TrendingDown, CheckCircle, XCircle, Clock, AlertCircle } from "lucide-react";
import { Position, Market } from "@/hooks/useMarkets";

interface YourPositionProps {
  positions: Position[];
  market: Market;
}

export function YourPosition({ positions, market }: YourPositionProps) {
  if (positions.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Your Position</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-muted-foreground text-sm">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            You have no positions on this market
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate totals
  const yesPositions = positions.filter((p) => p.outcome === "yes");
  const noPositions = positions.filter((p) => p.outcome === "no");

  const totalStaked = positions.reduce((sum, p) => sum + p.stake, 0);
  const yesStaked = yesPositions.reduce((sum, p) => sum + p.stake, 0);
  const noStaked = noPositions.reduce((sum, p) => sum + p.stake, 0);

  const totalPotentialPayout = positions
    .filter((p) => p.status === "pending")
    .reduce((sum, p) => sum + p.potential_payout, 0);

  const totalSettledPayout = positions
    .filter((p) => p.status === "won")
    .reduce((sum, p) => sum + (p.payout_amount || 0), 0);

  const avgYesOdds = yesPositions.length > 0
    ? yesPositions.reduce((sum, p) => sum + p.odds_at_placement * p.net_stake, 0) /
      yesPositions.reduce((sum, p) => sum + p.net_stake, 0)
    : 0;

  const avgNoOdds = noPositions.length > 0
    ? noPositions.reduce((sum, p) => sum + p.odds_at_placement * p.net_stake, 0) /
      noPositions.reduce((sum, p) => sum + p.net_stake, 0)
    : 0;

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-600",
    won: "bg-green-500/20 text-green-600",
    lost: "bg-red-500/20 text-red-600",
    refunded: "bg-muted text-muted-foreground",
  };

  const statusIcons: Record<string, React.ReactNode> = {
    pending: <Clock className="h-3 w-3" />,
    won: <CheckCircle className="h-3 w-3" />,
    lost: <XCircle className="h-3 w-3" />,
    refunded: <Coins className="h-3 w-3" />,
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Coins className="h-5 w-5 text-primary" />
          Your Position
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">Total Staked</div>
            <div className="text-lg font-bold">{totalStaked.toLocaleString()}</div>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">
              {market.status === "resolved" ? "Settled Payout" : "Potential Payout"}
            </div>
            <div className="text-lg font-bold text-green-600">
              {market.status === "resolved"
                ? totalSettledPayout.toLocaleString()
                : totalPotentialPayout.toLocaleString()}
            </div>
          </div>
        </div>

        {/* YES/NO Split */}
        <div className="space-y-2">
          {yesStaked > 0 && (
            <div className="flex items-center justify-between p-2 rounded-lg bg-green-500/10">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-green-600" />
                <span className="font-medium text-green-600">YES</span>
              </div>
              <div className="text-right text-sm">
                <div>{yesStaked.toLocaleString()} coins</div>
                <div className="text-xs text-muted-foreground">
                  Avg @ {avgYesOdds.toFixed(2)}
                </div>
              </div>
            </div>
          )}
          {noStaked > 0 && (
            <div className="flex items-center justify-between p-2 rounded-lg bg-red-500/10">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-600" />
                <span className="font-medium text-red-600">NO</span>
              </div>
              <div className="text-right text-sm">
                <div>{noStaked.toLocaleString()} coins</div>
                <div className="text-xs text-muted-foreground">
                  Avg @ {avgNoOdds.toFixed(2)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Individual Positions */}
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground font-medium">
            Individual Bets ({positions.length})
          </div>
          {positions.map((pos) => (
            <div
              key={pos.id}
              className="flex items-center justify-between p-2 rounded-lg border border-border/50 text-sm"
            >
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    pos.outcome === "yes"
                      ? "bg-green-500/20 text-green-600 border-green-500/30"
                      : "bg-red-500/20 text-red-600 border-red-500/30"
                  }
                >
                  {pos.outcome.toUpperCase()}
                </Badge>
                <span className="text-muted-foreground">
                  @ {pos.odds_at_placement.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span>{pos.stake.toLocaleString()}</span>
                <Badge className={statusColors[pos.status]}>
                  {statusIcons[pos.status]}
                  <span className="ml-1">
                    {pos.status === "won"
                      ? `+${pos.payout_amount}`
                      : pos.status === "pending"
                      ? `→ ${pos.potential_payout}`
                      : pos.status}
                  </span>
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
