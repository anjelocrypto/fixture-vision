import { MarketsPanel } from "@/components/markets/MarketsPanel";
import { AppHeader } from "@/components/AppHeader";
import { Info } from "lucide-react";

const Markets = () => {
  return (
    <div className="min-h-screen bg-background" style={{ paddingBottom: 'var(--safe-area-bottom)' }}>
      <AppHeader />
      <main className="container max-w-4xl mx-auto p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Prediction Markets</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Bet with Ticket Coins on match outcomes. No real money involved.
          </p>
          {/* Store Compliance Disclaimer */}
          <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-muted/50 border border-border">
            <Info className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              <strong>Virtual coins only.</strong> This is a skill-based prediction game using virtual currency. 
              No real money gambling. Coins cannot be purchased or exchanged for cash.
            </p>
          </div>
        </div>
        <MarketsPanel />
      </main>
    </div>
  );
};

export default Markets;
