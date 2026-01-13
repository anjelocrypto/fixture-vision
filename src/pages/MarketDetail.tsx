import { useParams, useNavigate } from "react-router-dom";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useMarketWithFixture, useMarketAggregates, useMyMarketPositions, useMarketActivity, useMarketChart } from "@/hooks/useMarketDetail";
import { useMyCoins } from "@/hooks/useMarkets";
import { MarketHeader } from "@/components/markets/detail/MarketHeader";
import { StatsBar } from "@/components/markets/detail/StatsBar";
import { YesNoDistribution } from "@/components/markets/detail/YesNoDistribution";
import { BetPanel } from "@/components/markets/detail/BetPanel";
import { OddsChart } from "@/components/markets/detail/OddsChart";
import { YourPosition } from "@/components/markets/detail/YourPosition";
import { ActivityFeed } from "@/components/markets/detail/ActivityFeed";

const MarketDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: market, isLoading: marketLoading } = useMarketWithFixture(id || null);
  const { data: aggregates, isLoading: aggregatesLoading } = useMarketAggregates(id || null);
  const { data: myPositions } = useMyMarketPositions(id || null);
  const { data: activity } = useMarketActivity(id || null);
  const { data: chartData } = useMarketChart(id || null);
  const { data: coins } = useMyCoins();

  if (marketLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="container max-w-6xl mx-auto p-4 sm:p-6">
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </main>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="container max-w-6xl mx-auto p-4 sm:p-6">
          <div className="text-center py-20">
            <h1 className="text-2xl font-bold text-foreground mb-2">Market Not Found</h1>
            <p className="text-muted-foreground mb-4">The market you're looking for doesn't exist.</p>
            <Button onClick={() => navigate("/markets")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Markets
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const isOpen = market.status === "open";

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container max-w-6xl mx-auto p-4 sm:p-6">
        {/* Back Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/markets")}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          All Markets
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Market Header */}
            <MarketHeader market={market} />

            {/* Stats Bar */}
            <StatsBar aggregates={aggregates} isLoading={aggregatesLoading} />

            {/* YES/NO Distribution */}
            <YesNoDistribution aggregates={aggregates} />

            {/* Chart */}
            <OddsChart
              data={chartData || []}
              resolvedAt={market.resolved_at || undefined}
            />

            {/* Activity Feed */}
            <ActivityFeed activity={activity || []} />
          </div>

          {/* Right Column - Bet Panel & Position */}
          <div className="space-y-6">
            {/* Bet Panel - only if open */}
            {isOpen && (
              <BetPanel
                market={market}
                userBalance={coins?.balance ?? 0}
              />
            )}

            {/* Your Position */}
            <YourPosition positions={myPositions || []} market={market} />
          </div>
        </div>
      </main>
    </div>
  );
};

export default MarketDetail;
