import { Card, CardContent } from "@/components/ui/card";
import { Users, TrendingUp, TrendingDown, Coins, BarChart3 } from "lucide-react";
import { MarketAggregates } from "@/hooks/useMarketDetail";
import { Skeleton } from "@/components/ui/skeleton";

interface StatsBarProps {
  aggregates: MarketAggregates | null | undefined;
  isLoading?: boolean;
}

export function StatsBar({ aggregates, isLoading }: StatsBarProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-4 w-16 mb-2" />
              <Skeleton className="h-6 w-12" />
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
      icon: <BarChart3 className="h-4 w-4" />,
      color: "text-primary",
    },
    {
      label: "YES Votes",
      value: aggregates?.yes_votes ?? 0,
      icon: <TrendingUp className="h-4 w-4" />,
      color: "text-green-600",
    },
    {
      label: "NO Votes",
      value: aggregates?.no_votes ?? 0,
      icon: <TrendingDown className="h-4 w-4" />,
      color: "text-red-600",
    },
    {
      label: "Total Pool",
      value: aggregates?.total_pool ?? 0,
      icon: <Coins className="h-4 w-4" />,
      color: "text-yellow-600",
      suffix: " coins",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <span className={stat.color}>{stat.icon}</span>
              {stat.label}
            </div>
            <div className="text-xl font-bold">
              {stat.value.toLocaleString()}
              {stat.suffix && (
                <span className="text-sm font-normal text-muted-foreground">
                  {stat.suffix}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
