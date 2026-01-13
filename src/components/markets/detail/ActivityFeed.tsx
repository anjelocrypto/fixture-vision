import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, TrendingUp, TrendingDown, Activity, Gavel, Plus, Clock } from "lucide-react";
import { ActivityEntry } from "@/hooks/useMarketDetail";
import { formatDistanceToNow } from "date-fns";

interface ActivityFeedProps {
  activity: ActivityEntry[];
}

export function ActivityFeed({ activity }: ActivityFeedProps) {
  if (activity.length === 0) {
    return (
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="pb-2 pt-5 px-5">
          <CardTitle className="text-base flex items-center gap-2 font-semibold">
            <Activity className="h-4 w-4 text-primary" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <div className="text-center py-8 text-muted-foreground text-sm bg-muted/20 rounded-xl border border-border/30">
            <Activity className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No activity yet</p>
            <p className="text-xs mt-1 text-muted-foreground/70">Be the first to bet!</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getSystemEventIcon = (action: string) => {
    switch (action) {
      case "create":
        return <Plus className="h-3.5 w-3.5" />;
      case "resolve":
        return <Gavel className="h-3.5 w-3.5" />;
      case "close":
        return <Clock className="h-3.5 w-3.5" />;
      default:
        return <Activity className="h-3.5 w-3.5" />;
    }
  };

  const getSystemEventLabel = (action: string) => {
    switch (action) {
      case "create":
        return "Market created";
      case "resolve":
        return "Market resolved";
      case "close":
        return "Market closed";
      case "close_expired":
        return "Betting closed";
      default:
        return action;
    }
  };

  // Anonymize user display
  const formatUser = (id: string) => {
    return `Player ${id.slice(0, 4)}`;
  };

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-3 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2 font-semibold">
            <Activity className="h-4 w-4 text-primary" />
            Recent Activity
          </CardTitle>
          <Badge variant="secondary" className="text-xs">
            {activity.filter(a => a.type === "bet").length} bets
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {activity.map((item, index) => (
            <div
              key={item.id}
              className={`flex items-center justify-between p-3 rounded-xl text-sm transition-colors ${
                index === 0 ? 'bg-primary/5 border border-primary/20' : 'bg-muted/25 hover:bg-muted/40'
              }`}
            >
              {item.type === "bet" ? (
                <>
                  <div className="flex items-center gap-2.5">
                    <div className={`p-1.5 rounded-lg ${
                      item.outcome === "yes" ? "bg-emerald-500/15" : "bg-red-500/15"
                    }`}>
                      {item.outcome === "yes" ? (
                        <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-2">
                      <Badge
                        variant="outline"
                        className={`px-2 py-0.5 text-xs font-bold w-fit ${
                          item.outcome === "yes"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                            : "bg-red-500/10 text-red-400 border-red-500/25"
                        }`}
                      >
                        {item.outcome?.toUpperCase()}
                      </Badge>
                      <span className="text-muted-foreground text-xs hidden sm:inline">
                        @ {item.odds_at_placement?.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-4">
                    <div className="flex items-center gap-1.5 text-foreground font-medium">
                      <Coins className="h-3.5 w-3.5 text-amber-500" />
                      <span>{item.net_stake?.toLocaleString()}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground min-w-[50px] text-right">
                      {formatDistanceToNow(new Date(item.created_at), {
                        addSuffix: false,
                      })}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2.5">
                    <span className="p-1.5 rounded-lg bg-primary/15 text-primary">
                      {getSystemEventIcon(item.action || "")}
                    </span>
                    <span className="text-muted-foreground font-medium">
                      {getSystemEventLabel(item.action || "")}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(item.created_at), {
                      addSuffix: false,
                    })}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
