import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSafeZoneChat } from "@/hooks/useSafeZoneChat";
import { useAccess } from "@/hooks/useAccess";
import { SafeZoneBotPickCard } from "./SafeZoneBotPickCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Send, X, Loader2, Lock, ShieldCheck, Zap, Target, TrendingUp, Clock, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { useRegisterOverlay } from "@/hooks/useRegisterOverlay";

interface Props {
  open: boolean;
  onClose: () => void;
}

const QUICK_CHIPS = [
  { key: "top_10", query: "top 10", filters: {}, icon: Zap },
  { key: "corners", query: "corners", filters: { market: "corners" as const }, icon: Target },
  { key: "goals", query: "goals", filters: { market: "goals" as const }, icon: TrendingUp },
  { key: "today", query: "today", filters: { date: "today" as const }, icon: Clock },
  { key: "tomorrow", query: "tomorrow", filters: { date: "tomorrow" as const }, icon: Clock },
  { key: "48h", query: "48h", filters: { date: "48h" as const }, icon: Sparkles },
];

export function SafeZoneBotChat({ open, onClose }: Props) {
  const { t } = useTranslation("common");
  const { hasAccess, isWhitelisted, loading: accessLoading } = useAccess();
  useRegisterOverlay("safezone-bot-chat", open, onClose);
  const hasPaidAccess = hasAccess || isWhitelisted;
  const { messages, loading, sendMessage } = useSafeZoneChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    sendMessage(text);
  };

  const handleChip = (chip: typeof QUICK_CHIPS[0]) => {
    if (loading) return;
    sendMessage(chip.query, chip.filters);
  };

  const chatContent = (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-primary/15 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-primary" />
          </div>
          <div>
            <span className="font-bold text-sm text-foreground block leading-tight">
              {t("safe_zone_bot_title")}
            </span>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Online
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8 rounded-xl hover:bg-muted/50 active:scale-95 transition-all"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Paywall */}
      {!accessLoading && !hasPaidAccess ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-5">
          <div className="h-16 w-16 rounded-2xl bg-muted/30 flex items-center justify-center">
            <Lock className="w-8 h-8 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-foreground">
              {t("safe_zone_bot_paywall")}
            </p>
            <p className="text-xs text-muted-foreground max-w-[240px]">
              Unlock AI-powered safe picks with verified historical performance
            </p>
          </div>
          <Button
            size="sm"
            className="rounded-xl px-6 active:scale-95 transition-transform"
            onClick={() => { onClose(); navigate("/pricing"); }}
          >
            {t("safe_zone_bot_view_plans")}
          </Button>
        </div>
      ) : (
        <>
          {/* Messages area */}
          <ScrollArea className="flex-1 px-3 py-3" ref={scrollRef as any}>
            {/* Greeting */}
            {messages.length === 0 && (
              <div className="space-y-3">
                <div className="rounded-2xl bg-muted/30 border border-border/30 p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {t("safe_zone_bot_greeting")}
                    </p>
                  </div>
                </div>

                {/* Quick action cards for empty state */}
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_CHIPS.slice(0, 4).map((chip) => {
                    const Icon = chip.icon;
                    return (
                      <button
                        key={chip.key}
                        onClick={() => handleChip(chip)}
                        disabled={loading}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border/40 bg-card/60 text-left hover:bg-muted/40 active:scale-[0.97] transition-all disabled:opacity-50"
                      >
                        <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="text-xs font-medium text-foreground">
                          {t(`safe_zone_bot_chip_${chip.key}`)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-muted/40 text-foreground border border-border/30 rounded-bl-md"
                    }`}
                  >
                    {msg.loading ? (
                      <div className="flex items-center gap-2.5 py-1">
                        <div className="flex gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {t("safe_zone_bot_thinking")}
                        </span>
                      </div>
                    ) : (
                      <>
                        {msg.text && (
                          <p className={`text-[13px] leading-relaxed ${msg.error ? "text-destructive" : ""}`}>
                            {msg.text}
                          </p>
                        )}
                        {msg.meta?.paywall && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2.5 rounded-xl text-xs active:scale-95 transition-transform"
                            onClick={() => { onClose(); navigate("/pricing"); }}
                          >
                            {t("safe_zone_bot_view_plans")}
                          </Button>
                        )}
                        {msg.picks && msg.picks.length > 0 && (
                          <div className="mt-2.5 space-y-2">
                            {msg.picks.map((pick) => (
                              <SafeZoneBotPickCard key={pick.id} pick={pick} />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Quick chips — compact inline row */}
          {messages.length > 0 && (
            <div className="px-3 py-2 flex gap-1.5 overflow-x-auto no-scrollbar border-t border-border/30">
              {QUICK_CHIPS.map((chip) => {
                const Icon = chip.icon;
                return (
                  <button
                    key={chip.key}
                    onClick={() => handleChip(chip)}
                    disabled={loading}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-medium bg-muted/40 text-muted-foreground border border-border/30 hover:bg-muted/60 hover:text-foreground active:scale-95 transition-all disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Icon className="w-3 h-3" />
                    {t(`safe_zone_bot_chip_${chip.key}`)}
                  </button>
                );
              })}
            </div>
          )}

          {/* Input */}
          <div className="px-3 py-3 border-t border-border/40 bg-card/60 backdrop-blur-sm sticky bottom-0 z-10"
               style={{ paddingBottom: isMobile ? "calc(12px + env(safe-area-inset-bottom, 0px))" : "12px" }}>
            <div className="flex gap-2 items-center">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder={t("safe_zone_bot_placeholder")}
                disabled={loading}
                className="flex-1 h-10 text-sm rounded-xl border-border/40 bg-muted/30 focus:bg-background transition-colors"
              />
              <Button
                size="icon"
                className="h-10 w-10 rounded-xl shrink-0 active:scale-90 transition-transform"
                onClick={handleSend}
                disabled={loading || !input.trim()}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="bottom" className="h-[90dvh] p-0 flex flex-col rounded-t-2xl [&>button[class*='close']]:hidden [&>button[data-radix-collection-item]]:hidden [&>button:not(.custom-btn)]:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("safe_zone_bot_title")}</SheetTitle>
          </SheetHeader>
          {chatContent}
        </SheetContent>
      </Sheet>
    );
  }

  if (!open) return null;

  return (
    <div className="fixed bottom-20 right-4 z-50 w-[400px] h-[560px] rounded-2xl border border-border/50 bg-background shadow-2xl flex flex-col overflow-hidden backdrop-blur-sm">
      {chatContent}
    </div>
  );
}
