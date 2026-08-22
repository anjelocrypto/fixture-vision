import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Bounded page size — cursor pagination over generated_tickets. */
export const TICKET_HISTORY_PAGE_SIZE = 10;

export interface HistoryLeg {
  id: string;
  ticket_id: string;
  fixture_id: number;
  market: string;
  side: string | null;
  line: number | null;
  odds: number | null;
  kickoff_at: string | null;
  result_status: string;
  actual_value: number | null;
  settlement_hold_reason: string | null;
  settlement_held_at: string | null;
  kickoff_drift_seconds: number | null;
  home_team?: string | null;
  away_team?: string | null;
}

export interface HistoryTicket {
  id: string;
  created_at: string;
  total_odds: number | null;
  ticket_mode: string | null;
  status: string;
  legs_total: number;
  legs_settled: number;
  legs: HistoryLeg[];
}

interface RawTicketRow {
  id: string;
  created_at: string;
  total_odds: number | null;
  ticket_mode: string | null;
  legs: unknown;
}

function legNames(rawLegs: unknown, fixtureId: number) {
  if (!Array.isArray(rawLegs)) return {};
  const match = rawLegs.find(
    (l) => l && typeof l === "object" && Number((l as Record<string, unknown>).fixtureId) === fixtureId
  ) as Record<string, unknown> | undefined;
  if (!match) return {};
  return {
    home_team: typeof match.homeTeam === "string" ? match.homeTeam : null,
    away_team: typeof match.awayTeam === "string" ? match.awayTeam : null,
  };
}

/**
 * Ticket history for the signed-in user only.
 * Ownership is enforced by database RLS on generated_tickets / ticket_outcomes /
 * ticket_leg_outcomes; the client filter is a convenience, never the guard.
 * Three bounded queries per page (tickets, outcomes, legs) — no N+1.
 */
export function useTicketHistory(enabled: boolean) {
  const [tickets, setTickets] = useState<HistoryTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const cursor = useRef<string | null>(null);
  const started = useRef(false);

  const fetchPage = useCallback(async (reset: boolean) => {
    if (reset) {
      cursor.current = null;
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      let query = supabase
        .from("generated_tickets")
        .select("id, created_at, total_odds, ticket_mode, legs")
        .order("created_at", { ascending: false })
        .limit(TICKET_HISTORY_PAGE_SIZE + 1);

      if (!reset && cursor.current) query = query.lt("created_at", cursor.current);

      const { data: ticketRows, error: ticketError } = await query;
      if (ticketError) throw ticketError;

      const rows = (ticketRows ?? []) as RawTicketRow[];
      const page = rows.slice(0, TICKET_HISTORY_PAGE_SIZE);
      setHasMore(rows.length > TICKET_HISTORY_PAGE_SIZE);
      if (page.length > 0) cursor.current = page[page.length - 1].created_at;

      const ids = page.map((t) => t.id);
      let outcomes: Record<string, { ticket_status: string; legs_total: number; legs_settled: number }> = {};
      let legsByTicket: Record<string, HistoryLeg[]> = {};

      if (ids.length > 0) {
        const [outcomeRes, legRes] = await Promise.all([
          supabase
            .from("ticket_outcomes")
            .select("ticket_id, ticket_status, legs_total, legs_settled")
            .in("ticket_id", ids),
          supabase
            .from("ticket_leg_outcomes")
            .select(
              "id, ticket_id, fixture_id, market, side, line, odds, kickoff_at, result_status, actual_value, settlement_hold_reason, settlement_held_at, kickoff_drift_seconds"
            )
            .in("ticket_id", ids)
            .order("kickoff_at", { ascending: true }),
        ]);

        if (outcomeRes.error) throw outcomeRes.error;
        if (legRes.error) throw legRes.error;

        outcomes = Object.fromEntries(
          (outcomeRes.data ?? []).map((o) => [
            o.ticket_id as string,
            {
              ticket_status: (o.ticket_status as string) ?? "PENDING",
              legs_total: (o.legs_total as number) ?? 0,
              legs_settled: (o.legs_settled as number) ?? 0,
            },
          ])
        );

        legsByTicket = {};
        for (const raw of legRes.data ?? []) {
          const leg = raw as unknown as HistoryLeg;
          (legsByTicket[leg.ticket_id] ??= []).push(leg);
        }
      }

      const mapped: HistoryTicket[] = page.map((t) => {
        const legs = (legsByTicket[t.id] ?? []).map((leg) => ({
          ...leg,
          ...legNames(t.legs, leg.fixture_id),
        }));
        const o = outcomes[t.id];
        return {
          id: t.id,
          created_at: t.created_at,
          total_odds: t.total_odds,
          ticket_mode: t.ticket_mode,
          status: o?.ticket_status ?? "PENDING",
          legs_total: o?.legs_total ?? legs.length,
          legs_settled: o?.legs_settled ?? legs.filter((l) => l.result_status !== "PENDING").length,
          legs,
        };
      });

      setTickets((prev) => (reset ? mapped : [...prev, ...mapped]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load ticket history");
      if (reset) setTickets([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (enabled && !started.current) {
      started.current = true;
      void fetchPage(true);
    }
  }, [enabled, fetchPage]);

  return {
    tickets,
    loading,
    loadingMore,
    error,
    hasMore,
    refetch: () => fetchPage(true),
    loadMore: () => fetchPage(false),
  };
}
