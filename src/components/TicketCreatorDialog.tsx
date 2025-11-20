import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Loader2, Sparkles, Radio } from "lucide-react";
import { InfoTooltip } from "@/components/shared/InfoTooltip";

interface TicketCreatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (params: GenerateParams) => Promise<void>;
}

export interface GenerateParams {
  targetMin: number;
  targetMax: number;
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

export function TicketCreatorDialog({ open, onOpenChange, onGenerate }: TicketCreatorDialogProps) {
  const { t } = useTranslation(['ticket']);
  const [targetMin, setTargetMin] = useState(18);
  const [targetMax, setTargetMax] = useState(20);
  const [includeMarkets, setIncludeMarkets] = useState(["goals", "corners", "cards"]);
  const [minLegs, setMinLegs] = useState(5);
  const [maxLegs, setMaxLegs] = useState(15);
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

  const validateInputs = () => {
    const errors: string[] = [];
    
    if (includeMarkets.length === 0) {
      errors.push(t('ticket:validation_select_market'));
    }
    if (targetMin >= targetMax) {
      errors.push(t('ticket:validation_min_max_odds'));
    }
    if (minLegs > maxLegs) {
      errors.push(t('ticket:validation_min_max_legs'));
    }
    if (targetMin < 1.01) {
      errors.push(t('ticket:validation_min_odds_value'));
    }
    
    return errors;
  };

  const handleGenerate = async () => {
    const validationErrors = validateInputs();
    if (validationErrors.length > 0) {
      setErrorMessage(validationErrors.join(". "));
      return;
    }
    
    setGenerating(true);
    setErrorMessage(null);
    try {
      await onGenerate({
        targetMin,
        targetMax,
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

  const validationErrors = validateInputs();
  const hasValidationErrors = validationErrors.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {t('ticket:title')}
            <InfoTooltip tooltipKey="ticket_creator" />
          </DialogTitle>
          <DialogDescription>
            {t('ticket:description')}
          </DialogDescription>
          <div className="mt-3 space-y-1">
            <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-2">
              {t('ticket:per_leg_odds_note')}
            </p>
            <p className="text-xs text-muted-foreground border-l-2 border-destructive/30 pl-2">
              {t('ticket:total_odds_note')}
            </p>
            <p className="text-xs text-muted-foreground border-l-2 border-accent/30 pl-2">
              {t('ticket:legs_note')}
            </p>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Target Odds Range */}
          <div>
            <Label className="mb-3 block">{t('ticket:target_total_odds')}</Label>
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
                  {t('ticket:min_odds')}
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
                  {t('ticket:max_odds')}
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
            <Label className="mb-3 block">{t('ticket:include_markets')}</Label>
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
                  {t('ticket:use_live_odds')}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('ticket:use_live_odds_description')}
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
            <Label className="mb-3 block">{t('ticket:number_of_legs')}</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="minLegs" className="text-xs text-muted-foreground">
                  {t('ticket:min')}
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
                  {t('ticket:max')}
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
            disabled={generating || hasValidationErrors}
          >
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('ticket:generating')}
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                {t('ticket:generate_ticket')}
              </>
            )}
          </Button>

          {/* Validation Hints */}
          {hasValidationErrors && !generating && (
            <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded-md border">
              {validationErrors.join(" • ")}
            </div>
          )}

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
