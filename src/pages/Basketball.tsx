import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { BasketballLeftRail } from "@/components/basketball/BasketballLeftRail";
import { BasketballSafeZonePanel } from "@/components/basketball/BasketballSafeZonePanel";
import { PaywallGate } from "@/components/PaywallGate";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Menu, Target } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Helmet } from "react-helmet-async";

const Basketball = () => {
  const isMobile = useIsMobile();
  const [selectedCompetition, setSelectedCompetition] = useState<string | null>("nba");
  const [leftSheetOpen, setLeftSheetOpen] = useState(false);

  return (
    <>
      <Helmet>
        <title>Basketball Points Safe Zone | TicketAI</title>
        <meta name="description" content="Basketball betting predictions - find high scoring games with Points Safe Zone rankings for NBA, EuroLeague, and more." />
      </Helmet>
      
      <div className="min-h-screen flex flex-col bg-background">
        <AppHeader />

        <div className="flex-1 flex overflow-hidden">
          {/* Desktop Left Rail */}
          <div className="hidden lg:flex">
            <BasketballLeftRail
              selectedCompetition={selectedCompetition}
              onSelectCompetition={(key) => setSelectedCompetition(key)}
            />
          </div>

          {/* Mobile Left Sheet */}
          <Sheet open={leftSheetOpen} onOpenChange={setLeftSheetOpen}>
            <SheetContent side="left" className="w-[280px] p-0 lg:hidden overflow-y-auto">
              <BasketballLeftRail
                selectedCompetition={selectedCompetition}
                onSelectCompetition={(key) => {
                  setSelectedCompetition(key);
                  setLeftSheetOpen(false);
                }}
              />
            </SheetContent>
          </Sheet>

          {/* Main Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="border-b border-border bg-card/30 backdrop-blur-sm p-3 sm:p-4 flex items-center justify-between shrink-0 gap-2">
              {/* Mobile menu button */}
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden shrink-0"
                onClick={() => setLeftSheetOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              
              <h2 className="text-base sm:text-xl font-semibold flex items-center gap-2">
                <Target className="h-5 w-5 text-orange-500" />
                Points Safe Zone
              </h2>
              
              <div className="shrink-0" />
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-6">
              <PaywallGate feature="Basketball Points Safe Zone" featureKey="bet_optimizer" allowTrial={true}>
                <div className="max-w-4xl mx-auto">
                  <BasketballSafeZonePanel selectedCompetition={selectedCompetition} />
                </div>
              </PaywallGate>
            </div>
          </div>

          {/* Right Rail Placeholder (empty for now) */}
          <div className="hidden lg:flex w-[300px] flex-col border-l border-border bg-card/20">
            <div className="p-6 text-center text-muted-foreground">
              <div className="text-4xl mb-4">🏀</div>
              <h3 className="font-semibold mb-2">Basketball Beta</h3>
              <p className="text-sm">
                More basketball features coming soon:
              </p>
              <ul className="text-xs mt-3 space-y-1 text-left list-disc list-inside">
                <li>Player Props Analysis</li>
                <li>Spread Predictions</li>
                <li>Quarter/Half Analysis</li>
                <li>Head-to-Head Stats</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Basketball;
