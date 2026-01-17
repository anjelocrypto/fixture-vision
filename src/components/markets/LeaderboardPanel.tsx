import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, TrendingUp, Coins } from "lucide-react";
import { LeaderboardEntry } from "@/hooks/useMarkets";
import { useTranslation } from "react-i18next";

interface LeaderboardPanelProps {
  entries: LeaderboardEntry[];
}

export function LeaderboardPanel({ entries }: LeaderboardPanelProps) {
  const { t } = useTranslation("markets");

  const getRankIcon = (rank: number) => {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return `#${rank}`;
  };

  const getRankColor = (rank: number) => {
    if (rank === 1) return "bg-yellow-500/20 text-yellow-600 border-yellow-500/50";
    if (rank === 2) return "bg-gray-400/20 text-gray-500 border-gray-400/50";
    if (rank === 3) return "bg-orange-500/20 text-orange-600 border-orange-500/50";
    return "bg-muted text-muted-foreground";
  };

  if (!entries.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Trophy className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>{t("leaderboard.no_traders")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <Card key={entry.user_id} className="overflow-hidden">
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              {/* Rank */}
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border ${getRankColor(entry.rank)}`}>
                {getRankIcon(entry.rank)}
              </div>

              {/* Name & Stats */}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{entry.display_name}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
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
              <div className="text-right">
                <div className="flex items-center gap-1 font-bold text-primary">
                  <Coins className="h-4 w-4" />
                  {entry.balance.toLocaleString()}
                </div>
                <Badge
                  variant="outline"
                  className={entry.roi >= 0 ? "text-green-600" : "text-red-600"}
                >
                  {entry.roi >= 0 ? "+" : ""}{entry.roi}% {t("leaderboard.roi")}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
