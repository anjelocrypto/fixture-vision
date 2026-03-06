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

// Allowlist constants mirrored from backend green_allowlist.ts
const ALLOWED_MARKETS = ["goals", "corners"];
const MAX_LEGS = 2;
const DEFAULT_LEGS = 1;
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
  const [legs, setLegs] = useState<1 | 2>(1);
  const [dayRange, setDayRange] = useState<"today" | "tomorrow" | "next_2_days">("next_2_days");
  const [generating, setGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  // Compute odds range based on legs
  const targetMin = legs === 1 ? 1.30 : 1.80;
  const targetMax = legs === 1 ? ODDS_CAP : 5.29;

  const handleGenerate = async () => {
    setGenerating(true);
    setErrorMessage(null);
    setDebugInfo(null);
    try {
      await onGenerate({
        targetMin,
        targetMax,
        includeMarkets: ALLOWED_MARKETS,
        minLegs: legs,
        maxLegs: legs,
        useLiveOdds: false,
        dayRange,
        ticketMode: "max_win_rate",
      });
    } catch (error: any) {
      // Parse backend response for debug info
      const msg = error.message || "Failed to generate ticket";
      
      // Check if this is an allowlist "no candidates" error
      if (msg.includes("INSUFFICIENT_CANDIDATES") || msg.includes("Not enough")) {
        setErrorMessage(
          "No matches in the next 48h meet Safe Zone rules (leagues: PL/Championship/FA Cup + Goals O1.5 / Corners O9.5 + odds ≤2.30). Try again later."
        );
      } else {
        setErrorMessage(msg);
      }

      // Extract debug info from logs if available
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
            if (log.includes("ALLOWLIST_REJECT")) {
              const reason = log.match(/reason=(.+)/)?.[1] || "unknown";
              rejections[reason] = (rejections[reason] || 0) + 1;
            }
          }
          setDebugInfo({
            logs: parsed.logs,
            candidatesScanned: scanned,
            rejectionReasons: rejections,
          });
        }
      } catch { /* ignore parse errors */ }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-green-500" />
            {t('ticket:title')}
            <Badge variant="outline" className="text-[10px] border-green-500/50 text-green-600">
              Safe Mode
            </Badge>
            <InfoTooltip tooltipKey="ticket_creator" />
          </DialogTitle>
          <DialogDescription>
            Verified selections only — PL, Championship &amp; FA Cup · Goals O1.5 · Corners O9.5 · Odds ≤{ODDS_CAP}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Allowlist Info */}
          <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-medium text-green-700 dark:text-green-400 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              Green Allowlist Active
            </p>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>✓ Leagues: Premier League, Championship, FA Cup</p>
              <p>✓ Markets: Goals Over 1.5 (1.30–1.60) · Corners Over 9.5 (1.40–2.30)</p>
              <p>✗ Cards: Disabled (negative EV)</p>
            </div>
          </div>

          {/* Number of Legs */}
          <div>
            <Label className="mb-2 block text-sm">Number of Legs</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={legs === 1 ? "default" : "outline"}
                size="sm"
                onClick={() => setLegs(1)}
                className={legs === 1 ? "bg-green-600 hover:bg-green-700 text-white" : ""}
              >
                1 Leg (Safest)
              </Button>
              <Button
                variant={legs === 2 ? "default" : "outline"}
                size="sm"
                onClick={() => setLegs(2)}
                className={legs === 2 ? "bg-green-600 hover:bg-green-700 text-white" : ""}
              >
                2 Legs (Max)
              </Button>
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
            <div className="flex gap-2">
              <Badge className="bg-green-600/20 text-green-700 dark:text-green-400 border-green-500/30">
                ⚽ Goals O1.5
              </Badge>
              <Badge className="bg-green-600/20 text-green-700 dark:text-green-400 border-green-500/30">
                🔲 Corners O9.5
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
