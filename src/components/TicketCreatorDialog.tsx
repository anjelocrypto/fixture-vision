import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Loader2, Sparkles, Radio } from "lucide-react";

interface TicketCreatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (params: GenerateParams) => Promise<void>;
  fixturesCount: number;
}

export interface GenerateParams {
  targetMin: number;
  targetMax: number;
  risk: "safe" | "standard" | "risky";
  includeMarkets: string[];
  minLegs: number;
  maxLegs: number;
  useLiveOdds: boolean;
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
  { id: "fouls", label: "Fouls" },
  { id: "offsides", label: "Offsides" },
];

export function TicketCreatorDialog({ open, onOpenChange, onGenerate, fixturesCount }: TicketCreatorDialogProps) {
  const [targetMin, setTargetMin] = useState(18);
  const [targetMax, setTargetMax] = useState(20);
  const [risk, setRisk] = useState<"safe" | "standard" | "risky">("standard");
  const [includeMarkets, setIncludeMarkets] = useState(["goals", "corners", "cards"]);
  const [minLegs, setMinLegs] = useState(3);
  const [maxLegs, setMaxLegs] = useState(8);
  const [useLiveOdds, setUseLiveOdds] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  const handleGenerate = async () => {
    if (includeMarkets.length === 0) return;
    
    setGenerating(true);
    setErrorMessage(null);
    try {
      await onGenerate({
        targetMin,
        targetMax,
        risk,
        includeMarkets,
        minLegs,
        maxLegs,
        useLiveOdds,
      });
    } catch (error: any) {
      setErrorMessage(error.message || "Failed to generate ticket");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Ticket Creator
          </DialogTitle>
          <DialogDescription>
            Create an optimized betting ticket based on statistical analysis and available odds.
            {fixturesCount > 0 && ` ${fixturesCount} fixtures available.`}
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

          {/* Risk Profile */}
          <div>
            <Label className="mb-3 block">Risk Profile</Label>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={risk === "safe" ? "default" : "outline"}
                size="sm"
                onClick={() => setRisk("safe")}
              >
                Safe
              </Button>
              <Button
                variant={risk === "standard" ? "default" : "outline"}
                size="sm"
                onClick={() => setRisk("standard")}
              >
                Standard
              </Button>
              <Button
                variant={risk === "risky" ? "default" : "outline"}
                size="sm"
                onClick={() => setRisk("risky")}
              >
                Risky
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {risk === "safe" && "Prefer odds 1.2-1.6 (lower variance)"}
              {risk === "standard" && "Prefer odds 1.4-2.0 (balanced)"}
              {risk === "risky" && "Prefer odds 1.8-3.0 (higher variance)"}
            </p>
          </div>

          {/* Markets */}
          <div>
            <Label className="mb-3 block">Include Markets</Label>
            <div className="grid grid-cols-2 gap-3">
              {MARKETS.map((market) => (
                <div key={market.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={market.id}
                    checked={includeMarkets.includes(market.id)}
                    onCheckedChange={() => toggleMarket(market.id)}
                  />
                  <label
                    htmlFor={market.id}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {market.label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Live Odds Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-muted-foreground" />
              <div>
                <Label htmlFor="liveOdds" className="text-sm font-medium cursor-pointer">
                  Use Live Odds
                </Label>
                <p className="text-xs text-muted-foreground">
                  Fetch real-time odds for in-play fixtures (if available)
                </p>
              </div>
            </div>
            <Switch
              id="liveOdds"
              checked={useLiveOdds}
              onCheckedChange={setUseLiveOdds}
            />
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
                  min="1"
                  max={maxLegs}
                  value={minLegs}
                  onChange={(e) => setMinLegs(parseInt(e.target.value) || 1)}
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
                  max="15"
                  value={maxLegs}
                  onChange={(e) => setMaxLegs(parseInt(e.target.value) || 1)}
                />
              </div>
            </div>
          </div>

          {/* Generate Button */}
          <Button
            className="w-full"
            onClick={handleGenerate}
            disabled={generating || includeMarkets.length === 0 || fixturesCount === 0}
          >
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate Ticket
              </>
            )}
          </Button>

          {/* Error Message */}
          {errorMessage && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md border border-destructive/20">
              {errorMessage}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
