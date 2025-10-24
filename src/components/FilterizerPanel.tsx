import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { X, Filter } from "lucide-react";

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
}

// Rules-based lines from _shared/rules.ts
const MARKET_OPTIONS = [
  { 
    id: "goals", 
    label: "Goals", 
    lines: [0.5, 1.5, 2.5, 3.5, 4.5, 5.5] 
  },
  { 
    id: "corners", 
    label: "Corners", 
    lines: [7.5, 8.5, 9.5, 10.5, 12.0, 12.5, 13.5] 
  },
  { 
    id: "cards", 
    label: "Cards", 
    lines: [1.5, 2.5, 3.5, 4.5, 5.5] 
  },
  { 
    id: "fouls", 
    label: "Fouls", 
    lines: [16.5, 19.5, 20.5, 23.5, 24.5] 
  },
  { 
    id: "offsides", 
    label: "Offsides", 
    lines: [1.5, 2.5, 3.5, 4.5] 
  },
];

export function FilterizerPanel({ onApplyFilters, onClearFilters, isActive }: FilterizerPanelProps) {
  const [selectedMarket, setSelectedMarket] = useState<string>("goals");
  const [selectedLine, setSelectedLine] = useState<number>(2.5);
  const [minOdds, setMinOdds] = useState<number>(1.50);

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
    };
    onApplyFilters(filters);
  };

  const handleClear = () => {
    setSelectedMarket("goals");
    setSelectedLine(2.5);
    setMinOdds(1.50);
    onClearFilters();
  };

  return (
    <Card className="p-6 mb-4 bg-card/50 backdrop-blur-sm border-primary/20">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Filterizer</h3>
          {isActive && (
            <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded-full">
              Active
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
          <Label className="text-sm font-medium">Select Market</Label>
          <div className="grid grid-cols-2 gap-2">
            {MARKET_OPTIONS.map((market) => (
              <Button
                key={market.id}
                variant={selectedMarket === market.id ? "default" : "outline"}
                size="sm"
                onClick={() => handleMarketSelect(market.id)}
                className="capitalize"
              >
                {market.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Line Selection (Pills) */}
        {currentMarketOption && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">Select Line (Over)</Label>
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
            <Label className="text-sm font-medium">Min Odds</Label>
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
        </div>

        <div className="flex gap-2 pt-4">
          <Button 
            onClick={handleApply} 
            className="flex-1"
          >
            Apply Filters
          </Button>
          <Button variant="outline" onClick={handleClear} className="flex-1">
            Clear
          </Button>
        </div>
      </div>
    </Card>
  );
}
