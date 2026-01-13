import { MarketsPanel } from "@/components/markets/MarketsPanel";
import { AppHeader } from "@/components/AppHeader";

const Markets = () => {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container max-w-4xl mx-auto p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Prediction Markets</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Bet with Ticket Coins on match outcomes. No real money involved.
          </p>
        </div>
        <MarketsPanel />
      </main>
    </div>
  );
};

export default Markets;
