import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSafeZoneChat } from "@/hooks/useSafeZoneChat";
import { useAccess } from "@/hooks/useAccess";
import { SafeZoneBotPickCard } from "./SafeZoneBotPickCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Send, X, Loader2, Lock, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";

interface Props {
  open: boolean;
  onClose: () => void;
}

const QUICK_CHIPS = [
  { key: "top_10", query: "top 10", filters: {} },
  { key: "corners", query: "corners", filters: { market: "corners" as const } },
  { key: "goals", query: "goals", filters: { market: "goals" as const } },
  { key: "today", query: "today", filters: { date: "today" as const } },
  { key: "tomorrow", query: "tomorrow", filters: { date: "tomorrow" as const } },
  { key: "48h", query: "48h", filters: { date: "48h" as const } },
];

export function SafeZoneBotChat({ open, onClose }: Props) {
  const { t } = useTranslation("common");
  const { hasAccess, isWhitelisted, loading: accessLoading } = useAccess();
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <span className="font-semibold text-sm text-foreground">
            {t("safe_zone_bot_title")}
          </span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Paywall */}
      {!accessLoading && !hasPaidAccess ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-4">
          <Lock className="w-10 h-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {t("safe_zone_bot_paywall")}
          </p>
          <Button size="sm" onClick={() => { onClose(); navigate("/pricing"); }}>
            {t("safe_zone_bot_view_plans")}
          </Button>
        </div>
      ) : (
        <>
          {/* Messages area */}
          <ScrollArea className="flex-1 px-4 py-3" ref={scrollRef as any}>
            {/* Greeting */}
            {messages.length === 0 && (
              <div className="rounded-lg bg-secondary/50 p-3 text-sm text-muted-foreground mb-3">
                {t("safe_zone_bot_greeting")}
              </div>
            )}

            <div className="space-y-3">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary/60 text-foreground"
                    }`}
                  >
                    {msg.loading ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-muted-foreground">
                          {t("safe_zone_bot_thinking")}
                        </span>
                      </div>
                    ) : (
                      <>
                        {msg.text && <p className={msg.error ? "text-destructive" : ""}>{msg.text}</p>}
                        {msg.meta?.paywall && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => { onClose(); navigate("/pricing"); }}
                          >
                            {t("safe_zone_bot_view_plans")}
                          </Button>
                        )}
                        {msg.picks && msg.picks.length > 0 && (
                          <div className="mt-2 space-y-2">
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

          {/* Quick chips */}
          <div className="px-4 py-2 flex gap-1.5 flex-wrap border-t border-border">
            {QUICK_CHIPS.map((chip) => (
              <button
                key={chip.key}
                onClick={() => handleChip(chip)}
                disabled={loading}
                className="px-2.5 py-1 rounded-full text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
              >
                {t(`safe_zone_bot_chip_${chip.key}`)}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-border flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder={t("safe_zone_bot_placeholder")}
              disabled={loading}
              className="flex-1 h-9 text-sm"
            />
            <Button size="icon" className="h-9 w-9 shrink-0" onClick={handleSend} disabled={loading || !input.trim()}>
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="bottom" className="h-[85dvh] p-0 flex flex-col">
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
    <div className="fixed bottom-20 right-4 z-50 w-[380px] h-[520px] rounded-xl border border-border bg-background shadow-2xl flex flex-col overflow-hidden">
      {chatContent}
    </div>
  );
}
