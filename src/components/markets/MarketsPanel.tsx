import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type MarketStatus = "open" | "closed" | "resolved";

export function MarketsPanel() {
  const { t } = useTranslation("markets");

  const [countryId, setCountryId] = useState<number | null>(null);
  const [leagueId, setLeagueId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"kickoff" | "pool" | "newest">("kickoff");
  const [marketStatusFilter, setMarketStatusFilter] = useState<MarketStatus>("open");
  const [activeTab, setActiveTab] = useState<"markets" | "positions" | "leaderboard">("markets");

  const [selectedMarket, setSelectedMarket] = useState<MarketWithMetadata | null>(null);
  const [betDialogOpen, setBetDialogOpen] = useState(false);

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

  const pendingPositions = positions?.filter((p) => p.status === "pending") || [];
  const wonPositions = positions?.filter((p) => p.status === "won") || [];
  const lostPositions = positions?.filter((p) => p.status === "lost") || [];
  const refundedPositions = positions?.filter((p) => p.status === "refunded") || [];

  const userPositionMarketIds = useMemo(
    () => new Set(positions?.map((p) => p.market_id) || []),
    [positions]
  );

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

  const tabs = [
    { id: "markets" as const, icon: Target, label: t("tabs.markets"), badge: null },
    {
      id: "positions" as const,
      icon: Clock,
      label: t("tabs.my_bets"),
      badge: pendingPositions.length > 0 ? pendingPositions.length : null,
    },
    { id: "leaderboard" as const, icon: Trophy, label: t("tabs.leaderboard"), badge: null },
  ];

  return (
    <div className="space-y-3">
      {/* ── Balance Card ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-2xl overflow-hidden border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent"
      >
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/20 border border-primary/25">
              <Coins className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">{t("balance.your_balance")}</p>
              <p className="text-2xl font-bold text-primary tabular-nums">
                {coinsLoading ? "..." : coins?.balance.toLocaleString() ?? "0"}
              </p>
            </div>
          </div>
          <div className="text-right space-y-1">
            <div className="flex items-center gap-1.5 justify-end text-xs">
              <TrendingUp className="h-3 w-3 text-green-500" />
              <span className="text-muted-foreground">
                {t("balance.won")}: <span className="text-green-500 font-semibold tabular-nums">{coins?.total_won.toLocaleString() ?? 0}</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 justify-end text-xs">
              <TrendingDown className="h-3 w-3 text-red-500" />
              <span className="text-muted-foreground">
                {t("balance.wagered")}: <span className="text-red-400 font-semibold tabular-nums">{coins?.total_wagered.toLocaleString() ?? 0}</span>
              </span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Admin Controls */}
      {isAdmin && <AdminMarketControls />}

      {/* ── Tabs ── */}
      <div className="flex gap-1 p-1 rounded-xl bg-muted/30 border border-border/40">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-medium transition-all duration-200 active:scale-[0.97]",
                isActive
                  ? "bg-card text-foreground shadow-sm border border-border/50"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="truncate">{tab.label}</span>
              {tab.badge && (
                <span className="flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Markets Tab ── */}
      {activeTab === "markets" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="space-y-3"
        >
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

          {leagues && leagues.length > 0 && !leagueId && (
            <QuickLeagueChips leagues={leagues} selectedLeagueId={leagueId} onSelect={setLeagueId} />
          )}

          {/* Status Filter */}
          <div className="flex gap-2">
            {(["open", "closed", "resolved"] as MarketStatus[]).map((status) => (
              <button
                key={status}
                onClick={() => setMarketStatusFilter(status)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all duration-200 active:scale-[0.96]",
                  marketStatusFilter === status
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-muted/20 border-border/50 text-muted-foreground hover:bg-muted/40"
                )}
              >
                {status === "open" && <Target className="h-3 w-3" />}
                {status === "closed" && <Clock className="h-3 w-3" />}
                {status === "resolved" && <CheckCircle className="h-3 w-3" />}
                {t(`status.${status}`)}
              </button>
            ))}
          </div>

          {/* Content */}
          {marketsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-2xl border border-border/40 p-4 space-y-3">
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-20 rounded-lg" />
                    <Skeleton className="h-5 w-16 rounded-lg" />
                  </div>
                  <Skeleton className="h-5 w-3/4 rounded-lg" />
                  <div className="grid grid-cols-2 gap-2">
                    <Skeleton className="h-16 rounded-xl" />
                    <Skeleton className="h-16 rounded-xl" />
                  </div>
                </div>
              ))}
            </div>
          ) : !markets?.length ? (
            <div className="rounded-2xl border border-border/40 p-8 text-center">
              <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <h3 className="font-semibold text-base mb-1">{t("empty_state.no_markets_found")}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {search
                  ? t("empty_state.no_markets_search", { search })
                  : leagueId
                  ? t("empty_state.no_markets_league")
                  : countryId
                  ? t("empty_state.no_markets_country")
                  : t("empty_state.no_status_markets", { status: t(`status.${marketStatusFilter}`) })}
              </p>
              {(countryId || leagueId || search) && (
                <button
                  onClick={handleReset}
                  className="text-xs text-primary font-medium hover:underline"
                >
                  {t("empty_state.clear_filters")}
                </button>
              )}
            </div>
          ) : leagueId || search ? (
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
            <div className="space-y-5">
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
        </motion.div>
      )}

      {/* ── Positions Tab ── */}
      {activeTab === "positions" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="space-y-4"
        >
          {pendingPositions.length > 0 && (
            <PositionSection title={t("positions.pending")} icon={<Clock className="h-4 w-4 text-yellow-500" />} positions={pendingPositions} />
          )}
          {wonPositions.length > 0 && (
            <PositionSection title={t("positions.won")} icon={<CheckCircle className="h-4 w-4 text-green-500" />} positions={wonPositions} />
          )}
          {lostPositions.length > 0 && (
            <PositionSection title={t("positions.lost")} icon={<XCircle className="h-4 w-4 text-red-500" />} positions={lostPositions} />
          )}
          {refundedPositions.length > 0 && (
            <PositionSection title={t("positions.refunded")} icon={<Coins className="h-4 w-4 text-muted-foreground" />} positions={refundedPositions} />
          )}
          {!positions?.length && (
            <div className="text-center py-12 text-muted-foreground">
              <Clock className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">{t("positions.no_bets_yet")}</p>
            </div>
          )}
        </motion.div>
      )}

      {/* ── Leaderboard Tab ── */}
      {activeTab === "leaderboard" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <LeaderboardPanel entries={leaderboard || []} />
        </motion.div>
      )}

      <PlaceBetDialog
        market={selectedMarket as Market | null}
        open={betDialogOpen}
        onOpenChange={setBetDialogOpen}
        userBalance={coins?.balance ?? 0}
      />
    </div>
  );
}

function PositionSection({ title, icon, positions }: { title: string; icon: React.ReactNode; positions: any[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        {icon}
        <span>{title} ({positions.length})</span>
      </div>
      {positions.map((pos) => (
        <PositionCard key={pos.id} position={pos} />
      ))}
    </div>
  );
}

function PositionCard({ position }: { position: any }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/50 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] font-bold uppercase",
              position.outcome === "yes"
                ? "bg-green-500/15 text-green-500 border border-green-500/20"
                : "bg-red-500/15 text-red-500 border border-red-500/20"
            )}
          >
            {position.outcome}
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">@ {position.odds_at_placement.toFixed(2)}</span>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-1 text-sm font-semibold tabular-nums">
            <Coins className="h-3 w-3 text-primary" />
            {position.stake}
          </div>
          <span
            className={cn(
              "text-[11px] font-semibold tabular-nums",
              position.status === "won" && "text-green-500",
              position.status === "lost" && "text-red-500",
              position.status === "pending" && "text-yellow-500",
              position.status === "refunded" && "text-muted-foreground"
            )}
          >
            {position.status === "won"
              ? `+${position.payout_amount}`
              : position.status === "pending"
              ? `→ ${position.potential_payout}`
              : position.status}
          </span>
        </div>
      </div>
    </div>
  );
}
