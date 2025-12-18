import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkles } from "lucide-react";
import { DEMO_SELECTIONS, DemoSelection } from "@/config/demoSelections";

interface DemoTicketCreatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (ticket: DemoTicket) => void;
}

export interface DemoTicket {
  legs: DemoSelection[];
  totalOdds: number;
  result: {
    hitsCount: number;
    totalLegs: number;
    won: boolean;
    potentialReturn: number;
  };
}

const PRESET_RANGES = [
  { label: "5-7x", min: 5, max: 7 },
  { label: "10-12x", min: 10, max: 12 },
  { label: "15-18x", min: 15, max: 18 },
  { label: "18-20x", min: 18, max: 20 },
  { label: "25-30x", min: 25, max: 30 },
];

const MARKETS = [
  { id: "goals", label: "Goals" },
  { id: "corners", label: "Corners" },
  { id: "cards", label: "Cards" },
];

export function DemoTicketCreatorDialog({ open, onOpenChange, onGenerate }: DemoTicketCreatorDialogProps) {
  const [targetMin, setTargetMin] = useState(10);
  const [targetMax, setTargetMax] = useState(15);
  const [includeMarkets, setIncludeMarkets] = useState(["goals", "corners", "cards"]);
  const [minLegs, setMinLegs] = useState(4);
  const [maxLegs, setMaxLegs] = useState(8);

  const handlePresetRange = (min: number, max: number) => {
    setTargetMin(min);
    setTargetMax(max);
  };

  const toggleMarket = (marketId: string) => {
    setIncludeMarkets((prev) =>
      prev.includes(marketId)
        ? prev.filter((m) => m !== marketId)
        : [...prev, marketId]
    );
  };

  const generateDemoTicket = () => {
    // Filter selections by chosen markets
    const availableSelections = DEMO_SELECTIONS.filter(
      s => includeMarkets.includes(s.market)
    );

    // Shuffle and pick unique fixtures
    const shuffled = [...availableSelections].sort(() => Math.random() - 0.5);
    
    // Select legs trying to hit target odds
    const legs: DemoSelection[] = [];
    let currentOdds = 1;
    const usedFixtures = new Set<number>();
    
    const targetOdds = (targetMin + targetMax) / 2;
    const targetLegs = Math.floor((minLegs + maxLegs) / 2);

    for (const selection of shuffled) {
      if (legs.length >= targetLegs) break;
      if (usedFixtures.has(selection.fixtureId)) continue;
      
      const newOdds = currentOdds * selection.odds;
      if (newOdds > targetMax * 1.2) continue; // Don't exceed target by too much
      
      legs.push(selection);
      usedFixtures.add(selection.fixtureId);
      currentOdds = newOdds;
      
      if (currentOdds >= targetMin && legs.length >= minLegs) break;
    }

    // Calculate result
    const hitsCount = legs.filter(l => l.result.hit).length;
    const won = hitsCount === legs.length;
    const totalOdds = legs.reduce((acc, l) => acc * l.odds, 1);

    const ticket: DemoTicket = {
      legs,
      totalOdds: Math.round(totalOdds * 100) / 100,
      result: {
        hitsCount,
        totalLegs: legs.length,
        won,
        potentialReturn: won ? Math.round(10 * totalOdds * 100) / 100 : 0, // Assuming $10 stake
      }
    };

    onGenerate(ticket);
    onOpenChange(false);
  };

  const hasValidationErrors = includeMarkets.length === 0 || targetMin >= targetMax;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Demo Ticket Creator
          </DialogTitle>
          <DialogDescription>
            Generate a demo ticket using historical match data. See how our AI would have built a ticket!
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Target Odds Range */}
          <div>
            <Label className="mb-3 block">Target Total Odds</Label>
            <div className="grid grid-cols-5 gap-2 mb-3">
              {PRESET_RANGES.map((preset) => (
                <Button
                  key={preset.label}
                  variant={targetMin === preset.min && targetMax === preset.max ? "default" : "outline"}
                  size="sm"
                  className="text-xs"
                  onClick={() => handlePresetRange(preset.min, preset.max)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="targetMin" className="text-xs text-muted-foreground">
                  Min Odds
                </Label>
                <Input
                  id="targetMin"
                  type="number"
                  min="1"
                  step="0.5"
                  value={targetMin}
                  onChange={(e) => setTargetMin(parseFloat(e.target.value) || 1)}
                />
              </div>
              <div>
                <Label htmlFor="targetMax" className="text-xs text-muted-foreground">
                  Max Odds
                </Label>
                <Input
                  id="targetMax"
                  type="number"
                  min="1"
                  step="0.5"
                  value={targetMax}
                  onChange={(e) => setTargetMax(parseFloat(e.target.value) || 1)}
                />
              </div>
            </div>
          </div>

          {/* Markets */}
          <div>
            <Label className="mb-3 block">Include Markets</Label>
            <div className="grid grid-cols-3 gap-3">
              {MARKETS.map((market) => (
                <div key={market.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={market.id}
                    checked={includeMarkets.includes(market.id)}
                    onCheckedChange={() => toggleMarket(market.id)}
                  />
                  <label
                    htmlFor={market.id}
                    className="text-sm font-medium leading-none"
                  >
                    {market.label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Legs Range */}
          <div>
            <Label className="mb-3 block">Number of Legs</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="minLegs" className="text-xs text-muted-foreground">
                  Min
                </Label>
                <Input
                  id="minLegs"
                  type="number"
                  min="2"
                  max={maxLegs}
                  value={minLegs}
                  onChange={(e) => setMinLegs(parseInt(e.target.value) || 2)}
                />
              </div>
              <div>
                <Label htmlFor="maxLegs" className="text-xs text-muted-foreground">
                  Max
                </Label>
                <Input
                  id="maxLegs"
                  type="number"
                  min={minLegs}
                  max="10"
                  value={maxLegs}
                  onChange={(e) => setMaxLegs(parseInt(e.target.value) || 10)}
                />
              </div>
            </div>
          </div>

          {/* Generate Button */}
          <Button
            className="w-full"
            onClick={generateDemoTicket}
            disabled={hasValidationErrors}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Generate Demo Ticket
          </Button>

          {hasValidationErrors && (
            <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded-md border">
              Please select at least one market and ensure min odds is less than max odds.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
