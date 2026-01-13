import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Coins, BarChart3 } from "lucide-react";
import { MarketAggregates } from "@/hooks/useMarketDetail";
import { Skeleton } from "@/components/ui/skeleton";

interface StatsBarProps {
  aggregates: MarketAggregates | null | undefined;
  isLoading?: boolean;
}

export function StatsBar({ aggregates, isLoading }: StatsBarProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="border-border/50 bg-card/80">
            <CardContent className="p-4">
              <Skeleton className="h-4 w-16 mb-2" />
              <Skeleton className="h-7 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const stats = [
    {
      label: "Total Votes",
      value: aggregates?.total_votes ?? 0,
      icon: BarChart3,
      iconBg: "bg-primary/15",
      iconColor: "text-primary",
    },
    {
      label: "YES Votes",
      value: aggregates?.yes_votes ?? 0,
      icon: TrendingUp,
      iconBg: "bg-emerald-500/15",
      iconColor: "text-emerald-500",
    },
    {
      label: "NO Votes",
      value: aggregates?.no_votes ?? 0,
      icon: TrendingDown,
      iconBg: "bg-red-500/15",
      iconColor: "text-red-500",
    },
    {
      label: "Total Pool",
      value: aggregates?.total_pool ?? 0,
      icon: Coins,
      iconBg: "bg-amber-500/15",
      iconColor: "text-amber-500",
      suffix: " coins",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat) => {
        const IconComponent = stat.icon;
        return (
          <Card key={stat.label} className="border-border/50 bg-card/80 backdrop-blur-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <span className={`p-1.5 rounded-lg ${stat.iconBg}`}>
                  <IconComponent className={`h-3.5 w-3.5 ${stat.iconColor}`} />
                </span>
                <span className="font-medium">{stat.label}</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {stat.value.toLocaleString()}
                {stat.suffix && (
                  <span className="text-sm font-medium text-muted-foreground ml-1">
                    {stat.suffix}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
