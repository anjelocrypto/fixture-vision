import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Sparkles, Target, Zap, TrendingUp } from "lucide-react";
import { InfoTooltip } from "@/components/shared/InfoTooltip";
import { cn } from "@/lib/utils";

interface TicketCreatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (params: GenerateParams) => Promise<void>;
}

export type TicketMode = "max_win_rate" | "balanced" | "high_risk";

export interface GenerateParams {
  targetMin: number;
  targetMax: number;
  includeMarkets: string[];
  minLegs: number;
  maxLegs: number;
  useLiveOdds: boolean;
  dayRange: "today" | "tomorrow" | "next_2_days";
  ticketMode?: TicketMode;
}

// Mode configurations with preset values
const TICKET_MODE_CONFIGS: Record<TicketMode, {
  icon: typeof Target;
  minLegs: number;
  maxLegs: number;
  minOdds: number;
  maxOdds: number;
  markets: string[];
  description: string;
}> = {
  max_win_rate: {
    icon: Target,
    minLegs: 1,
    maxLegs: 2,
    minOdds: 1.5,
    maxOdds: 4.0,
    markets: ["goals", "corners", "cards"],
    description: "1-2 legs, high-probability lines only. ~60-80% hit rate.",
  },
  balanced: {
    icon: Zap,
    minLegs: 3,
    maxLegs: 8,
    minOdds: 5,
    maxOdds: 20,
    markets: ["goals", "corners", "cards"],
    description: "Standard multi-leg tickets. Moderate risk/reward.",
  },
  high_risk: {
    icon: TrendingUp,
    minLegs: 5,
    maxLegs: 15,
    minOdds: 15,
    maxOdds: 50,
    markets: ["goals", "corners", "cards"],
    description: "5+ legs, higher odds target. Low hit rate, high payout.",
  },
};

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

const DAY_RANGES = [
  { id: "today", label: "day_range_today" },
  { id: "tomorrow", label: "day_range_tomorrow" },
  { id: "next_2_days", label: "day_range_2_days" },
] as const;

export function TicketCreatorDialog({ open, onOpenChange, onGenerate }: TicketCreatorDialogProps) {
  const { t } = useTranslation(['ticket']);
  const [ticketMode, setTicketMode] = useState<TicketMode>("balanced");
  const [targetMin, setTargetMin] = useState(18);
  const [targetMax, setTargetMax] = useState(20);
  const [includeMarkets, setIncludeMarkets] = useState(["goals", "corners", "cards"]);
  const [minLegs, setMinLegs] = useState(5);
  const [maxLegs, setMaxLegs] = useState(15);
  const [useLiveOdds, setUseLiveOdds] = useState(false);
  const [dayRange, setDayRange] = useState<"today" | "tomorrow" | "next_2_days">("next_2_days");
  const [generating, setGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // When mode changes, apply preset values
  useEffect(() => {
    const config = TICKET_MODE_CONFIGS[ticketMode];
    setMinLegs(config.minLegs);
    setMaxLegs(config.maxLegs);
    setTargetMin(config.minOdds);
    setTargetMax(config.maxOdds);
    setIncludeMarkets(config.markets);
  }, [ticketMode]);

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
        dayRange,
        ticketMode,
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
          {/* Ticket Mode Selector */}
          <div>
            <Label className="mb-3 block">{t('ticket:ticket_mode', 'Ticket Mode')}</Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(TICKET_MODE_CONFIGS) as [TicketMode, typeof TICKET_MODE_CONFIGS[TicketMode]][]).map(([mode, config]) => {
                const Icon = config.icon;
                const isActive = ticketMode === mode;
                return (
                  <Button
                    key={mode}
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    className={cn(
                      "flex flex-col h-auto py-3 gap-1",
                      isActive && mode === "max_win_rate" && "bg-green-600 hover:bg-green-700 text-white"
                    )}
                    onClick={() => setTicketMode(mode)}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-xs font-medium">
                      {mode === "max_win_rate" ? "Max Win" : mode === "balanced" ? "Balanced" : "High Risk"}
                    </span>
                  </Button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-2 border-l-2 border-primary/30 pl-2">
              {TICKET_MODE_CONFIGS[ticketMode].description}
            </p>
          </div>

          {/* Target Odds Range - only show for non-max-win-rate modes */}
          {ticketMode !== "max_win_rate" && (
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
          )}

          {/* Match Day Range */}
          <div>
            <Label className="mb-3 block">{t('ticket:match_day_range')}</Label>
            <div className="grid grid-cols-3 gap-2">
              {DAY_RANGES.map((range) => (
                <Button
                  key={range.id}
                  variant={dayRange === range.id ? "default" : "outline"}
                  size="sm"
                  className="text-xs"
                  onClick={() => setDayRange(range.id as "today" | "tomorrow" | "next_2_days")}
                >
                  {t(`ticket:${range.label}`)}
                </Button>
              ))}
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

          {/* Live Odds Toggle - Hidden (non-functional) */}

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
