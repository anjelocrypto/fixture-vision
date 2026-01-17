import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, CheckCircle, XCircle, Calendar, Trophy } from "lucide-react";
import { MarketWithFixture } from "@/hooks/useMarketDetail";
import { formatDistanceToNow, format } from "date-fns";
import { PriceDisplay, normalizeImpliedProbs } from "./PriceDisplay";
import { useTranslation } from "react-i18next";

interface MarketHeaderProps {
  market: MarketWithFixture;
}

export function MarketHeader({ market }: MarketHeaderProps) {
  const { t } = useTranslation("markets");

  const isOpen = market.status === "open";
  const isClosed = market.status === "closed";
  const isResolved = market.status === "resolved";

  const closesAt = new Date(market.closes_at);
  const countdown = isOpen
    ? formatDistanceToNow(closesAt, { addSuffix: true })
    : format(closesAt, "MMM d, yyyy HH:mm");

  // Get normalized implied probabilities
  const { yesPct, noPct } = normalizeImpliedProbs(market.odds_yes, market.odds_no);

  // Get translated resolution rule label
  const getResolutionRuleLabel = (rule: string | null) => {
    if (!rule) return null;
    const key = `resolution_rules.${rule}` as const;
    const translated = t(key, { defaultValue: "" });
    return translated || rule;
  };

  const getStatusBadge = () => {
    if (isResolved && market.winning_outcome) {
      const isYesWon = market.winning_outcome === "yes";
      return (
        <Badge
          variant="outline"
          className={
            isYesWon
              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40 font-medium"
              : "bg-red-500/20 text-red-400 border-red-500/40 font-medium"
          }
        >
          {isYesWon ? <CheckCircle className="h-3 w-3 mr-1" /> : <XCircle className="h-3 w-3 mr-1" />}
          {market.winning_outcome === "yes" ? t("card.yes") : t("card.no")} {t("card.won")}
        </Badge>
      );
    }
    if (isResolved && !market.winning_outcome) {
      return (
        <Badge variant="outline" className="bg-muted text-muted-foreground font-medium">
          {t("detail.voided")}
        </Badge>
      );
    }
    if (isClosed) {
      return (
        <Badge variant="outline" className="bg-amber-500/20 text-amber-400 border-amber-500/40 font-medium">
          <Clock className="h-3 w-3 mr-1" />
          {t("status.closed")}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-primary/20 text-primary border-primary/40 font-medium">
        <Trophy className="h-3 w-3 mr-1" />
        {t("status.open")}
      </Badge>
    );
  };

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden">
      <CardContent className="p-5 sm:p-6 space-y-5">
        {/* Badges Row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant="outline"
            className="bg-primary/15 text-primary border-primary/30 font-medium capitalize"
          >
            {market.category}
          </Badge>
          {getStatusBadge()}
          {market.resolution_rule && (
            <Badge variant="secondary" className="text-xs font-medium bg-secondary/80">
              {getResolutionRuleLabel(market.resolution_rule)}
            </Badge>
          )}
        </div>

        {/* Title */}
        <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-tight tracking-tight">
          {market.title}
        </h1>

        {/* Description */}
        {market.description && (
          <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">
            {market.description}
          </p>
        )}

        {/* Prominent YES/NO Price Display (Polymarket-style) */}
        <div className="grid grid-cols-2 gap-4">
          <PriceDisplay odds={market.odds_yes} outcome="yes" size="md" />
          <PriceDisplay odds={market.odds_no} outcome="no" size="md" />
        </div>

        {/* Implied Probability Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("detail.implied_probability")}</span>
            <span className="font-medium">
              <span className="text-emerald-400">{yesPct}%</span>
              {" / "}
              <span className="text-red-400">{noPct}%</span>
            </span>
          </div>
          <div className="h-2 bg-muted/60 rounded-full overflow-hidden flex">
            <div 
              className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
              style={{ width: `${yesPct}%` }}
            />
            <div 
              className="h-full bg-gradient-to-r from-red-400 to-red-600 transition-all duration-500"
              style={{ width: `${noPct}%` }}
            />
          </div>
        </div>

        {/* Fixture Info */}
        {market.fixture && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3 sm:p-4 rounded-xl bg-muted/40 border border-border/30">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-primary shrink-0" />
              <span className="font-semibold text-foreground">
                {market.fixture.home_team} vs {market.fixture.away_team}
              </span>
            </div>
            <div className="text-xs text-muted-foreground sm:ml-auto">
              {t("detail.kickoff")}: {format(market.fixture.kickoff_at, "MMM d, HH:mm")}
            </div>
          </div>
        )}

        {/* Countdown */}
        <div className="flex items-center gap-2 text-sm pt-1">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            {isOpen ? t("detail.closes") : t("detail.closed")} {countdown}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
