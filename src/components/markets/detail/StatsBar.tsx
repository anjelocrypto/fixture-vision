import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Coins, BarChart3, Users } from "lucide-react";
import { MarketAggregates } from "@/hooks/useMarketDetail";
import { Skeleton } from "@/components/ui/skeleton";

interface StatsBarProps {
  aggregates: MarketAggregates | null | undefined;
  isLoading?: boolean;
}

export function StatsBar({ aggregates, isLoading }: StatsBarProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[...Array(5)].map((_, i) => (
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

  const totalPool = aggregates?.total_pool ?? 0;
  const yesStake = aggregates?.yes_stake ?? 0;
  const noStake = aggregates?.no_stake ?? 0;
  const yesPct = totalPool > 0 ? Math.round((yesStake / totalPool) * 100) : 50;
  const noPct = totalPool > 0 ? Math.round((noStake / totalPool) * 100) : 50;

  const stats = [
    {
      label: "Total Pool",
      value: aggregates?.total_pool ?? 0,
      icon: Coins,
      iconBg: "bg-amber-500/15",
      iconColor: "text-amber-500",
      suffix: " coins",
      description: "Volume",
    },
    {
      label: "Unique Traders",
      value: aggregates?.unique_traders ?? 0,
      icon: Users,
      iconBg: "bg-primary/15",
      iconColor: "text-primary",
      description: "Bettors",
    },
    {
      label: "Total Bets",
      value: aggregates?.total_positions ?? 0,
      icon: BarChart3,
      iconBg: "bg-primary/15",
      iconColor: "text-primary",
      description: "Positions",
    },
    {
      label: "YES Bets",
      value: yesStake,
      icon: TrendingUp,
      iconBg: "bg-emerald-500/15",
      iconColor: "text-emerald-500",
      suffix: ` (${yesPct}%)`,
    },
    {
      label: "NO Bets",
      value: noStake,
      icon: TrendingDown,
      iconBg: "bg-red-500/15",
      iconColor: "text-red-500",
      suffix: ` (${noPct}%)`,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {stats.map((stat) => {
        const IconComponent = stat.icon;
        return (
          <Card key={stat.label} className="border-border/50 bg-card/80 backdrop-blur-sm">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
                <span className={`p-1.5 rounded-lg ${stat.iconBg}`}>
                  <IconComponent className={`h-3 w-3 ${stat.iconColor}`} />
                </span>
                <span className="font-medium">{stat.label}</span>
              </div>
              <div className="text-lg sm:text-xl font-bold text-foreground">
                {stat.value.toLocaleString()}
                {stat.suffix && (
                  <span className="text-xs sm:text-sm font-medium text-muted-foreground ml-0.5">
                    {stat.suffix}
                  </span>
                )}
              </div>
              {stat.description && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {stat.description}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
