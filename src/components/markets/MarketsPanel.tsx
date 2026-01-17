import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, TrendingUp, TrendingDown, Clock, Trophy, Target, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { Market, useMyCoins, useMyPositions, useLeaderboard } from "@/hooks/useMarkets";
import { useMarketsFiltered, useMarketLeagues, groupMarketsByLeague, MarketWithMetadata } from "@/hooks/useMarketsFiltered";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { EnhancedMarketCard, LeagueSection } from "./EnhancedMarketCard";
import { MarketsFilterBar, QuickLeagueChips } from "./MarketsFilterBar";
import { PlaceBetDialog } from "./PlaceBetDialog";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { AdminMarketControls } from "./AdminMarketControls";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

type MarketStatus = "open" | "closed" | "resolved";

export function MarketsPanel() {
  const { t } = useTranslation("common");
  
  // Filter state
  const [countryId, setCountryId] = useState<number | null>(null);
  const [leagueId, setLeagueId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"kickoff" | "pool" | "newest">("kickoff");
  const [marketStatusFilter, setMarketStatusFilter] = useState<MarketStatus>("open");

  // Bet dialog state
  const [selectedMarket, setSelectedMarket] = useState<MarketWithMetadata | null>(null);
  const [betDialogOpen, setBetDialogOpen] = useState(false);

  // Data queries
  const { data: isAdmin } = useIsAdmin();
  const { data: markets, isLoading: marketsLoading } = useMarketsFiltered({
    status: marketStatusFilter,
    countryId,
    leagueId,
    search,
    sortBy,
  });
  const { data: leagues } = useMarketLeagues(countryId);
  const { data: coins, isLoading: coinsLoading } = useMyCoins();
  const { data: positions } = useMyPositions();
  const { data: leaderboard } = useLeaderboard(10);

  // Positions categorized
  const pendingPositions = positions?.filter((p) => p.status === "pending") || [];
  const wonPositions = positions?.filter((p) => p.status === "won") || [];
  const lostPositions = positions?.filter((p) => p.status === "lost") || [];
  const refundedPositions = positions?.filter((p) => p.status === "refunded") || [];

  // User's active market IDs
  const userPositionMarketIds = useMemo(() => 
    new Set(positions?.map((p) => p.market_id) || []),
    [positions]
  );

  // Group markets by league when no specific league is selected
  const groupedMarkets = useMemo(() => {
    if (!markets || leagueId) return null;
    return groupMarketsByLeague(markets);
  }, [markets, leagueId]);

  const handleBet = (market: MarketWithMetadata) => {
    setSelectedMarket(market);
    setBetDialogOpen(true);
  };

  const handleReset = () => {
    setCountryId(null);
    setLeagueId(null);
    setSearch("");
    setSortBy("kickoff");
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

      {/* Admin Controls - only visible to admins */}
      {isAdmin && <AdminMarketControls />}

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
        <TabsContent value="markets" className="mt-4 space-y-4">
          {/* Filter Bar */}
          <MarketsFilterBar
            countryId={countryId}
            leagueId={leagueId}
            search={search}
            sortBy={sortBy}
            onCountryChange={setCountryId}
            onLeagueChange={setLeagueId}
            onSearchChange={setSearch}
            onSortChange={setSortBy}
            onReset={handleReset}
          />

          {/* Quick League Chips */}
          {leagues && leagues.length > 0 && !leagueId && (
            <QuickLeagueChips
              leagues={leagues}
              selectedLeagueId={leagueId}
              onSelect={setLeagueId}
            />
          )}

          {/* Market Status Filter */}
          <div className="flex gap-2">
            {(["open", "closed", "resolved"] as MarketStatus[]).map((status) => (
              <Badge
                key={status}
                variant={marketStatusFilter === status ? "default" : "outline"}
                className="cursor-pointer capitalize h-7"
                onClick={() => setMarketStatusFilter(status)}
              >
                {status === "open" && <Target className="h-3 w-3 mr-1" />}
                {status === "closed" && <Clock className="h-3 w-3 mr-1" />}
                {status === "resolved" && <CheckCircle className="h-3 w-3 mr-1" />}
                {status}
              </Badge>
            ))}
          </div>

          {/* Loading State */}
          {marketsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="p-4">
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <Skeleton className="h-5 w-20" />
                      <Skeleton className="h-5 w-16" />
                    </div>
                    <Skeleton className="h-6 w-3/4" />
                    <div className="grid grid-cols-2 gap-2">
                      <Skeleton className="h-16" />
                      <Skeleton className="h-16" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : !markets?.length ? (
            /* Empty State */
            <Card className="p-8 text-center">
              <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
              <h3 className="font-semibold text-lg mb-1">No Markets Found</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {search 
                  ? `No markets matching "${search}"`
                  : leagueId 
                    ? "No open markets for this league right now."
                    : countryId
                      ? "No open markets for this country right now."
                      : `No ${marketStatusFilter} markets available.`
                }
              </p>
              {(countryId || leagueId || search) && (
                <Badge
                  variant="outline"
                  className="cursor-pointer"
                  onClick={handleReset}
                >
                  Clear filters
                </Badge>
              )}
            </Card>
          ) : leagueId || search ? (
            /* Flat List (when league selected or searching) */
            <div className="space-y-3">
              {markets.map((market) => (
                <EnhancedMarketCard
                  key={market.id}
                  market={market}
                  onBet={handleBet}
                  showBetButton={marketStatusFilter === "open"}
                  userHasPosition={userPositionMarketIds.has(market.id)}
                />
              ))}
            </div>
          ) : groupedMarkets && groupedMarkets.length > 0 ? (
            /* Grouped by League */
            <div className="space-y-6">
              {groupedMarkets.map((group) => (
                <LeagueSection
                  key={group.league?.id}
                  league={group.league!}
                  country={group.country}
                  markets={group.markets}
                  onBet={handleBet}
                  userPositionMarketIds={userPositionMarketIds}
                  maxVisible={3}
                />
              ))}
            </div>
          ) : (
            /* Fallback: flat list */
            <div className="space-y-3">
              {markets.map((market) => (
                <EnhancedMarketCard
                  key={market.id}
                  market={market}
                  onBet={handleBet}
                  showBetButton={marketStatusFilter === "open"}
                  userHasPosition={userPositionMarketIds.has(market.id)}
                />
              ))}
            </div>
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
          {refundedPositions.length > 0 && (
            <PositionSection title="Refunded" icon={<Coins className="h-4 w-4 text-muted-foreground" />} positions={refundedPositions} />
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
        market={selectedMarket as Market | null}
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
    refunded: "bg-gray-500/20 text-gray-600",
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
