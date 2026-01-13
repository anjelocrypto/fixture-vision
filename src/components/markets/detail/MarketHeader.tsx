import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, CheckCircle, XCircle, Calendar, Trophy } from "lucide-react";
import { MarketWithFixture } from "@/hooks/useMarketDetail";
import { formatDistanceToNow, format } from "date-fns";

interface MarketHeaderProps {
  market: MarketWithFixture;
}

const RESOLUTION_RULE_LABELS: Record<string, string> = {
  "over_0.5_goals": "Over 0.5 Goals",
  "over_1.5_goals": "Over 1.5 Goals",
  "over_2.5_goals": "Over 2.5 Goals",
  "under_2.5_goals": "Under 2.5 Goals",
  btts: "Both Teams to Score",
  "over_8.5_corners": "Over 8.5 Corners",
  "under_9.5_corners": "Under 9.5 Corners",
  home_win: "Home Win",
  away_win: "Away Win",
  draw: "Draw",
};

export function MarketHeader({ market }: MarketHeaderProps) {
  const isOpen = market.status === "open";
  const isClosed = market.status === "closed";
  const isResolved = market.status === "resolved";

  const closesAt = new Date(market.closes_at);
  const countdown = isOpen
    ? formatDistanceToNow(closesAt, { addSuffix: true })
    : format(closesAt, "MMM d, yyyy HH:mm");

  const categoryColors: Record<string, string> = {
    football: "bg-green-500/20 text-green-600 border-green-500/30",
    basketball: "bg-orange-500/20 text-orange-600 border-orange-500/30",
    entertainment: "bg-purple-500/20 text-purple-600 border-purple-500/30",
    politics: "bg-blue-500/20 text-blue-600 border-blue-500/30",
    crypto: "bg-yellow-500/20 text-yellow-600 border-yellow-500/30",
  };

  const getStatusBadge = () => {
    if (isResolved && market.winning_outcome) {
      const isYesWon = market.winning_outcome === "yes";
      return (
        <Badge
          variant="outline"
          className={
            isYesWon
              ? "bg-green-500/20 text-green-600 border-green-500/30"
              : "bg-red-500/20 text-red-600 border-red-500/30"
          }
        >
          {isYesWon ? <CheckCircle className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
          {market.winning_outcome.toUpperCase()} Won
        </Badge>
      );
    }
    if (isResolved && !market.winning_outcome) {
      return (
        <Badge variant="outline" className="bg-muted text-muted-foreground">
          Voided
        </Badge>
      );
    }
    if (isClosed) {
      return (
        <Badge variant="outline" className="bg-yellow-500/20 text-yellow-600 border-yellow-500/30">
          <Clock className="h-3 w-3 mr-1" />
          Closed
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-primary/20 text-primary border-primary/30">
        <Trophy className="h-3 w-3 mr-1" />
        Open
      </Badge>
    );
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        {/* Badges Row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant="outline"
            className={categoryColors[market.category] || "bg-muted"}
          >
            {market.category}
          </Badge>
          {getStatusBadge()}
          {market.resolution_rule && (
            <Badge variant="secondary" className="text-xs">
              {RESOLUTION_RULE_LABELS[market.resolution_rule] || market.resolution_rule}
            </Badge>
          )}
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-foreground leading-tight">
          {market.title}
        </h1>

        {/* Description */}
        {market.description && (
          <p className="text-muted-foreground">{market.description}</p>
        )}

        {/* Fixture Info */}
        {market.fixture && (
          <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">
                {market.fixture.home_team} vs {market.fixture.away_team}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Kickoff: {format(market.fixture.kickoff_at, "MMM d, HH:mm")}
            </div>
          </div>
        )}

        {/* Countdown */}
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            {isOpen ? "Closes" : "Closed"} {countdown}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
