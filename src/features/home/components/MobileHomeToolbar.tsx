import { Button } from "@/components/ui/button";
import { Menu, BarChart3 } from "lucide-react";
import { AdminRefreshButton } from "@/components/AdminRefreshButton";
import { useTranslation } from "react-i18next";
import { formatMarketLabel } from "@/lib/i18nFormatters";
import type { FilterCriteria } from "@/components/FilterizerPanel";

interface MobileHomeToolbarProps {
  isAdmin: boolean;
  filterCriteria: FilterCriteria | null;
  onOpenLeftSheet: () => void;
  onOpenRightSheet: () => void;
}

export function MobileHomeToolbar({ isAdmin, filterCriteria, onOpenLeftSheet, onOpenRightSheet }: MobileHomeToolbarProps) {
  const { t, i18n } = useTranslation(['common', 'fixtures', 'filterizer', 'optimizer']);

  return (
    <div className="border-b border-border bg-card/30 backdrop-blur-sm p-2 sm:p-4 flex items-center justify-between shrink-0 gap-2">
      {/* Mobile menu button */}
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden shrink-0 h-9 w-9"
        onClick={onOpenLeftSheet}
      >
        <Menu className="h-5 w-5" />
      </Button>
      
      <h2 className="text-sm sm:text-xl font-semibold truncate flex-1 text-center lg:text-left">
        {filterCriteria 
          ? `${t('optimizer:title')}: ${formatMarketLabel(filterCriteria.market, i18n.language)} ${t('filterizer:select_line').split('(')[0].trim()} ${filterCriteria.line}` 
          : t('fixtures:all_fixtures')}
      </h2>
      
      <div className="flex gap-2 shrink-0 items-center">
        {isAdmin && <div className="hidden sm:block"><AdminRefreshButton /></div>}
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden shrink-0 h-9 w-9"
          onClick={onOpenRightSheet}
        >
          <BarChart3 className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}
