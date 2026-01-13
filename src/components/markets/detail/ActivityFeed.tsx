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
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-muted-foreground text-sm">
            No activity yet
          </div>
        </CardContent>
      </Card>
    );
  }

  const getSystemEventIcon = (action: string) => {
    switch (action) {
      case "create":
        return <Plus className="h-3 w-3" />;
      case "resolve":
        return <Gavel className="h-3 w-3" />;
      default:
        return <Activity className="h-3 w-3" />;
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
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {activity.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between p-2 rounded-lg bg-muted/30 text-sm"
            >
              {item.type === "bet" ? (
                <>
                  <div className="flex items-center gap-2">
                    {item.outcome === "yes" ? (
                      <TrendingUp className="h-4 w-4 text-green-600" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-600" />
                    )}
                    <Badge
                      variant="outline"
                      className={
                        item.outcome === "yes"
                          ? "bg-green-500/10 text-green-600 border-green-500/30"
                          : "bg-red-500/10 text-red-600 border-red-500/30"
                      }
                    >
                      {item.outcome?.toUpperCase()}
                    </Badge>
                    <span className="text-muted-foreground">
                      @ {item.odds_at_placement?.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <Coins className="h-3 w-3 text-yellow-600" />
                      <span>{item.net_stake?.toLocaleString()}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(item.created_at), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="p-1 rounded bg-primary/10 text-primary">
                      {getSystemEventIcon(item.action || "")}
                    </span>
                    <span className="text-muted-foreground">
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
