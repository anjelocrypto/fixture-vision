import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Coins, TrendingUp, Trophy, Target, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarketWithMetadata } from "@/hooks/useMarketsFiltered";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface EnhancedMarketCardProps {
  market: MarketWithMetadata;
  onBet: (market: MarketWithMetadata) => void;
  showBetButton?: boolean;
  userHasPosition?: boolean;
}

export function EnhancedMarketCard({
  market,
  onBet,
  showBetButton = true,
  userHasPosition,
}: EnhancedMarketCardProps) {
  const { t } = useTranslation("markets");
  const navigate = useNavigate();

  const totalStaked = market.total_staked_yes + market.total_staked_no;
  const yesPercent =
    totalStaked > 0
      ? Math.round((market.total_staked_yes / totalStaked) * 100)
      : Math.round((1 / market.odds_yes) * 100);
  const noPercent = 100 - yesPercent;

  const kickoffTime = market.fixture?.timestamp
    ? new Date(market.fixture.timestamp * 1000)
    : new Date(market.closes_at);
  const now = new Date();
  const hoursUntil = Math.max(0, (kickoffTime.getTime() - now.getTime()) / (1000 * 60 * 60));

  const getTimeLabel = () => {
    if (hoursUntil < 1) {
      const mins = Math.round(hoursUntil * 60);
      return mins <= 0 ? t("card.starting_soon") : `${mins}m`;
    }
    if (hoursUntil < 24) return `${Math.round(hoursUntil)}h`;
    return `${Math.round(hoursUntil / 24)}d`;
  };

  const getMarketTypeLabel = () => {
    const rule = market.resolution_rule || "";
    if (rule.includes("btts")) return "BTTS";
    if (rule.includes("over") && rule.includes("goals")) {
      const match = rule.match(/over_(\d+\.?\d?)_goals/);
      return match ? `O${match[1]}` : "Over";
    }
    if (rule.includes("under") && rule.includes("goals")) {
      const match = rule.match(/under_(\d+\.?\d?)_goals/);
      return match ? `U${match[1]}` : "Under";
    }
    if (rule.includes("home_win")) return t("resolution_rules.home_win");
    if (rule.includes("away_win")) return t("resolution_rules.away_win");
    if (rule.includes("draw")) return t("resolution_rules.draw");
    return market.category || "Other";
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    navigate(`/markets/${market.id}`);
  };

  const isResolved = market.status === "resolved";
  const isClosed = market.status === "closed";

  return (
    <div
      className={cn(
        "group relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 border bg-card/60 backdrop-blur-sm active:scale-[0.99]",
        "hover:shadow-lg hover:border-primary/30",
        userHasPosition ? "border-primary/40 ring-1 ring-primary/20" : "border-border/40"
      )}
      onClick={handleCardClick}
    >
      <div className="p-3.5 sm:p-4">
        {/* Top Row: League + Market Type + Time */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {market.country?.flag && (
              <img
                src={market.country.flag}
                alt=""
                className="w-4 h-3 object-cover rounded-sm shadow-sm flex-shrink-0"
              />
            )}
            <span className="text-[11px] text-muted-foreground truncate max-w-[100px]">
              {market.league?.name || t("filter.football")}
            </span>
            <span className="text-border/60">·</span>
            <span className="text-[11px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-md flex-shrink-0">
              {getMarketTypeLabel()}
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isResolved ? (
              <span className="text-[10px] font-semibold text-green-400 bg-green-500/15 px-2 py-0.5 rounded-lg flex items-center gap-1">
                <Trophy className="h-2.5 w-2.5" />
                {t("status.resolved")}
              </span>
            ) : isClosed ? (
              <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded-lg">
                {t("status.closed")}
              </span>
            ) : (
              <span className="text-[10px] font-medium text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-lg flex items-center gap-1 border border-border/30">
                <Clock className="h-2.5 w-2.5" />
                {getTimeLabel()}
              </span>
            )}
            {userHasPosition && (
              <span className="text-[10px] font-bold text-primary-foreground bg-primary px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                <Target className="h-2.5 w-2.5" />
              </span>
            )}
          </div>
        </div>

        {/* Match Title */}
        <h3 className="font-semibold text-sm sm:text-base mb-1 line-clamp-2 group-hover:text-primary transition-colors leading-tight">
          {market.fixture
            ? `${market.fixture.home_team} vs ${market.fixture.away_team}`
            : market.title}
        </h3>

        {market.description && (
          <p className="text-[11px] text-muted-foreground mb-3 line-clamp-1">{market.description}</p>
        )}

        {/* Odds Display */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            className={cn(
              "rounded-xl p-2.5 text-center transition-all duration-200 border",
              "bg-green-500/8 border-green-500/15",
              !isResolved && !isClosed && "hover:bg-green-500/15 active:scale-[0.97]"
            )}
            onClick={(e) => {
              e.stopPropagation();
              if (!isResolved && !isClosed) onBet(market);
            }}
          >
            <div className="text-[10px] text-muted-foreground uppercase font-medium mb-0.5">{t("card.yes")}</div>
            <div className="text-xl font-bold text-green-500 tabular-nums">{market.odds_yes.toFixed(2)}</div>
            <div className="text-[10px] text-green-400/70 tabular-nums">{yesPercent}%</div>
          </button>
          <button
            className={cn(
              "rounded-xl p-2.5 text-center transition-all duration-200 border",
              "bg-red-500/8 border-red-500/15",
              !isResolved && !isClosed && "hover:bg-red-500/15 active:scale-[0.97]"
            )}
            onClick={(e) => {
              e.stopPropagation();
              if (!isResolved && !isClosed) onBet(market);
            }}
          >
            <div className="text-[10px] text-muted-foreground uppercase font-medium mb-0.5">{t("card.no")}</div>
            <div className="text-xl font-bold text-red-500 tabular-nums">{market.odds_no.toFixed(2)}</div>
            <div className="text-[10px] text-red-400/70 tabular-nums">{noPercent}%</div>
          </button>
        </div>

        {/* Bottom Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Coins className="h-3 w-3" />
            <span className="tabular-nums font-medium">{totalStaked.toLocaleString()}</span>
            <span>pool</span>
          </div>

          {showBetButton && !isResolved && !isClosed && (
            <Button
              size="sm"
              className="h-8 text-xs px-4 rounded-xl gap-1.5 shadow-[0_2px_10px_hsl(var(--primary)/0.2)] active:scale-[0.96]"
              onClick={(e) => {
                e.stopPropagation();
                onBet(market);
              }}
            >
              <TrendingUp className="h-3 w-3" />
              {t("card.place_bet")}
            </Button>
          )}

          {isResolved && market.winning_outcome && (
            <span
              className={cn(
                "text-xs font-semibold px-2.5 py-1 rounded-lg capitalize",
                market.winning_outcome === "yes"
                  ? "bg-green-500/15 text-green-400"
                  : "bg-red-500/15 text-red-400"
              )}
            >
              {market.winning_outcome === "yes" ? t("card.yes") : t("card.no")} {t("card.won")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// League Section
export function LeagueSection({
  league,
  country,
  markets,
  onBet,
  userPositionMarketIds,
  maxVisible = 3,
}: {
  league: { id: number; name: string; logo: string | null };
  country: { id: number; name: string; code: string | null; flag: string | null } | null;
  markets: MarketWithMetadata[];
  onBet: (market: MarketWithMetadata) => void;
  userPositionMarketIds: Set<string>;
  maxVisible?: number;
}) {
  const { t } = useTranslation("markets");
  const [expanded, setExpanded] = useState(false);
  const visibleMarkets = expanded ? markets : markets.slice(0, maxVisible);
  const hasMore = markets.length > maxVisible;

  return (
    <div className="space-y-2.5">
      {/* League Header */}
      <div className="flex items-center gap-2 px-1">
        {country?.flag && (
          <img src={country.flag} alt="" className="w-5 h-3.5 object-cover rounded-sm" />
        )}
        {league.logo && (
          <img src={league.logo} alt="" className="w-5 h-5 object-contain" />
        )}
        <h3 className="font-semibold text-sm">{league.name}</h3>
        <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded-md border border-border/30">
          {markets.length}
        </span>
      </div>

      <div className="space-y-2.5">
        {visibleMarkets.map((market) => (
          <EnhancedMarketCard
            key={market.id}
            market={market}
            onBet={onBet}
            userHasPosition={userPositionMarketIds.has(market.id)}
          />
        ))}
      </div>

      {hasMore && !expanded && (
        <button
          className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-xl border border-dashed border-border/40 hover:border-border active:scale-[0.98]"
          onClick={() => setExpanded(true)}
        >
          <ChevronDown className="h-3.5 w-3.5" />
          {t("card.show_more", { count: markets.length - maxVisible })}
        </button>
      )}
    </div>
  );
}
