import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRegisterOverlay } from "@/hooks/useRegisterOverlay";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles, ShieldCheck, AlertTriangle, Zap } from "lucide-react";
import { InfoTooltip } from "@/components/shared/InfoTooltip";
import { Badge } from "@/components/ui/badge";

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

const MAX_LEGS = 3;
const ODDS_CAP = 2.30;

const DAY_RANGES = [
  { id: "today", label: "day_range_today" },
  { id: "tomorrow", label: "day_range_tomorrow" },
  { id: "next_2_days", label: "day_range_2_days" },
] as const;

interface DebugInfo {
  logs: string[];
  candidatesScanned: number;
  rejectionReasons: Record<string, number>;
}

export function TicketCreatorDialog({ open, onOpenChange, onGenerate }: TicketCreatorDialogProps) {
  const { t } = useTranslation(['ticket']);
  useRegisterOverlay("ticket-creator-dialog", open, () => onOpenChange(false));
  const [legs, setLegs] = useState<1 | 2 | 3>(1);
  const [dayRange, setDayRange] = useState<"today" | "tomorrow" | "next_2_days">("next_2_days");
  const [generating, setGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  const targetMin = legs === 1 ? 1.20 : legs === 2 ? 1.80 : 2.50;
  const targetMax = legs === 1 ? ODDS_CAP : legs === 2 ? 5.29 : 12.0;

  const handleGenerate = async () => {
    setGenerating(true);
    setErrorMessage(null);
    setDebugInfo(null);
    try {
      await onGenerate({
        targetMin,
        targetMax,
        includeMarkets: ["goals", "corners"],
        minLegs: legs,
        maxLegs: legs,
        useLiveOdds: false,
        dayRange,
        ticketMode: "max_win_rate",
      });
    } catch (error: any) {
      const msg = error.message || "Failed to generate ticket";
      
      if (msg.includes("INSUFFICIENT_CANDIDATES") || msg.includes("Not enough") || msg.includes("BUCKETS_NOT_BUILT")) {
        setErrorMessage(t('ticket:no_matches_error'));
      } else {
        setErrorMessage(msg);
      }

      try {
        const parsed = typeof error.details === "string" ? JSON.parse(error.details) : error.details;
        if (parsed?.logs) {
          const rejections: Record<string, number> = {};
          let scanned = 0;
          for (const log of parsed.logs as string[]) {
            if (log.includes("raw=")) {
              const match = log.match(/raw=(\d+)/);
              if (match) scanned = parseInt(match[1]);
            }
            if (log.includes("BUCKET_REJECT") || log.includes("ALLOWLIST_REJECT")) {
              const reason = log.match(/reason=(.+)/)?.[1] || log.match(/no bucket for (.+)/)?.[1] || "unknown";
              rejections[reason] = (rejections[reason] || 0) + 1;
            }
          }
          setDebugInfo({ logs: parsed.logs, candidatesScanned: scanned, rejectionReasons: rejections });
        }
      } catch { /* ignore parse errors */ }
    } finally {
      setGenerating(false);
    }
  };

  const legLabels: Record<number, string> = {
    1: t('ticket:leg_safest'),
    2: t('ticket:legs_two'),
    3: t('ticket:legs_max'),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-card border-primary/20 shadow-[0_0_40px_-10px_hsl(var(--primary)/0.15)]">
        <DialogHeader className="pb-2">
          <DialogTitle className="flex items-center gap-2.5 text-foreground text-lg">
            <div className="p-1.5 rounded-md bg-primary/10 border border-primary/20">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            {t('ticket:title')}
            <Badge className="bg-primary/15 text-primary border-primary/25 text-[10px] font-semibold tracking-wide uppercase">
              {t('ticket:safe_mode')}
            </Badge>
            <InfoTooltip tooltipKey="ai_ticket" />
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            {t('ticket:verified_selections_desc', { oddsCap: ODDS_CAP })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Green Buckets Info */}
          <div className="bg-primary/5 border border-primary/15 rounded-lg p-3.5 space-y-2">
            <p className="text-xs font-semibold text-primary flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              {t('ticket:green_buckets_active')}
            </p>
            <div className="text-[11px] text-muted-foreground space-y-1 leading-relaxed">
              <p className="flex items-start gap-1.5">
                <span className="text-primary mt-px">✓</span>
                {t('ticket:green_buckets_leagues')}
              </p>
              <p className="flex items-start gap-1.5">
                <span className="text-primary mt-px">✓</span>
                {t('ticket:green_buckets_markets')}
              </p>
              <p className="flex items-start gap-1.5">
                <span className="text-destructive mt-px">✗</span>
                {t('ticket:green_buckets_cards_disabled')}
              </p>
            </div>
          </div>

          {/* Number of Legs */}
          <div>
            <Label className="mb-2 block text-sm font-medium">{t('ticket:number_of_legs')}</Label>
            <div className="grid grid-cols-3 gap-2">
              {([1, 2, 3] as const).map((n) => (
                <Button
                  key={n}
                  variant={legs === n ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLegs(n)}
                  className={
                    legs === n
                      ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/20 transition-all"
                      : "border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all"
                  }
                >
                  {legLabels[n]}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {t('ticket:safe_mode_note', { maxLegs: MAX_LEGS, min: targetMin.toFixed(2), max: targetMax.toFixed(2) })}
            </p>
          </div>

          {/* Match Day Range */}
          <div>
            <Label className="mb-2 block text-sm font-medium">{t('ticket:match_day_range')}</Label>
            <div className="grid grid-cols-3 gap-2">
              {DAY_RANGES.map((range) => (
                <Button
                  key={range.id}
                  variant={dayRange === range.id ? "default" : "outline"}
                  size="sm"
                  className={
                    dayRange === range.id
                      ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/20 text-xs transition-all"
                      : "border-border/60 hover:border-primary/40 hover:bg-primary/5 text-xs transition-all"
                  }
                  onClick={() => setDayRange(range.id as "today" | "tomorrow" | "next_2_days")}
                >
                  {t(`ticket:${range.label}`)}
                </Button>
              ))}
            </div>
          </div>

          {/* Markets Display */}
          <div>
            <Label className="mb-2 block text-sm font-medium">{t('ticket:markets_label')}</Label>
            <div className="flex gap-2 flex-wrap">
              <Badge className="bg-primary/15 text-primary border-primary/25 font-medium">
                ⚽ {t('ticket:goals_over')}
              </Badge>
              <Badge variant="outline" className="opacity-35 line-through text-xs">
                🟨 {t('ticket:cards_label')}
              </Badge>
            </div>
          </div>

          {/* Generate Button */}
          <Button
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/25 font-semibold h-11 text-sm transition-all"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('ticket:generating')}
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                {legs > 1
                  ? t('ticket:generate_safe_ticket_plural', { count: legs })
                  : t('ticket:generate_safe_ticket', { count: legs })}
              </>
            )}
          </Button>

          {/* Error Message */}
          {errorMessage && (
            <div className="text-sm text-amber-700 dark:text-amber-400 bg-amber-500/10 p-3 rounded-lg border border-amber-500/20 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Debug Panel */}
          {debugInfo && (
            <details className="text-[11px] text-muted-foreground bg-muted/30 p-2.5 rounded-lg border border-border/50">
              <summary className="cursor-pointer font-medium">{t('ticket:debug_title')}</summary>
              <div className="mt-2 space-y-1 font-mono">
                <p>{t('ticket:debug_candidates')}: {debugInfo.candidatesScanned}</p>
                {Object.keys(debugInfo.rejectionReasons).length > 0 && (
                  <div>
                    <p className="font-semibold mt-1">{t('ticket:debug_rejections')}:</p>
                    {Object.entries(debugInfo.rejectionReasons).map(([reason, count]) => (
                      <p key={reason} className="pl-2">• {reason}: {count}</p>
                    ))}
                  </div>
                )}
                <div className="max-h-32 overflow-y-auto mt-1">
                  {debugInfo.logs.map((log, i) => (
                    <p key={i} className="text-[10px] opacity-70">{log}</p>
                  ))}
                </div>
              </div>
            </details>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
