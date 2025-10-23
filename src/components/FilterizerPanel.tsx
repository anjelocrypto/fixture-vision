import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Filter } from "lucide-react";

interface FilterizerPanelProps {
  onApplyFilters: (filters: FilterCriteria) => void;
  onClearFilters: () => void;
  isActive: boolean;
}

export interface FilterCriteria {
  markets: string[];
  thresholds: {
    goals?: number;
    cards?: number;
    corners?: number;
    fouls?: number;
    offsides?: number;
  };
  minEdge?: number;
  sortBy?: "edge" | "confidence" | "odds";
}

const MARKET_OPTIONS = [
  { id: "goals", label: "Goals", defaultThreshold: 2.5 },
  { id: "cards", label: "Cards", defaultThreshold: 4.0 },
  { id: "corners", label: "Corners", defaultThreshold: 10.0 },
  { id: "fouls", label: "Fouls", defaultThreshold: 24.0 },
  { id: "offsides", label: "Offsides", defaultThreshold: 3.0 },
];

export function FilterizerPanel({ onApplyFilters, onClearFilters, isActive }: FilterizerPanelProps) {
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([]);
  const [thresholds, setThresholds] = useState<Record<string, number>>({
    goals: 2.5,
    cards: 4.0,
    corners: 10.0,
    fouls: 24.0,
    offsides: 3.0,
  });
  const [minEdge, setMinEdge] = useState<number>(0);
  const [sortBy, setSortBy] = useState<"edge" | "confidence" | "odds">("edge");

  const handleMarketToggle = (marketId: string) => {
    setSelectedMarkets((prev) =>
      prev.includes(marketId)
        ? prev.filter((m) => m !== marketId)
        : [...prev, marketId]
    );
  };

  const handleThresholdChange = (marketId: string, value: number[]) => {
    setThresholds((prev) => ({
      ...prev,
      [marketId]: value[0],
    }));
  };

  const handleApply = () => {
    const filters: FilterCriteria = {
      markets: selectedMarkets,
      thresholds: Object.fromEntries(
        Object.entries(thresholds).filter(([key]) => selectedMarkets.includes(key))
      ),
      minEdge,
      sortBy,
    };
    onApplyFilters(filters);
  };

  const handleClear = () => {
    setSelectedMarkets([]);
    setThresholds({
      goals: 2.5,
      cards: 4.0,
      corners: 10.0,
      fouls: 24.0,
      offsides: 3.0,
    });
    setMinEdge(0);
    setSortBy("edge");
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
        {MARKET_OPTIONS.map((market) => (
          <div key={market.id} className="space-y-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id={market.id}
                checked={selectedMarkets.includes(market.id)}
                onCheckedChange={() => handleMarketToggle(market.id)}
              />
              <Label htmlFor={market.id} className="font-medium cursor-pointer">
                {market.label}
              </Label>
            </div>
            
            {selectedMarkets.includes(market.id) && (
              <div className="ml-6 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Combined Avg ≥</span>
                  <span className="font-bold text-primary tabular-nums">
                    {thresholds[market.id].toFixed(1)}
                  </span>
                </div>
                <Slider
                  value={[thresholds[market.id]]}
                  onValueChange={(value) => handleThresholdChange(market.id, value)}
                  min={0}
                  max={market.id === "goals" ? 5 : market.id === "cards" ? 8 : market.id === "corners" ? 20 : market.id === "fouls" ? 40 : 6}
                  step={0.1}
                  className="w-full"
                />
              </div>
            )}
          </div>
        ))}

        {/* Min Edge Filter */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Min Edge (%)</Label>
            <span className="text-sm font-semibold text-primary">{minEdge}%</span>
          </div>
          <Slider
            value={[minEdge]}
            onValueChange={(value) => setMinEdge(value[0])}
            min={0}
            max={10}
            step={0.5}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span>5%</span>
            <span>10%</span>
          </div>
        </div>

        {/* Sort Options */}
        <div className="space-y-3 pt-4 border-t">
          <Label className="text-sm font-medium">Sort By</Label>
          <div className="grid grid-cols-3 gap-2">
            {(["edge", "confidence", "odds"] as const).map((option) => (
              <Button
                key={option}
                variant={sortBy === option ? "default" : "outline"}
                size="sm"
                onClick={() => setSortBy(option)}
                className="capitalize"
              >
                {option}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-4">
          <Button 
            onClick={handleApply} 
            className="flex-1"
            disabled={selectedMarkets.length === 0}
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
