import { AppHeader } from "@/components/AppHeader";
import { LeftRail } from "@/components/LeftRail";
import { CenterRail } from "@/components/CenterRail";
import { SelectionsDisplay } from "@/components/SelectionsDisplay";
import { TicketDrawer } from "@/components/TicketDrawer";
import { TicketCreatorDialog } from "@/components/TicketCreatorDialog";
import { PremiumUpgradeHero } from "@/components/PremiumUpgradeHero";
import { SafeZoneBotButton } from "@/components/SafeZoneBot/SafeZoneBotButton";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRegisterOverlay } from "@/hooks/useRegisterOverlay";
import { useTranslation } from "react-i18next";

import { useHomeState } from "@/features/home/hooks/useHomeState";
import { useHomeActions } from "@/features/home/hooks/useHomeActions";
import {
  MobileHomeToolbar,
  MobileQuickActions,
  MobileFixturesList,
  MobileToolSheet,
  DesktopToolSidebar,
  HomeToolPanels,
} from "@/features/home/components";

const Index = () => {
  const state = useHomeState();
  const actions = useHomeActions(state);
  const isMobile = useIsMobile();
  const { t } = useTranslation(['common']);

  const {
    hasPaidAccess, isAdmin,
    selectedCountry, setSelectedCountry,
    selectedDate, setSelectedDate,
    selectedLeague, setSelectedLeague,
    actualCountries, leagues, fixtures, loadingFixtures,
    analysis, valueAnalysis, loadingAnalysis,
    currentTicket, generatingTicket,
    leftSheetOpen, setLeftSheetOpen,
    rightSheetOpen, setRightSheetOpen,
    ticketDrawerOpen, setTicketDrawerOpen,
    ticketCreatorOpen, setTicketCreatorOpen,
    showFilterizer, setShowFilterizer,
    showWinner, setShowWinner,
    showTeamTotals, setShowTeamTotals,
    showWhoConcedes, setShowWhoConcedes,
    showCardWar, setShowCardWar,
    showBTTSIndex, setShowBTTSIndex,
    showSafeZone, setShowSafeZone,
    showDailyInsights, setShowDailyInsights,
    openToolExclusive,
    filterCriteria, filteredFixtures,
    filterizerHasMore, loadingMoreFilterizer, filterizerTotalQualified,
    prefetchLeagues, lastTicketParams, toast,
  } = state;

  // Register overlays for Android back-button
  useRegisterOverlay("index-left-sheet", leftSheetOpen, () => setLeftSheetOpen(false));
  useRegisterOverlay("index-right-sheet", rightSheetOpen, () => setRightSheetOpen(false));
  useRegisterOverlay("index-ticket-drawer", ticketDrawerOpen, () => setTicketDrawerOpen(false));
  useRegisterOverlay("index-ticket-creator", ticketCreatorOpen, () => setTicketCreatorOpen(false));

  const toolStates: Record<string, boolean> = {
    filterizer: showFilterizer, winner: showWinner, teamTotals: showTeamTotals,
    whoConcedes: showWhoConcedes, cardWar: showCardWar, bttsIndex: showBTTSIndex, safeZone: showSafeZone,
  };

  return (
    <div className="h-dvh flex flex-col">
      <AppHeader />

      <div className="flex flex-1 overflow-hidden relative">
        {/* Desktop Left Rail */}
        <div className="hidden lg:block">
          <LeftRail
            countries={actualCountries}
            selectedCountry={selectedCountry}
            onSelectCountry={(id) => { setSelectedCountry(id); setLeftSheetOpen(false); }}
            leagues={leagues}
            selectedLeague={selectedLeague}
            onSelectLeague={(league) => { setSelectedLeague(league); setLeftSheetOpen(false); }}
            leaguesLoading={false}
            leaguesError={false}
            onCountryHover={prefetchLeagues}
          />
        </div>

        {/* Mobile Left Sheet */}
        <Sheet open={leftSheetOpen} onOpenChange={setLeftSheetOpen}>
          <SheetContent side="left" className="p-0 lg:hidden overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto">
              <LeftRail
                countries={actualCountries}
                selectedCountry={selectedCountry}
                onSelectCountry={(id) => { setSelectedCountry(id); setLeftSheetOpen(false); }}
                leagues={leagues}
                selectedLeague={selectedLeague}
                onSelectLeague={(league) => { setSelectedLeague(league); setLeftSheetOpen(false); }}
                leaguesLoading={false}
                leaguesError={false}
                onCountryHover={prefetchLeagues}
              />
            </div>
          </SheetContent>
        </Sheet>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <MobileHomeToolbar
            isAdmin={isAdmin}
            filterCriteria={filterCriteria}
            onOpenLeftSheet={() => setLeftSheetOpen(true)}
            onOpenRightSheet={() => setRightSheetOpen(true)}
          />

          <div
            className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4"
            style={{ paddingBottom: 'calc(var(--safe-area-bottom) + 100px)' }}
          >
            {!hasPaidAccess ? (
              <PremiumUpgradeHero />
            ) : (
              <>
                {/* Mobile Quick Actions */}
                <MobileQuickActions
                  onOpenTicketCreator={() => setTicketCreatorOpen(true)}
                  onOpenTools={() => setRightSheetOpen(true)}
                />

                {/* Tool Panels (shared mobile+desktop) */}
                <HomeToolPanels
                  showFilterizer={showFilterizer}
                  showWinner={showWinner}
                  showTeamTotals={showTeamTotals}
                  showWhoConcedes={showWhoConcedes}
                  showCardWar={showCardWar}
                  showBTTSIndex={showBTTSIndex}
                  showSafeZone={showSafeZone}
                  showDailyInsights={showDailyInsights}
                  setShowFilterizer={setShowFilterizer}
                  setShowWinner={setShowWinner}
                  setShowTeamTotals={setShowTeamTotals}
                  setShowWhoConcedes={setShowWhoConcedes}
                  setShowCardWar={setShowCardWar}
                  setShowBTTSIndex={setShowBTTSIndex}
                  setShowSafeZone={setShowSafeZone}
                  setShowDailyInsights={setShowDailyInsights}
                  onApplyFilters={actions.handleApplyFilters}
                  onClearFilters={actions.handleClearFilters}
                  filterCriteria={filterCriteria}
                />

                {filterCriteria ? (
                  <>
                    <SelectionsDisplay
                      selections={filteredFixtures}
                      onSelectionClick={(selection) => {
                        toast({
                          title: "Selection Details",
                          description: `${selection.market} ${selection.side} ${selection.line} @ ${selection.odds}`,
                        });
                      }}
                    />
                    {filterizerHasMore && (
                      <div className="flex justify-center py-6">
                        <Button
                          variant="outline"
                          onClick={actions.handleLoadMoreFilterizer}
                          disabled={loadingMoreFilterizer}
                          className="gap-2"
                        >
                          {loadingMoreFilterizer
                            ? t('common:loading_more')
                            : `${t('common:load_more')} (${t('common:remaining', { count: filterizerTotalQualified - filteredFixtures.length })})`}
                        </Button>
                      </div>
                    )}
                  </>
                ) : isMobile ? (
                  <MobileFixturesList
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
                    league={selectedLeague}
                    fixtures={fixtures}
                    loading={loadingFixtures}
                    onAnalyze={actions.handleAnalyze}
                  />
                ) : (
                  <CenterRail
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
                    league={selectedLeague}
                    fixtures={fixtures}
                    loading={loadingFixtures}
                    onAnalyze={actions.handleAnalyze}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* Desktop Right Rail */}
        {hasPaidAccess && (
          <DesktopToolSidebar
            analysis={analysis}
            loadingAnalysis={loadingAnalysis}
            valueAnalysis={valueAnalysis}
            onAddToTicket={(market) => {
              toast({ title: "Market added", description: `${market.market} ${market.side} ${market.line} added` });
            }}
            onOpenTicketCreator={() => setTicketCreatorOpen(true)}
            openToolExclusive={openToolExclusive}
            toolStates={toolStates}
          />
        )}

        {/* Mobile Right Sheet */}
        <MobileToolSheet
          open={rightSheetOpen}
          onOpenChange={setRightSheetOpen}
          hasPaidAccess={hasPaidAccess}
          analysis={analysis}
          loadingAnalysis={loadingAnalysis}
          valueAnalysis={valueAnalysis}
          onAddToTicket={(market) => {
            toast({ title: "Market added", description: `${market.market} ${market.side} ${market.line} added` });
          }}
          onOpenTicketCreator={() => setTicketCreatorOpen(true)}
          openToolExclusive={openToolExclusive}
          toolStates={toolStates}
        />
      </div>

      {/* Ticket Creator Dialog */}
      {hasPaidAccess && (
        <TicketCreatorDialog
          open={ticketCreatorOpen}
          onOpenChange={setTicketCreatorOpen}
          onGenerate={actions.generateAITicket}
        />
      )}

      <TicketDrawer
        open={ticketDrawerOpen}
        onOpenChange={setTicketDrawerOpen}
        ticket={currentTicket}
        loading={generatingTicket}
        onShuffle={actions.shuffleTicket}
        canShuffle={!!lastTicketParams && currentTicket?.mode !== "near-miss"}
      />

      <SafeZoneBotButton />
    </div>
  );
};

export default Index;
