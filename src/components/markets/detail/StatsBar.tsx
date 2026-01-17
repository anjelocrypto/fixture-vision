import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Coins, BarChart3, Users } from "lucide-react";
import { MarketAggregates } from "@/hooks/useMarketDetail";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";

interface StatsBarProps {
  aggregates: MarketAggregates | null | undefined;
  isLoading?: boolean;
}

export function StatsBar({ aggregates, isLoading }: StatsBarProps) {
  const { t } = useTranslation("markets");

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

  // Normalize so yesPct + noPct = 100
  const normalizedNoPct = 100 - yesPct;

  const stats = [
    {
      label: t("stats.total_pool"),
      value: totalPool,
      icon: Coins,
      iconBg: "bg-amber-500/15",
      iconColor: "text-amber-500",
      suffix: ` ${t("stats.coins")}`,
    },
    {
      label: t("stats.unique_traders"),
      value: aggregates?.unique_traders ?? 0,
      icon: Users,
      iconBg: "bg-primary/15",
      iconColor: "text-primary",
    },
    {
      label: t("stats.total_bets"),
      value: aggregates?.total_positions ?? 0,
      icon: BarChart3,
      iconBg: "bg-primary/15",
      iconColor: "text-primary",
    },
    {
      label: t("stats.yes_pool"),
      value: yesStake,
      icon: TrendingUp,
      iconBg: "bg-emerald-500/15",
      iconColor: "text-emerald-500",
      suffix: ` (${yesPct}%)`,
    },
    {
      label: t("stats.no_pool"),
      value: noStake,
      icon: TrendingDown,
      iconBg: "bg-red-500/15",
      iconColor: "text-red-500",
      suffix: ` (${normalizedNoPct}%)`,
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
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
