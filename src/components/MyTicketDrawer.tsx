import { useTicket } from "@/stores/useTicket";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, RefreshCw, Copy, Ticket, X, ChevronRight, Zap, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { useRegisterOverlay } from "@/hooks/useRegisterOverlay";
import { formatDateWithLocale } from "@/lib/i18nFormatters";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface MyTicketDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MyTicketDrawer({ open, onOpenChange }: MyTicketDrawerProps) {
  const { legs, stake, setStake, removeLeg, clear, refreshOdds } = useTicket();
  const { toast } = useToast();
  const { t, i18n } = useTranslation("common");
  useRegisterOverlay("my-ticket-drawer", open, () => onOpenChange(false));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id || null);
    });
  }, []);

  const totalOdds = legs.reduce((acc, leg) => acc * leg.odds, 1);
  const potentialReturn = stake * totalOdds;

  const handleRefreshOdds = async () => {
    setIsRefreshing(true);
    try {
      await refreshOdds();
      toast({ title: t("odds_refreshed"), description: t("odds_updated_description") });
    } catch {
      toast({ title: t("refresh_failed"), description: t("refresh_failed_description"), variant: "destructive" });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCopy = () => {
    const ticketText = legs
      .map(
        (leg, i) =>
          `${i + 1}. ${leg.homeTeam} vs ${leg.awayTeam}\n   ${leg.market.toUpperCase()} ${leg.side} ${leg.line} @ ${leg.odds.toFixed(2)} (${leg.bookmaker})\n   Kickoff: ${formatDateWithLocale(new Date(leg.kickoffUtc), "MMM d, HH:mm", i18n.language)}`
      )
      .join("\n\n");
    const summary = `\n\nTotal Odds: ${totalOdds.toFixed(2)}\nStake: ${stake}\nPotential Return: ${potentialReturn.toFixed(2)}`;
    navigator.clipboard.writeText(ticketText + summary);
    toast({ title: t("copied_to_clipboard"), description: t("ticket_copied_description") });
  };

  const handleClear = () => {
    clear();
    toast({ title: t("ticket_cleared"), description: t("ticket_cleared_description") });
  };

  useEffect(() => {
    if (open && legs.length > 0) {
      handleRefreshOdds();
    }
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg p-0 flex flex-col bg-background border-l border-border/50">
        {/* ── Header ── */}
        <div className="relative px-5 pt-5 pb-4 border-b border-border/40">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/6 via-transparent to-transparent" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/15 border border-primary/20">
                <Ticket className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground tracking-tight flex items-center gap-2">
                  {t("my_ticket_title")}
                  {legs.length > 0 && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider bg-primary/20 text-primary px-2 py-0.5 rounded-full border border-primary/30">
                      {legs.length} {legs.length === 1 ? "leg" : "legs"}
                    </span>
                  )}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">{t("build_ticket_description")}</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {legs.length === 0 ? (
            /* ── Empty State ── */
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <div className="w-20 h-20 rounded-2xl bg-muted/30 border border-border/40 flex items-center justify-center mb-5">
                <Ticket className="h-10 w-10 text-muted-foreground/30" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-1">{t("ticket_empty")}</h3>
              <p className="text-sm text-muted-foreground max-w-[260px] leading-relaxed">{t("add_selections_prompt")}</p>

              {/* Hint cards */}
              <div className="mt-8 w-full max-w-[280px] space-y-2">
                {[
                  { icon: "🎯", label: "Use Filterizer to find value bets" },
                  { icon: "🤖", label: "Generate with AI Ticket Creator" },
                  { icon: "⚡", label: "Tap + on any fixture analysis" },
                ].map((hint, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-muted/20 border border-border/30 text-left"
                  >
                    <span className="text-base">{hint.icon}</span>
                    <span className="text-xs text-muted-foreground">{hint.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* ── Quick Actions ── */}
              <div className="flex gap-2">
                <button
                  onClick={handleRefreshOdds}
                  disabled={isRefreshing}
                  className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl border border-border/50 bg-card/50 text-xs font-medium text-foreground hover:bg-muted/50 transition-all active:scale-[0.97] disabled:opacity-50"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
                  {t("refresh_odds")}
                </button>
                <button
                  onClick={handleCopy}
                  className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded-xl border border-border/50 bg-card/50 text-xs font-medium text-foreground hover:bg-muted/50 transition-all active:scale-[0.97]"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t("copy")}
                </button>
                <button
                  onClick={handleClear}
                  className="flex items-center justify-center w-10 h-10 rounded-xl border border-destructive/20 bg-destructive/5 text-destructive hover:bg-destructive/10 transition-all active:scale-[0.95]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* ── Legs ── */}
              <AnimatePresence mode="popLayout">
                {legs.map((leg, index) => (
                  <motion.div
                    key={leg.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95, x: -50 }}
                    transition={{ duration: 0.2 }}
                    className="rounded-xl border border-border/40 bg-card/60 overflow-hidden"
                  >
                    <div className="p-3.5">
                      {/* Top: Teams + Kickoff */}
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-sm leading-tight">
                            {leg.homeTeam}{" "}
                            <span className="text-muted-foreground font-normal">{t("vs")}</span>{" "}
                            {leg.awayTeam}
                          </h4>
                          <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDateWithLocale(new Date(leg.kickoffUtc), "MMM d, HH:mm", i18n.language)}
                          </div>
                        </div>
                        <button
                          onClick={() => removeLeg(leg.id)}
                          className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors ml-2 shrink-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Market row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-semibold text-primary-foreground bg-primary px-2 py-0.5 rounded-md uppercase">
                            {leg.market}
                          </span>
                          <span className="text-[11px] font-medium text-foreground bg-muted/40 px-2 py-0.5 rounded-md border border-border/30">
                            {leg.side} {leg.line}
                          </span>
                          {leg.isLive && (
                            <span className="text-[10px] font-bold text-destructive-foreground bg-destructive px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                              <Zap className="h-2.5 w-2.5" />
                              {t("live")}
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="text-lg font-bold text-primary tabular-nums">{leg.odds.toFixed(2)}</span>
                          <p className="text-[10px] text-muted-foreground">{leg.bookmaker}</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* ── Footer: Stake & Summary (only with legs) ── */}
        {legs.length > 0 && (
          <div className="border-t border-border/40 bg-card/80 backdrop-blur-sm px-5 py-4 space-y-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}>
            {/* Stake input */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground shrink-0">{t("stake")}</span>
              <div className="flex-1 flex items-center gap-1">
                {[5, 10, 25, 50].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setStake(preset)}
                    className={cn(
                      "flex-1 h-9 rounded-lg text-xs font-semibold tabular-nums border transition-all active:scale-[0.95]",
                      stake === preset
                        ? "bg-primary/15 border-primary/40 text-primary"
                        : "bg-muted/20 border-border/40 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {preset}
                  </button>
                ))}
                <Input
                  type="number"
                  value={stake}
                  onChange={(e) => setStake(parseFloat(e.target.value) || 0)}
                  min={0}
                  step={5}
                  className="w-16 h-9 text-xs text-center bg-background rounded-lg border-border/50 tabular-nums"
                />
              </div>
            </div>

            {/* Summary */}
            <div className="rounded-xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 p-3.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                <span>{t("total_odds")}</span>
                <span className="font-bold text-foreground tabular-nums">{totalOdds.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{t("potential_return")}</span>
                <span className="text-xl font-bold text-primary tabular-nums">{potentialReturn.toFixed(2)}</span>
              </div>
            </div>

            {/* Note */}
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              <strong className="text-foreground/60">{t("note")}</strong> {t("odds_range_note")}
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
