import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, TrendingUp, TrendingDown, Clock, Trophy, Target, CheckCircle, XCircle } from "lucide-react";
import { Market, useMarkets, useMyCoins, useMyPositions, useLeaderboard } from "@/hooks/useMarkets";
import { MarketCard } from "./MarketCard";
import { PlaceBetDialog } from "./PlaceBetDialog";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type MarketStatus = "open" | "closed" | "resolved";

export function MarketsPanel() {
  const { t } = useTranslation("common");
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [betDialogOpen, setBetDialogOpen] = useState(false);
  const [marketStatusFilter, setMarketStatusFilter] = useState<MarketStatus>("open");

  const { data: markets, isLoading: marketsLoading } = useMarkets(marketStatusFilter);
  const { data: coins, isLoading: coinsLoading } = useMyCoins();
  const { data: positions } = useMyPositions();
  const { data: leaderboard } = useLeaderboard(10);

  const pendingPositions = positions?.filter((p) => p.status === "pending") || [];
  const wonPositions = positions?.filter((p) => p.status === "won") || [];
  const lostPositions = positions?.filter((p) => p.status === "lost") || [];
  const voidPositions = positions?.filter((p) => p.status === "void") || [];

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

        {/* Markets Tab */}
        <TabsContent value="markets" className="mt-4 space-y-3">
          {/* Market Status Filter */}
          <div className="flex gap-2 mb-4">
            {(["open", "closed", "resolved"] as MarketStatus[]).map((status) => (
              <Badge
                key={status}
                variant={marketStatusFilter === status ? "default" : "outline"}
                className="cursor-pointer capitalize"
                onClick={() => setMarketStatusFilter(status)}
              >
                {status === "open" && <Target className="h-3 w-3 mr-1" />}
                {status === "closed" && <Clock className="h-3 w-3 mr-1" />}
                {status === "resolved" && <CheckCircle className="h-3 w-3 mr-1" />}
                {status}
              </Badge>
            ))}
          </div>

          {marketsLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading markets...</div>
          ) : !markets?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              No {marketStatusFilter} markets right now.
            </div>
          ) : (
            markets.map((market) => (
              <MarketCard
                key={market.id}
                market={market}
                onBet={handleBet}
                showBetButton={marketStatusFilter === "open"}
              />
            ))
          )}
        </TabsContent>

        {/* My Positions Tab */}
        <TabsContent value="positions" className="mt-4 space-y-4">
          {pendingPositions.length > 0 && (
            <PositionSection title="Pending" icon={<Clock className="h-4 w-4 text-yellow-500" />} positions={pendingPositions} />
          )}
          {wonPositions.length > 0 && (
            <PositionSection title="Won" icon={<CheckCircle className="h-4 w-4 text-green-500" />} positions={wonPositions} />
          )}
          {lostPositions.length > 0 && (
            <PositionSection title="Lost" icon={<XCircle className="h-4 w-4 text-red-500" />} positions={lostPositions} />
          )}
          {voidPositions.length > 0 && (
            <PositionSection title="Refunded" icon={<Coins className="h-4 w-4 text-muted-foreground" />} positions={voidPositions} />
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

// Position Section Component
function PositionSection({ title, icon, positions }: { title: string; icon: React.ReactNode; positions: any[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        <span>{title} ({positions.length})</span>
      </div>
      {positions.map((pos) => (
        <PositionCard key={pos.id} position={pos} />
      ))}
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
