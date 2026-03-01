import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SafeZonePick {
  id: string;
  fixture_id: number;
  utc_kickoff: string;
  league_id: number;
  league_name: string;
  home_team: string;
  away_team: string;
  market: string;
  side: string;
  line: number;
  odds: number;
  bookmaker: string | null;
  confidence_score: number;
  wilson_lb: number;
  historical_roi_pct: number;
  sample_size: number;
  edge_pct: number;
  explanation: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "bot";
  text?: string;
  picks?: SafeZonePick[];
  meta?: any;
  loading?: boolean;
  error?: boolean;
}

interface ChatFilters {
  market?: "corners" | "goals" | "all";
  league_ids?: number[];
  date?: "today" | "tomorrow" | "48h";
  min_confidence?: number;
  limit?: number;
}

export function useSafeZoneChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const sendMessage = useCallback(async (text: string, filters?: ChatFilters) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
    };

    const loadingMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "bot",
      loading: true,
    };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);
    setLoading(true);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const { data, error } = await supabase.functions.invoke("safe-zone-chat", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: { query: text, filters: filters || {} },
      });

      if (error) {
        const errBody = (error as any)?.context?.body;
        const isPaywall = (error as any)?.status === 402 || errBody?.code === "PAYWALL";
        
        setMessages((prev) =>
          prev.map((m) =>
            m.id === loadingMsg.id
              ? {
                  ...m,
                  loading: false,
                  error: !isPaywall,
                  text: isPaywall
                    ? "🔒 Safe Zone Bot requires a premium subscription."
                    : "Something went wrong. Please try again.",
                  meta: isPaywall ? { paywall: true } : undefined,
                }
              : m
          )
        );
        return;
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? {
                ...m,
                loading: false,
                picks: data.picks || [],
                text:
                  data.status === "empty"
                    ? data.message
                    : `Found ${data.count} qualifying pick${data.count !== 1 ? "s" : ""}.`,
                meta: data.meta,
              }
            : m
        )
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, loading: false, error: true, text: "Network error. Please try again." }
            : m
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, loading, sendMessage, clearMessages };
}
