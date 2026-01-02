import { useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { BasketballLeftRail } from "@/components/basketball/BasketballLeftRail";
import { BasketballCenterRail } from "@/components/basketball/BasketballCenterRail";
import { BasketballSafeZonePanel } from "@/components/basketball/BasketballSafeZonePanel";
import { BasketballFixtureAnalyzer } from "@/components/basketball/BasketballFixtureAnalyzer";
import { PaywallGate } from "@/components/PaywallGate";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Menu, Target, Calendar, ChartBar } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Helmet } from "react-helmet-async";
import type { BasketballGame } from "@/hooks/useBasketballFixtures";

type ViewMode = "calendar" | "safezone";

const Basketball = () => {
  const isMobile = useIsMobile();
  const [selectedCompetition, setSelectedCompetition] = useState<string | null>("nba");
  const [leftSheetOpen, setLeftSheetOpen] = useState(false);
  const [rightSheetOpen, setRightSheetOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");
  const [selectedDate, setSelectedDate] = useState<"today" | "tomorrow">("today");
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);

  const handleAnalyze = (game: BasketballGame) => {
    setSelectedGameId(game.id);
    if (isMobile) {
      setRightSheetOpen(true);
    }
  };

  const handleCompetitionChange = (key: string | null) => {
    setSelectedCompetition(key);
    setSelectedGameId(null); // Clear selection when league changes
  };

  return (
    <>
      <Helmet>
        <title>Basketball Betting Analysis | TicketAI</title>
        <meta name="description" content="Basketball betting predictions - analyze games, view team stats, and find high scoring matchups for NBA, EuroLeague, and more." />
      </Helmet>
      
      <div className="min-h-screen flex flex-col bg-background">
        <AppHeader />

        <div className="flex-1 flex overflow-hidden">
          {/* Desktop Left Rail */}
          <div className="hidden lg:flex">
            <BasketballLeftRail
              selectedCompetition={selectedCompetition}
              onSelectCompetition={handleCompetitionChange}
            />
          </div>

          {/* Mobile Left Sheet */}
          <Sheet open={leftSheetOpen} onOpenChange={setLeftSheetOpen}>
            <SheetContent side="left" className="w-[280px] p-0 lg:hidden overflow-y-auto">
              <BasketballLeftRail
                selectedCompetition={selectedCompetition}
                onSelectCompetition={(key) => {
                  handleCompetitionChange(key);
                  setLeftSheetOpen(false);
                }}
              />
            </SheetContent>
          </Sheet>

          {/* Main Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header with Mode Toggle */}
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
              
              {/* Mode Toggle */}
              <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
                <Button
                  variant={viewMode === "calendar" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("calendar")}
                  className="gap-1.5"
                >
                  <Calendar className="h-4 w-4" />
                  <span className="hidden sm:inline">Fixtures</span>
                </Button>
                <Button
                  variant={viewMode === "safezone" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("safezone")}
                  className="gap-1.5"
                >
                  <Target className="h-4 w-4" />
                  <span className="hidden sm:inline">Safe Zone</span>
                </Button>
              </div>
              
              {/* Right sheet trigger on mobile */}
              {isMobile && viewMode === "calendar" && selectedGameId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRightSheetOpen(true)}
                  className="shrink-0"
                >
                  <ChartBar className="h-4 w-4 mr-1" />
                  Analysis
                </Button>
              )}
              {!isMobile && <div className="shrink-0 w-10" />}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden flex">
              <PaywallGate feature="Basketball Analysis" featureKey="bet_optimizer" allowTrial={true}>
                {viewMode === "safezone" ? (
                  <div className="flex-1 overflow-y-auto p-3 sm:p-6">
                    <div className="max-w-4xl mx-auto">
                      <BasketballSafeZonePanel selectedCompetition={selectedCompetition} />
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Center Rail - Fixtures Calendar */}
                    <div className="flex-1 overflow-hidden border-r border-border lg:max-w-md">
                      <BasketballCenterRail
                        selectedCompetition={selectedCompetition}
                        selectedDate={selectedDate}
                        onSelectDate={setSelectedDate}
                        onAnalyze={handleAnalyze}
                        selectedGameId={selectedGameId}
                      />
                    </div>

                    {/* Right Rail - Fixture Analyzer (Desktop) */}
                    <div className="hidden lg:flex flex-1 overflow-hidden">
                      <BasketballFixtureAnalyzer gameId={selectedGameId} />
                    </div>
                  </>
                )}
              </PaywallGate>
            </div>
          </div>
        </div>

        {/* Mobile Right Sheet - Analyzer */}
        <Sheet open={rightSheetOpen} onOpenChange={setRightSheetOpen}>
          <SheetContent side="right" className="w-full sm:w-[400px] p-0 overflow-y-auto">
            <BasketballFixtureAnalyzer gameId={selectedGameId} />
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
};

export default Basketball;
