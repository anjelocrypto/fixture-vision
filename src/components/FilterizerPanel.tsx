import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { X, Filter } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatMarketLabel } from "@/lib/i18nFormatters";
import { InfoTooltip } from "@/components/shared/InfoTooltip";

interface FilterizerPanelProps {
  onApplyFilters: (filters: FilterCriteria) => void;
  onClearFilters: () => void;
  isActive: boolean;
}

export interface FilterCriteria {
  market: string;
  side: "over" | "under"; // currently fixed to 'over' in UI
  line: number;
  minOdds: number;
  showAllOdds: boolean; // NEW: show all bookmaker odds
  includeModelOnly?: boolean; // NEW: include picks without odds (model-only)
}

// Rules-based lines from _shared/rules.ts
// NOTE: Fouls and Offsides are DISABLED in odds-based flows (API-Football doesn't provide odds)
const MARKET_OPTIONS = [
  { 
    id: "goals", 
    label: "Goals", 
    lines: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5] 
  },
  { 
    id: "corners", 
    label: "Corners", 
    lines: [7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5] // FIXED: 12.0 → 11.5 per sheet
  },
  { 
    id: "cards", 
    label: "Cards", 
    lines: [1.5, 2.5, 3.5, 4.5, 5.5] 
  },
  // Fouls and Offsides are DISABLED (no odds available in API-Football)
  // They can remain in stats panels but should not appear in Filterizer/Ticket Creator
];

export function FilterizerPanel({ onApplyFilters, onClearFilters, isActive }: FilterizerPanelProps) {
  const { t, i18n } = useTranslation(['filterizer']);
  const [selectedMarket, setSelectedMarket] = useState<string>("goals");
  const [selectedLine, setSelectedLine] = useState<number>(2.5);
  const [minOdds, setMinOdds] = useState<number>(1.50);
  const [includeModelOnly, setIncludeModelOnly] = useState<boolean>(true); // Default ON

  const currentMarketOption = MARKET_OPTIONS.find(m => m.id === selectedMarket);

  const handleMarketSelect = (marketId: string) => {
    setSelectedMarket(marketId);
    const market = MARKET_OPTIONS.find(m => m.id === marketId);
    if (market) {
      setSelectedLine(market.lines[0]);
    }
  };

  const handleApply = () => {
    const filters: FilterCriteria = {
      market: selectedMarket,
      side: "over",
      line: selectedLine,
      minOdds,
      showAllOdds: false, // Always use best per match mode
      includeModelOnly,
    };
    onApplyFilters(filters);
  };

  const handleClear = () => {
    setSelectedMarket("goals");
    setSelectedLine(2.5);
    setMinOdds(1.50);
    setIncludeModelOnly(true);
    onClearFilters();
  };

  return (
    <Card className="p-6 mb-4 bg-card/50 backdrop-blur-sm border-primary/20">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">{t('filterizer:title')}</h3>
          <InfoTooltip tooltipKey="filterizer" />
          {isActive && (
            <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded-full">
              {t('filterizer:active')}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={handleClear}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-6">
        {/* Market Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">{t('filterizer:select_market')}</Label>
          <div className="grid grid-cols-2 gap-2">
            {MARKET_OPTIONS.map((market) => (
              <Button
                key={market.id}
                variant={selectedMarket === market.id ? "default" : "outline"}
                size="sm"
                onClick={() => handleMarketSelect(market.id)}
                className="capitalize"
              >
                {formatMarketLabel(market.label, i18n.language)}
              </Button>
            ))}
          </div>
        </div>

        {/* Line Selection (Pills) */}
        {currentMarketOption && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">{t('filterizer:select_line')}</Label>
            <div className="flex flex-wrap gap-2">
              {currentMarketOption.lines.map((line) => (
                <Badge
                  key={line}
                  variant={selectedLine === line ? "default" : "outline"}
                  className="cursor-pointer px-3 py-1.5"
                  onClick={() => setSelectedLine(line)}
                >
                  {line}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Min Odds Slider */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">{t('filterizer:min_odds')}</Label>
            <span className="text-sm font-semibold text-primary tabular-nums">
              {minOdds.toFixed(2)}
            </span>
          </div>
          <Slider
            value={[minOdds]}
            onValueChange={(value) => setMinOdds(value[0])}
            min={1.10}
            max={3.00}
            step={0.05}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>1.10</span>
            <span>2.00</span>
            <span>3.00</span>
          </div>
          {includeModelOnly && (
            <p className="text-xs text-muted-foreground">
              Min odds applies to priced picks only; model-only picks always show.
            </p>
          )}
        </div>

        {/* Model-Only Toggle */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Include model-only picks</Label>
              <p className="text-xs text-muted-foreground">
                Show picks without bookmaker odds (find prices manually)
              </p>
            </div>
            <Button
              type="button"
              variant={includeModelOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setIncludeModelOnly(!includeModelOnly)}
              className="shrink-0"
            >
              {includeModelOnly ? "ON" : "OFF"}
            </Button>
          </div>
        </div>

        <div className="flex gap-2 pt-4">
          <Button 
            onClick={handleApply} 
            className="flex-1"
          >
            {t('filterizer:apply_filters')}
          </Button>
          <Button variant="outline" onClick={handleClear} className="flex-1">
            {t('filterizer:clear')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
