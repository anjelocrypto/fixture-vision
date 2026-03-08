import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import type { SafeZonePick } from "@/hooks/useSafeZoneChat";
import { Shield, TrendingUp, Clock, BarChart3, Target } from "lucide-react";

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

  const confidenceColor = confidencePct >= 75
    ? "text-green-400"
    : confidencePct >= 60
      ? "text-primary"
      : "text-amber-400";

  const confidenceBg = confidencePct >= 75
    ? "bg-green-500/15 border-green-500/20"
    : confidencePct >= 60
      ? "bg-primary/10 border-primary/20"
      : "bg-amber-500/10 border-amber-500/20";

  return (
    <div className="rounded-xl border border-border/60 bg-card/90 backdrop-blur-sm overflow-hidden">
      {/* Top bar: League + Time */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/40">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate max-w-[55%]">
          {pick.league_name}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="w-2.5 h-2.5" />
          {format(kickoff, "MMM d, HH:mm")}
        </span>
      </div>

      <div className="p-3 space-y-2.5">
        {/* Teams */}
        <div className="text-sm font-bold text-foreground leading-tight">
          {pick.home_team}
          <span className="text-muted-foreground font-normal mx-1.5">{t("vs")}</span>
          {pick.away_team}
        </div>

        {/* Pick badge row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-primary/15 text-primary border border-primary/20">
            <Shield className="w-3 h-3" />
            {marketLabel} {t("safe_zone_bot_over")} {pick.line}
          </span>
          <span className="px-2 py-1 rounded-lg text-[11px] font-mono font-bold bg-muted/50 text-foreground border border-border/40">
            @{pick.odds?.toFixed(2)}
          </span>
          {pick.bookmaker && (
            <span className="text-[10px] text-muted-foreground italic">{pick.bookmaker}</span>
          )}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-1.5">
          {/* Confidence */}
          <div className={`flex flex-col items-center py-1.5 rounded-lg border ${confidenceBg}`}>
            <Target className={`w-3 h-3 mb-0.5 ${confidenceColor}`} />
            <span className={`text-xs font-bold tabular-nums ${confidenceColor}`}>
              {confidencePct}%
            </span>
            <span className="text-[8px] text-muted-foreground uppercase tracking-wide">Conf</span>
          </div>
          {/* Edge */}
          <div className="flex flex-col items-center py-1.5 rounded-lg border border-border/30 bg-muted/20">
            <TrendingUp className="w-3 h-3 mb-0.5 text-primary" />
            <span className="text-xs font-bold tabular-nums text-foreground">
              {pick.edge_pct != null ? `+${(pick.edge_pct * 100).toFixed(0)}%` : "—"}
            </span>
            <span className="text-[8px] text-muted-foreground uppercase tracking-wide">Edge</span>
          </div>
          {/* ROI */}
          <div className="flex flex-col items-center py-1.5 rounded-lg border border-border/30 bg-muted/20">
            <BarChart3 className="w-3 h-3 mb-0.5 text-primary" />
            <span className="text-xs font-bold tabular-nums text-foreground">
              +{pick.historical_roi_pct?.toFixed(0)}%
            </span>
            <span className="text-[8px] text-muted-foreground uppercase tracking-wide">ROI</span>
          </div>
          {/* Sample */}
          <div className="flex flex-col items-center py-1.5 rounded-lg border border-border/30 bg-muted/20">
            <span className="text-[10px] mb-0.5">📊</span>
            <span className="text-xs font-bold tabular-nums text-foreground">
              {pick.sample_size}
            </span>
            <span className="text-[8px] text-muted-foreground uppercase tracking-wide">n</span>
          </div>
        </div>

        {/* Explanation */}
        {pick.explanation && (
          <p className="text-[11px] text-muted-foreground/80 italic leading-relaxed pl-2 border-l-2 border-primary/30">
            {pick.explanation}
          </p>
        )}
      </div>
    </div>
  );
}
