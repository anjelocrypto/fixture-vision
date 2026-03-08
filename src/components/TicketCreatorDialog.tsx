import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRegisterOverlay } from "@/hooks/useRegisterOverlay";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, ShieldCheck, AlertTriangle, Zap, ChevronDown } from "lucide-react";
import { InfoTooltip } from "@/components/shared/InfoTooltip";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";

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
  const isMobile = useIsMobile();
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
      <DialogContent
        className={
          isMobile
            ? "w-[calc(100%-2rem)] max-w-none rounded-2xl bg-card border-primary/20 shadow-[0_0_40px_-10px_hsl(var(--primary)/0.15)] p-0 gap-0"
            : "sm:max-w-lg bg-card border-primary/20 shadow-[0_0_40px_-10px_hsl(var(--primary)/0.15)] p-0 gap-0"
        }
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4">
          <DialogHeader className="pb-0 space-y-2">
            <DialogTitle className="flex items-center gap-2 text-foreground text-base sm:text-lg pr-8">
              <div className="p-1.5 rounded-lg bg-primary/10 border border-primary/20 flex-shrink-0">
                <ShieldCheck className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
              </div>
              <span className="leading-tight">{t('ticket:title')}</span>
              <Badge className="bg-primary/15 text-primary border-primary/25 text-[9px] sm:text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 flex-shrink-0">
                {t('ticket:safe_mode')}
              </Badge>
              <InfoTooltip tooltipKey="ai_ticket" />
            </DialogTitle>
            <DialogDescription className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
              {t('ticket:verified_selections_desc', { oddsCap: ODDS_CAP })}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Scrollable Content */}
        <div className="px-4 pb-4 sm:px-6 sm:pb-6 space-y-3 sm:space-y-4 overflow-y-auto max-h-[calc(70dvh-80px)]">
          {/* Green Buckets Info */}
          <div className="bg-primary/5 border border-primary/15 rounded-xl p-3 space-y-1.5">
            <p className="text-[11px] sm:text-xs font-semibold text-primary flex items-center gap-1.5">
              <Zap className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              {t('ticket:green_buckets_active')}
            </p>
            <div className="text-[10px] sm:text-[11px] text-muted-foreground space-y-0.5 leading-relaxed">
              <p className="flex items-start gap-1.5">
                <span className="text-primary mt-px flex-shrink-0">✓</span>
                <span>{t('ticket:green_buckets_leagues')}</span>
              </p>
              <p className="flex items-start gap-1.5">
                <span className="text-primary mt-px flex-shrink-0">✓</span>
                <span>{t('ticket:green_buckets_markets')}</span>
              </p>
              <p className="flex items-start gap-1.5">
                <span className="text-destructive mt-px flex-shrink-0">✗</span>
                <span>{t('ticket:green_buckets_cards_disabled')}</span>
              </p>
            </div>
          </div>

          {/* Number of Legs */}
          <div>
            <p className="text-xs sm:text-sm font-medium mb-2 text-foreground">{t('ticket:number_of_legs')}</p>
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
              {([1, 2, 3] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setLegs(n)}
                  className={`
                    h-9 sm:h-10 rounded-xl text-xs sm:text-sm font-medium transition-all active:scale-[0.96]
                    ${legs === n
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                      : "bg-muted/50 border border-border/60 text-foreground hover:border-primary/40 hover:bg-primary/5"
                    }
                  `}
                >
                  {legLabels[n]}
                </button>
              ))}
            </div>
            <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-1.5 leading-snug">
              {t('ticket:safe_mode_note', { maxLegs: MAX_LEGS, min: targetMin.toFixed(2), max: targetMax.toFixed(2) })}
            </p>
          </div>

          {/* Match Day Range */}
          <div>
            <p className="text-xs sm:text-sm font-medium mb-2 text-foreground">{t('ticket:match_day_range')}</p>
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
              {DAY_RANGES.map((range) => (
                <button
                  key={range.id}
                  onClick={() => setDayRange(range.id as "today" | "tomorrow" | "next_2_days")}
                  className={`
                    h-9 sm:h-10 rounded-xl text-[11px] sm:text-xs font-medium transition-all active:scale-[0.96]
                    ${dayRange === range.id
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/25"
                      : "bg-muted/50 border border-border/60 text-foreground hover:border-primary/40 hover:bg-primary/5"
                    }
                  `}
                >
                  {t(`ticket:${range.label}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Markets Display */}
          <div>
            <p className="text-xs sm:text-sm font-medium mb-2 text-foreground">{t('ticket:markets_label')}</p>
            <div className="flex gap-2">
              <Badge className="bg-primary/15 text-primary border-primary/25 font-medium text-[10px] sm:text-xs px-2.5 py-1">
                ⚽ {t('ticket:goals_over')}
              </Badge>
              <Badge variant="outline" className="opacity-35 line-through text-[10px] sm:text-xs px-2.5 py-1">
                🟨 {t('ticket:cards_label')}
              </Badge>
            </div>
          </div>

          {/* Generate Button */}
          <Button
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/25 font-semibold h-11 sm:h-12 text-sm transition-all active:scale-[0.97] rounded-xl"
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
            <div className="text-[11px] sm:text-sm text-amber-700 dark:text-amber-400 bg-amber-500/10 p-3 rounded-xl border border-amber-500/20 flex gap-2">
              <AlertTriangle className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Debug Panel */}
          {debugInfo && (
            <details className="text-[10px] sm:text-[11px] text-muted-foreground bg-muted/30 p-2.5 rounded-xl border border-border/50">
              <summary className="cursor-pointer font-medium flex items-center gap-1">
                <ChevronDown className="h-3 w-3" />
                {t('ticket:debug_title')}
              </summary>
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
                <div className="max-h-28 overflow-y-auto mt-1">
                  {debugInfo.logs.map((log, i) => (
                    <p key={i} className="text-[9px] opacity-70">{log}</p>
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
