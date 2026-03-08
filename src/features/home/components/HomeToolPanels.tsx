import { FilterizerPanel, FilterCriteria } from "@/components/FilterizerPanel";
import { WinnerPanel } from "@/components/WinnerPanel";
import { TeamTotalsPanel } from "@/components/TeamTotalsPanel";
import { WhoConcedesPanel } from "@/components/WhoConcedesPanel";
import { CardWarPanel } from "@/components/CardWarPanel";
import { BTTSIndexPanel } from "@/components/BTTSIndexPanel";
import { SafeZonePanel } from "@/components/SafeZonePanel";

interface HomeToolPanelsProps {
  showFilterizer: boolean;
  showWinner: boolean;
  showTeamTotals: boolean;
  showWhoConcedes: boolean;
  showCardWar: boolean;
  showBTTSIndex: boolean;
  showSafeZone: boolean;
  setShowFilterizer: (v: boolean) => void;
  setShowWinner: (v: boolean) => void;
  setShowTeamTotals: (v: boolean) => void;
  setShowWhoConcedes: (v: boolean) => void;
  setShowCardWar: (v: boolean) => void;
  setShowBTTSIndex: (v: boolean) => void;
  setShowSafeZone: (v: boolean) => void;
  onApplyFilters: (filters: FilterCriteria) => void;
  onClearFilters: () => void;
  filterCriteria: FilterCriteria | null;
}

export function HomeToolPanels({
  showFilterizer, showWinner, showTeamTotals, showWhoConcedes,
  showCardWar, showBTTSIndex, showSafeZone,
  setShowFilterizer, setShowWinner, setShowTeamTotals, setShowWhoConcedes,
  setShowCardWar, setShowBTTSIndex, setShowSafeZone,
  onApplyFilters, onClearFilters, filterCriteria,
}: HomeToolPanelsProps) {
  return (
    <>
      {showFilterizer && (
        <FilterizerPanel
          onApplyFilters={onApplyFilters}
          onClearFilters={onClearFilters}
          isActive={!!filterCriteria}
        />
      )}
      {showWinner && <WinnerPanel onClose={() => setShowWinner(false)} />}
      {showTeamTotals && <TeamTotalsPanel onClose={() => setShowTeamTotals(false)} />}
      {showWhoConcedes && <WhoConcedesPanel onClose={() => setShowWhoConcedes(false)} />}
      {showCardWar && <CardWarPanel onClose={() => setShowCardWar(false)} />}
      {showBTTSIndex && <BTTSIndexPanel onClose={() => setShowBTTSIndex(false)} />}
      {showSafeZone && <SafeZonePanel onClose={() => setShowSafeZone(false)} />}
    </>
  );
}
