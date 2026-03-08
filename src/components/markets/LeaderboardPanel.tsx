import { Trophy, TrendingUp, Coins } from "lucide-react";
import { LeaderboardEntry } from "@/hooks/useMarkets";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface LeaderboardPanelProps {
  entries: LeaderboardEntry[];
}

export function LeaderboardPanel({ entries }: LeaderboardPanelProps) {
  const { t } = useTranslation("markets");

  const getRankDisplay = (rank: number) => {
    if (rank === 1) return { emoji: "🥇", bg: "bg-yellow-500/15 border-yellow-500/30" };
    if (rank === 2) return { emoji: "🥈", bg: "bg-gray-400/15 border-gray-400/30" };
    if (rank === 3) return { emoji: "🥉", bg: "bg-orange-500/15 border-orange-500/30" };
    return { emoji: `#${rank}`, bg: "bg-muted/30 border-border/40" };
  };

  if (!entries.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Trophy className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">{t("leaderboard.no_traders")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const rank = getRankDisplay(entry.rank);
        return (
          <div
            key={entry.user_id}
            className={cn(
              "rounded-xl border p-3 transition-all duration-200",
              rank.bg
            )}
          >
            <div className="flex items-center gap-3">
              {/* Rank */}
              <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm bg-background/50 border border-border/30 flex-shrink-0">
                {rank.emoji}
              </div>

              {/* Name & Stats */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{entry.display_name}</p>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-1">
                    <Trophy className="h-3 w-3" />
                    {entry.wins_count}W / {entry.losses_count}L
                  </span>
                  <span className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    {entry.win_rate}%
                  </span>
                </div>
              </div>

              {/* Balance & ROI */}
              <div className="text-right flex-shrink-0">
                <div className="flex items-center gap-1 font-bold text-primary tabular-nums text-sm">
                  <Coins className="h-3.5 w-3.5" />
                  {entry.balance.toLocaleString()}
                </div>
                <span
                  className={cn(
                    "text-[11px] font-semibold tabular-nums",
                    entry.roi >= 0 ? "text-green-500" : "text-red-500"
                  )}
                >
                  {entry.roi >= 0 ? "+" : ""}
                  {entry.roi}% {t("leaderboard.roi")}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
