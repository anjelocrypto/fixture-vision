import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Coins, TrendingUp, TrendingDown, Clock, Trophy, Target } from "lucide-react";
import { Market, useMarkets, useMyCoins, useMyPositions, useLeaderboard } from "@/hooks/useMarkets";
import { MarketCard } from "./MarketCard";
import { PlaceBetDialog } from "./PlaceBetDialog";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function MarketsPanel() {
  const { t } = useTranslation("common");
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [betDialogOpen, setBetDialogOpen] = useState(false);

  const { data: openMarkets, isLoading: marketsLoading } = useMarkets("open");
  const { data: coins, isLoading: coinsLoading } = useMyCoins();
  const { data: positions } = useMyPositions();
  const { data: leaderboard } = useLeaderboard(10);

  const pendingPositions = positions?.filter((p) => p.status === "pending") || [];
  const settledPositions = positions?.filter((p) => p.status !== "pending") || [];

  const handleBet = (market: Market) => {
    setSelectedMarket(market);
    setBetDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Balance Card */}
      <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/20">
                <Coins className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Your Balance</p>
                <p className="text-2xl font-bold text-primary">
                  {coinsLoading ? "..." : coins?.balance.toLocaleString() ?? "0"}
                </p>
              </div>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-green-500" />
                <span>Won: {coins?.total_won.toLocaleString() ?? 0}</span>
              </div>
              <div className="flex items-center gap-1">
                <TrendingDown className="h-3 w-3 text-red-500" />
                <span>Wagered: {coins?.total_wagered.toLocaleString() ?? 0}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="markets" className="w-full">
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="markets" className="text-xs">
            <Target className="h-3 w-3 mr-1" />
            Markets
          </TabsTrigger>
          <TabsTrigger value="positions" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            My Bets
            {pendingPositions.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {pendingPositions.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="leaderboard" className="text-xs">
            <Trophy className="h-3 w-3 mr-1" />
            Top 10
          </TabsTrigger>
        </TabsList>

        {/* Open Markets */}
        <TabsContent value="markets" className="mt-4 space-y-3">
          {marketsLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading markets...</div>
          ) : !openMarkets?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              No open markets right now. Check back soon!
            </div>
          ) : (
            openMarkets.map((market) => (
              <MarketCard
                key={market.id}
                market={market}
                onBet={handleBet}
              />
            ))
          )}
        </TabsContent>

        {/* My Positions */}
        <TabsContent value="positions" className="mt-4 space-y-3">
          {pendingPositions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Pending</h4>
              {pendingPositions.map((pos) => (
                <PositionCard key={pos.id} position={pos} />
              ))}
            </div>
          )}
          {settledPositions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Settled</h4>
              {settledPositions.slice(0, 5).map((pos) => (
                <PositionCard key={pos.id} position={pos} />
              ))}
            </div>
          )}
          {!positions?.length && (
            <div className="text-center py-8 text-muted-foreground">
              You haven't placed any bets yet.
            </div>
          )}
        </TabsContent>

        {/* Leaderboard */}
        <TabsContent value="leaderboard" className="mt-4">
          <LeaderboardPanel entries={leaderboard || []} />
        </TabsContent>
      </Tabs>

      {/* Bet Dialog */}
      <PlaceBetDialog
        market={selectedMarket}
        open={betDialogOpen}
        onOpenChange={setBetDialogOpen}
        userBalance={coins?.balance ?? 0}
      />
    </div>
  );
}

// Position Card Component
function PositionCard({ position }: { position: any }) {
  const statusColors: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-600",
    won: "bg-green-500/20 text-green-600",
    lost: "bg-red-500/20 text-red-600",
    void: "bg-gray-500/20 text-gray-600",
  };

  return (
    <Card className="bg-card/50">
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={position.outcome === "yes" ? "bg-green-500/20 text-green-600" : "bg-red-500/20 text-red-600"}
            >
              {position.outcome.toUpperCase()}
            </Badge>
            <span className="text-sm">@ {position.odds_at_placement.toFixed(2)}</span>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1">
              <Coins className="h-3 w-3" />
              <span className="font-medium">{position.stake}</span>
            </div>
            <Badge className={statusColors[position.status] || ""}>
              {position.status === "won"
                ? `+${position.payout_amount}`
                : position.status === "pending"
                ? `→ ${position.potential_payout}`
                : position.status}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
