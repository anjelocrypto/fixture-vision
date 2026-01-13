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
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-3 pt-5 px-5">
          <CardTitle className="text-lg flex items-center gap-2 font-semibold">
            <Coins className="h-5 w-5 text-primary" />
            Your Position
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <div className="text-center py-6 text-muted-foreground text-sm">
            <AlertCircle className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>You have no positions on this market</p>
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

  const statusStyles: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    pending: { 
      bg: "bg-amber-500/15", 
      text: "text-amber-400",
      icon: <Clock className="h-3 w-3" />
    },
    won: { 
      bg: "bg-emerald-500/15", 
      text: "text-emerald-400",
      icon: <CheckCircle className="h-3 w-3" />
    },
    lost: { 
      bg: "bg-red-500/15", 
      text: "text-red-400",
      icon: <XCircle className="h-3 w-3" />
    },
    refunded: { 
      bg: "bg-muted", 
      text: "text-muted-foreground",
      icon: <Coins className="h-3 w-3" />
    },
  };

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="text-lg flex items-center gap-2 font-semibold">
          <Coins className="h-5 w-5 text-primary" />
          Your Position
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/40 rounded-xl p-3.5 border border-border/30">
            <div className="text-xs text-muted-foreground mb-1 font-medium">Total Staked</div>
            <div className="text-xl font-bold text-foreground">{totalStaked.toLocaleString()}</div>
          </div>
          <div className="bg-muted/40 rounded-xl p-3.5 border border-border/30">
            <div className="text-xs text-muted-foreground mb-1 font-medium">
              {market.status === "resolved" ? "Settled Payout" : "Potential Payout"}
            </div>
            <div className="text-xl font-bold text-emerald-400">
              {market.status === "resolved"
                ? totalSettledPayout.toLocaleString()
                : totalPotentialPayout.toLocaleString()}
            </div>
          </div>
        </div>

        {/* YES/NO Split */}
        <div className="space-y-2">
          {yesStaked > 0 && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-400" />
                <span className="font-semibold text-emerald-400">YES</span>
              </div>
              <div className="text-right text-sm">
                <div className="font-medium text-foreground">{yesStaked.toLocaleString()} coins</div>
                <div className="text-xs text-muted-foreground">
                  Avg @ {avgYesOdds.toFixed(2)}
                </div>
              </div>
            </div>
          )}
          {noStaked > 0 && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-400" />
                <span className="font-semibold text-red-400">NO</span>
              </div>
              <div className="text-right text-sm">
                <div className="font-medium text-foreground">{noStaked.toLocaleString()} coins</div>
                <div className="text-xs text-muted-foreground">
                  Avg @ {avgNoOdds.toFixed(2)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Individual Positions */}
        <div className="space-y-2 pt-2">
          <div className="text-xs text-muted-foreground font-medium">
            Individual Bets ({positions.length})
          </div>
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {positions.map((pos) => {
              const style = statusStyles[pos.status] || statusStyles.pending;
              return (
                <div
                  key={pos.id}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-border/40 bg-muted/20 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={`px-2 py-0.5 text-xs font-medium ${
                        pos.outcome === "yes"
                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                          : "bg-red-500/15 text-red-400 border-red-500/30"
                      }`}
                    >
                      {pos.outcome.toUpperCase()}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      @ {pos.odds_at_placement.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{pos.stake.toLocaleString()}</span>
                    <Badge className={`${style.bg} ${style.text} border-0 gap-1`}>
                      {style.icon}
                      <span>
                        {pos.status === "won"
                          ? `→ ${pos.payout_amount}`
                          : pos.status === "pending"
                          ? `→ ${pos.potential_payout}`
                          : pos.status}
                      </span>
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
