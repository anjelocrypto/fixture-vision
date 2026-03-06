import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Sparkles, ShieldCheck, AlertTriangle } from "lucide-react";
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

// These match the backend green_buckets system
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
  const [legs, setLegs] = useState<1 | 2 | 3>(1);
  const [dayRange, setDayRange] = useState<"today" | "tomorrow" | "next_2_days">("next_2_days");
  const [generating, setGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  // Compute odds range based on legs
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
        setErrorMessage(
          "No matches in the next 48h meet Safe Zone rules (verified leagues + markets with ≥65% hit rate + odds ≤2.30). Try again later or expand the day range."
        );
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {t('ticket:ai_ticket_title')}
            <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px]">
              Safe Mode
            </Badge>
            <InfoTooltip content={t('ticket:ai_ticket_description')} />
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Verified selections only — Data-driven from historical performance · Hit rate ≥65% · Odds ≤{ODDS_CAP}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Green Buckets Info */}
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-medium text-green-700 dark:text-green-400 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              Green Buckets Active
            </p>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>✓ Leagues: All verified leagues with ≥65% hit rate (Champions League, Championship, Europa League, La Liga, Serie A, and more)</p>
              <p>✓ Markets: Goals Over (1.5/2.5/3.5) — data-verified odds bands</p>
              <p>✗ Cards: Disabled (negative EV)</p>
            </div>
          </div>

          {/* Number of Legs */}
          <div>
            <Label className="mb-2 block text-sm">Number of Legs</Label>
            <div className="grid grid-cols-3 gap-2">
              {([1, 2, 3] as const).map((n) => (
                <Button
                  key={n}
                  variant={legs === n ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLegs(n)}
                  className={legs === n ? "bg-green-600 hover:bg-green-700 text-white" : ""}
                >
                  {n === 1 ? "1 Leg (Safest)" : n === 2 ? "2 Legs" : "3 Legs (Max)"}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Safe mode supports max {MAX_LEGS} legs. Odds range: {targetMin.toFixed(2)}–{targetMax.toFixed(2)}
            </p>
          </div>

          {/* Match Day Range */}
          <div>
            <Label className="mb-2 block text-sm">{t('ticket:match_day_range')}</Label>
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

          {/* Markets Display (read-only) */}
          <div>
            <Label className="mb-2 block text-sm">Markets</Label>
            <div className="flex gap-2 flex-wrap">
              <Badge className="bg-green-600/20 text-green-700 dark:text-green-400 border-green-500/30">
                ⚽ Goals Over
              </Badge>
              <Badge variant="outline" className="opacity-40 line-through text-xs">
                🟨 Cards
              </Badge>
            </div>
          </div>

          {/* Generate Button */}
          <Button
            className="w-full bg-green-600 hover:bg-green-700 text-white"
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
                Generate Safe Ticket ({legs} leg{legs > 1 ? "s" : ""})
              </>
            )}
          </Button>

          {/* Error Message */}
          {errorMessage && (
            <div className="text-sm text-amber-700 dark:text-amber-400 bg-amber-500/10 p-3 rounded-md border border-amber-500/20 flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Debug Panel (dev-only info from backend) */}
          {debugInfo && (
            <details className="text-[11px] text-muted-foreground bg-muted/30 p-2 rounded border">
              <summary className="cursor-pointer font-medium">Debug: Generation Details</summary>
              <div className="mt-2 space-y-1 font-mono">
                <p>Candidates scanned: {debugInfo.candidatesScanned}</p>
                {Object.keys(debugInfo.rejectionReasons).length > 0 && (
                  <div>
                    <p className="font-semibold mt-1">Rejections:</p>
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
