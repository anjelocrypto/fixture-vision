import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Coins, TrendingUp, TrendingDown, Activity, Gavel, Plus } from "lucide-react";
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
            Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <div className="text-center py-8 text-muted-foreground text-sm bg-muted/20 rounded-xl border border-border/30">
            <Activity className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No activity yet</p>
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
      default:
        return action;
    }
  };

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="text-base flex items-center gap-2 font-semibold">
          <Activity className="h-4 w-4 text-primary" />
          Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
          {activity.map((item, index) => (
            <div
              key={item.id}
              className={`flex items-center justify-between p-3 rounded-xl text-sm transition-colors ${
                index === 0 ? 'bg-muted/50 border border-border/40' : 'bg-muted/25 hover:bg-muted/40'
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
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`px-2 py-0.5 text-xs font-medium ${
                          item.outcome === "yes"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                            : "bg-red-500/10 text-red-400 border-red-500/25"
                        }`}
                      >
                        {item.outcome?.toUpperCase()}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        @ {item.odds_at_placement?.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-foreground font-medium">
                      <Coins className="h-3.5 w-3.5 text-amber-500" />
                      <span>{item.net_stake?.toLocaleString()}</span>
                    </div>
                    <span className="text-xs text-muted-foreground min-w-[60px] text-right">
                      {formatDistanceToNow(new Date(item.created_at), {
                        addSuffix: true,
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
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(item.created_at), {
                      addSuffix: true,
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
