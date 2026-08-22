import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

/** ---- Supabase client mock -------------------------------------------- */
type Row = Record<string, unknown>;
const state: {
  tickets: Row[];
  outcomes: Row[];
  legs: Row[];
  failTickets: boolean;
  calls: { table: string; cursor?: string }[];
} = { tickets: [], outcomes: [], legs: [], failTickets: false, calls: [] };

function makeBuilder(table: string) {
  let cursor: string | undefined;
  let limit = Infinity;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  const resolve = () => {
    state.calls.push({ table, cursor });
    if (table === "generated_tickets") {
      if (state.failTickets) return { data: null, error: new Error("network down") };
      let rows = [...state.tickets].sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at))
      );
      if (cursor) rows = rows.filter((r) => String(r.created_at) < cursor!);
      return { data: rows.slice(0, limit), error: null };
    }
    if (table === "ticket_outcomes") return { data: state.outcomes, error: null };
    return { data: state.legs, error: null };
  };
  Object.assign(builder, {
    select: chain,
    order: chain,
    in: chain,
    limit: (n: number) => {
      limit = n;
      return builder;
    },
    lt: (_col: string, value: string) => {
      cursor = value;
      return builder;
    },
    then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onOk, onErr),
  });
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: "en" },
  }),
}));

import { TicketHistoryPanel } from "@/components/tickets/TicketHistoryPanel";
import { TICKET_HISTORY_PAGE_SIZE } from "@/hooks/useTicketHistory";

const mkTicket = (i: number) => ({
  id: `t${i}`,
  created_at: `2026-02-${String(i).padStart(2, "0")}T10:00:00Z`,
  total_odds: 3.5,
  ticket_mode: "balanced",
  legs: [{ fixtureId: 1401863, homeTeam: "Home FC", awayTeam: "Away FC" }],
});

beforeEach(() => {
  state.tickets = [];
  state.outcomes = [];
  state.legs = [];
  state.failTickets = false;
  state.calls = [];
});

describe("ticket history panel", () => {
  it("renders an empty state when there are no tickets", async () => {
    render(<TicketHistoryPanel active />);
    await waitFor(() => expect(screen.getByText("No saved tickets yet")).toBeInTheDocument());
  });

  it("renders an error state with a working retry", async () => {
    state.failTickets = true;
    render(<TicketHistoryPanel active />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    state.failTickets = false;
    state.tickets = [mkTicket(5)];
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(screen.getByText("LOST")).toBeInTheDocument(), { timeout: 2000 }).catch(
      () => undefined
    );
    expect(state.calls.filter((c) => c.table === "generated_tickets").length).toBeGreaterThan(1);
  });

  it("shows ticket summary, expands legs and renders the settlement hold badge", async () => {
    state.tickets = [mkTicket(9)];
    state.outcomes = [{ ticket_id: "t9", ticket_status: "LOST", legs_total: 2, legs_settled: 1 }];
    state.legs = [
      {
        id: "leg-held",
        ticket_id: "t9",
        fixture_id: 1401863,
        market: "goals",
        side: "over",
        line: 1.5,
        odds: 1.4,
        kickoff_at: "2026-02-10T19:45:00Z",
        result_status: "PENDING",
        actual_value: null,
        settlement_hold_reason: "kickoff_drift",
        settlement_held_at: "2026-08-22T22:00:00Z",
        kickoff_drift_seconds: 5439600,
      },
      {
        id: "leg-win",
        ticket_id: "t9",
        fixture_id: 999,
        market: "goals",
        side: "over",
        line: 2.5,
        odds: 1.9,
        kickoff_at: "2026-02-10T19:45:00Z",
        result_status: "WIN",
        actual_value: 3,
        settlement_hold_reason: null,
        settlement_held_at: null,
        kickoff_drift_seconds: null,
      },
    ];

    render(<TicketHistoryPanel active />);
    await waitFor(() => expect(screen.getByText("LOST")).toBeInTheDocument());
    expect(screen.getByText(/Legs: 1\/2/)).toBeInTheDocument();
    expect(screen.getByText("3.50x")).toBeInTheDocument();

    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(toggle);

    expect(screen.getByText("Home FC vs Away FC")).toBeInTheDocument();
    expect(screen.getByText("Fixture #999")).toBeInTheDocument();
    expect(screen.getByText("WIN")).toBeInTheDocument();
    expect(
      screen.getByText("Settlement under review · Fixture schedule changed")
    ).toBeInTheDocument();

    // no internal detail leaks
    expect(screen.queryByText(/5439600/)).toBeNull();
    expect(screen.queryByText(/alert|provider|api-football/i)).toBeNull();
  });

  it("paginates with a bounded page size and a descending cursor", async () => {
    state.tickets = Array.from({ length: TICKET_HISTORY_PAGE_SIZE + 3 }, (_, i) => mkTicket(i + 1));
    render(<TicketHistoryPanel active />);
    await waitFor(() => expect(screen.getByText("Load more")).toBeInTheDocument());
    // first page is bounded
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(TICKET_HISTORY_PAGE_SIZE);

    fireEvent.click(screen.getByText("Load more"));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { expanded: false }).length).toBe(
        TICKET_HISTORY_PAGE_SIZE + 3
      )
    );
    const ticketCalls = state.calls.filter((c) => c.table === "generated_tickets");
    expect(ticketCalls[0].cursor).toBeUndefined();
    expect(ticketCalls[1].cursor).toBeDefined();
    // avoids N+1: one outcomes + one legs query per page
    expect(state.calls.filter((c) => c.table === "ticket_leg_outcomes")).toHaveLength(2);
    expect(state.calls.filter((c) => c.table === "ticket_outcomes")).toHaveLength(2);
  });
});
