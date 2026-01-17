import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Coins, TrendingUp, Users, Trophy, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MarketWithMetadata } from "@/hooks/useMarketsFiltered";
import { cn } from "@/lib/utils";

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
  const navigate = useNavigate();

  const totalStaked = market.total_staked_yes + market.total_staked_no;
  const yesPercent = totalStaked > 0 
    ? Math.round((market.total_staked_yes / totalStaked) * 100) 
    : Math.round((1 / market.odds_yes) * 100);
  const noPercent = 100 - yesPercent;

  // Calculate time until kickoff
  const kickoffTime = market.fixture?.timestamp 
    ? new Date(market.fixture.timestamp * 1000) 
    : new Date(market.closes_at);
  const now = new Date();
  const hoursUntil = Math.max(0, (kickoffTime.getTime() - now.getTime()) / (1000 * 60 * 60));

  const getTimeLabel = () => {
    if (hoursUntil < 1) {
      const mins = Math.round(hoursUntil * 60);
      return mins <= 0 ? "Starting soon" : `${mins}m`;
    }
    if (hoursUntil < 24) return `${Math.round(hoursUntil)}h`;
    return `${Math.round(hoursUntil / 24)}d`;
  };

  // Determine market type from resolution rule
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
    if (rule.includes("home_win")) return "Home";
    if (rule.includes("away_win")) return "Away";
    if (rule.includes("draw")) return "Draw";
    return market.category || "Other";
  };

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking the bet button
    if ((e.target as HTMLElement).closest("button")) return;
    navigate(`/markets/${market.id}`);
  };

  const isResolved = market.status === "resolved";
  const isClosed = market.status === "closed";

  return (
    <Card
      className={cn(
        "group relative overflow-hidden cursor-pointer transition-all duration-200",
        "hover:shadow-lg hover:border-primary/30 hover:bg-accent/30",
        userHasPosition && "ring-1 ring-primary/40"
      )}
      onClick={handleCardClick}
    >
      <CardContent className="p-3 sm:p-4">
        {/* Top Row: League + Time */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {/* Country Flag */}
            {market.country?.flag && (
              <img 
                src={market.country.flag} 
                alt="" 
                className="w-5 h-3.5 object-cover rounded-sm shadow-sm"
              />
            )}
            
            {/* League Badge */}
            <Badge 
              variant="outline" 
              className="h-5 text-[10px] px-1.5 gap-1 bg-muted/50 border-0"
            >
              {market.league?.logo && (
                <img src={market.league.logo} alt="" className="w-3 h-3 object-contain" />
              )}
              <span className="truncate max-w-[100px]">{market.league?.name || "Football"}</span>
            </Badge>

            {/* Market Type */}
            <Badge 
              variant="secondary" 
              className="h-5 text-[10px] px-1.5 bg-primary/10 text-primary border-0"
            >
              {getMarketTypeLabel()}
            </Badge>
          </div>

          {/* Time / Status */}
          <div className="flex items-center gap-1.5">
            {isResolved ? (
              <Badge variant="default" className="bg-green-500/20 text-green-400 border-0 h-5 text-[10px]">
                <Trophy className="h-3 w-3 mr-0.5" />
                Resolved
              </Badge>
            ) : isClosed ? (
              <Badge variant="secondary" className="bg-amber-500/20 text-amber-400 border-0 h-5 text-[10px]">
                Closed
              </Badge>
            ) : (
              <Badge variant="outline" className="h-5 text-[10px] px-1.5 gap-1 border-primary/30">
                <Clock className="h-2.5 w-2.5" />
                {getTimeLabel()}
              </Badge>
            )}

            {/* User Position Indicator */}
            {userHasPosition && (
              <Badge className="h-5 text-[10px] px-1.5 bg-primary text-primary-foreground">
                <Target className="h-2.5 w-2.5 mr-0.5" />
                Active
              </Badge>
            )}
          </div>
        </div>

        {/* Match Title */}
        <h3 className="font-semibold text-sm sm:text-base mb-2 line-clamp-2 group-hover:text-primary transition-colors">
          {market.fixture 
            ? `${market.fixture.home_team} vs ${market.fixture.away_team}`
            : market.title
          }
        </h3>

        {/* Market Question */}
        {market.description && (
          <p className="text-xs text-muted-foreground mb-3 line-clamp-1">
            {market.description}
          </p>
        )}

        {/* Odds Display */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className={cn(
            "rounded-lg p-2 text-center transition-all",
            "bg-green-500/10 border border-green-500/20",
            !isResolved && !isClosed && "hover:bg-green-500/20"
          )}>
            <div className="text-[10px] text-muted-foreground uppercase mb-0.5">Yes</div>
            <div className="text-lg font-bold text-green-500">{market.odds_yes.toFixed(2)}</div>
            <div className="text-[10px] text-green-400/80">{yesPercent}%</div>
          </div>
          <div className={cn(
            "rounded-lg p-2 text-center transition-all",
            "bg-red-500/10 border border-red-500/20",
            !isResolved && !isClosed && "hover:bg-red-500/20"
          )}>
            <div className="text-[10px] text-muted-foreground uppercase mb-0.5">No</div>
            <div className="text-lg font-bold text-red-500">{market.odds_no.toFixed(2)}</div>
            <div className="text-[10px] text-red-400/80">{noPercent}%</div>
          </div>
        </div>

        {/* Stats Row */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Coins className="h-3 w-3" />
              {totalStaked.toLocaleString()}
            </span>
          </div>

          {/* Bet Button */}
          {showBetButton && !isResolved && !isClosed && (
            <Button
              size="sm"
              className="h-7 text-xs px-3"
              onClick={(e) => {
                e.stopPropagation();
                onBet(market);
              }}
            >
              <TrendingUp className="h-3 w-3 mr-1" />
              Place Bet
            </Button>
          )}

          {/* Final Outcome for resolved markets */}
          {isResolved && market.winning_outcome && (
            <Badge
              className={cn(
                "capitalize",
                market.winning_outcome === "yes" 
                  ? "bg-green-500/20 text-green-400"
                  : "bg-red-500/20 text-red-400"
              )}
            >
              {market.winning_outcome} Won
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Grouped League Section
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
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const visibleMarkets = expanded ? markets : markets.slice(0, maxVisible);
  const hasMore = markets.length > maxVisible;

  return (
    <div className="space-y-2">
      {/* League Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          {country?.flag && (
            <img src={country.flag} alt="" className="w-5 h-3.5 object-cover rounded-sm" />
          )}
          {league.logo && (
            <img src={league.logo} alt="" className="w-5 h-5 object-contain" />
          )}
          <h3 className="font-semibold text-sm">{league.name}</h3>
          <Badge variant="outline" className="h-5 text-[10px] px-1.5">
            {markets.length} market{markets.length !== 1 ? "s" : ""}
          </Badge>
        </div>
      </div>

      {/* Markets */}
      <div className="space-y-2">
        {visibleMarkets.map((market) => (
          <EnhancedMarketCard
            key={market.id}
            market={market}
            onBet={onBet}
            userHasPosition={userPositionMarketIds.has(market.id)}
          />
        ))}
      </div>

      {/* Show More Button */}
      {hasMore && !expanded && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-muted-foreground"
          onClick={() => setExpanded(true)}
        >
          Show {markets.length - maxVisible} more markets
        </Button>
      )}
    </div>
  );
}
