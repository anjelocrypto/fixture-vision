import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import type { SafeZonePick } from "@/hooks/useSafeZoneChat";
import { Shield, TrendingUp } from "lucide-react";

interface Props {
  pick: SafeZonePick;
}

export function SafeZoneBotPickCard({ pick }: Props) {
  const { t } = useTranslation("common");
  const kickoff = new Date(pick.utc_kickoff);
  const confidencePct = Math.round(pick.confidence_score * 100);

  const marketLabel = pick.market === "corners"
    ? t("safe_zone_bot_corners")
    : t("safe_zone_bot_goals");

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      {/* Header: League + Kickoff */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium truncate max-w-[60%]">{pick.league_name}</span>
        <span>{format(kickoff, "MMM d, HH:mm")}</span>
      </div>

      {/* Teams */}
      <div className="font-semibold text-sm text-foreground">
        {pick.home_team} {t("vs")} {pick.away_team}
      </div>

      {/* Pick details */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/15 text-primary">
          <Shield className="w-3 h-3" />
          {marketLabel} {t("safe_zone_bot_over")} {pick.line}
        </span>
        <span className="text-xs font-mono text-foreground">
          @{pick.odds?.toFixed(2)}
        </span>
        {pick.bookmaker && (
          <span className="text-xs text-muted-foreground">{pick.bookmaker}</span>
        )}
      </div>

      {/* Confidence + Edge */}
      <div className="flex items-center gap-3 text-xs">
        <span className="inline-flex items-center gap-1 text-primary font-semibold">
          <TrendingUp className="w-3 h-3" />
          {confidencePct}%
        </span>
        {pick.edge_pct != null && (
          <span className="text-muted-foreground">
            Edge +{(pick.edge_pct * 100).toFixed(1)}%
          </span>
        )}
        <span className="text-muted-foreground">
          ROI +{pick.historical_roi_pct?.toFixed(0)}%
        </span>
        <span className="text-muted-foreground">n={pick.sample_size}</span>
      </div>

      {/* Explanation */}
      {pick.explanation && (
        <p className="text-xs text-muted-foreground italic leading-relaxed">
          {pick.explanation}
        </p>
      )}
    </div>
  );
}
