import { MarketsPanel } from "@/components/markets/MarketsPanel";
import { AppHeader } from "@/components/AppHeader";
import { Info, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const Markets = () => {
  return (
    <div className="min-h-screen bg-background" style={{ paddingBottom: 'var(--safe-area-bottom)' }}>
      <AppHeader />
      <main className="container max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* Premium Header */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">Prediction Markets</h1>
            <Badge variant="secondary" className="text-[10px] h-5">BETA</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Bet with Ticket Coins on match outcomes. No real money.
          </p>
        </div>

        {/* Store Compliance Disclaimer - Compact */}
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 border border-border/50">
          <Info className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <p className="text-[11px] text-muted-foreground">
            <strong>Virtual coins only.</strong> Skill-based game. No real money. Coins cannot be exchanged for cash.
          </p>
        </div>

        <MarketsPanel />
      </main>
    </div>
  );
};

export default Markets;
