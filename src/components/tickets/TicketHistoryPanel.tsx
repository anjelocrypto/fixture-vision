import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronDown, History, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateWithLocale } from "@/lib/i18nFormatters";
import { useTicketHistory, type HistoryLeg, type HistoryTicket } from "@/hooks/useTicketHistory";
import { SettlementHoldBadge } from "./SettlementHoldBadge";

function statusClasses(status: string) {
  switch (status) {
    case "WON":
      return "bg-primary/15 text-primary border-primary/30";
    case "LOST":
      return "bg-destructive/10 text-destructive border-destructive/30";
    case "VOID":
      return "bg-muted/40 text-muted-foreground border-border/40";
    default:
      return "bg-muted/30 text-foreground border-border/40";
  }
}

function LegRow({ leg, locale }: { leg: HistoryLeg; locale: string }) {
  const { t } = useTranslation("common");
  return (
    <li className="rounded-lg border border-border/40 bg-card/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">
            {leg.home_team && leg.away_team
              ? `${leg.home_team} ${t("vs")} ${leg.away_team}`
              : `${t("history_fixture", "Fixture")} #${leg.fixture_id}`}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            <span className="uppercase">{leg.market}</span>
            {leg.side ? ` · ${leg.side}` : ""}
            {leg.line != null ? ` ${leg.line}` : ""}
            {leg.odds != null ? ` · @${Number(leg.odds).toFixed(2)}` : ""}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {leg.kickoff_at
              ? formatDateWithLocale(new Date(leg.kickoff_at), "MMM d, HH:mm", locale)
              : "—"}
            {leg.actual_value != null
              ? ` · ${t("history_actual", "Actual")}: ${Number(leg.actual_value)}`
              : ""}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tabular-nums",
            statusClasses(leg.result_status)
          )}
        >
          {leg.result_status}
        </span>
      </div>
      {leg.settlement_hold_reason && (
        <div className="mt-2">
          <SettlementHoldBadge reason={leg.settlement_hold_reason} className="text-[10px]" />
        </div>
      )}
    </li>
  );
}

function TicketCard({ ticket, locale }: { ticket: HistoryTicket; locale: string }) {
  const { t } = useTranslation("common");
  const [expanded, setExpanded] = useState(false);
  const panelId = `ticket-history-legs-${ticket.id}`;

  return (
    <li className="rounded-xl border border-border/40 bg-card/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="w-full text-left px-3.5 py-3 hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {formatDateWithLocale(new Date(ticket.created_at), "MMM d, HH:mm", locale)}
              {ticket.ticket_mode ? ` · ${ticket.ticket_mode}` : ""}
            </p>
            <p className="mt-1 text-sm font-semibold tabular-nums">
              {ticket.total_odds != null ? `${Number(ticket.total_odds).toFixed(2)}x` : "—"}
              <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                {t("history_legs_settled", "Legs")}: {ticket.legs_settled}/{ticket.legs_total}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={cn(
                "rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase",
                statusClasses(ticket.status)
              )}
            >
              {ticket.status}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")}
            />
          </div>
        </div>
      </button>
      {expanded && (
        <ul id={panelId} className="space-y-2 border-t border-border/40 bg-background/40 p-3">
          {ticket.legs.length === 0 ? (
            <li className="text-xs text-muted-foreground">{t("history_no_legs", "No leg details available")}</li>
          ) : (
            ticket.legs.map((leg) => <LegRow key={leg.id} leg={leg} locale={locale} />)
          )}
        </ul>
      )}
    </li>
  );
}

export function TicketHistoryPanel({ active }: { active: boolean }) {
  const { t, i18n } = useTranslation("common");
  const { tickets, loading, loadingMore, error, hasMore, refetch, loadMore } = useTicketHistory(active);

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-live="polite">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-muted/30 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-14 text-center" role="alert">
        <AlertTriangle className="h-8 w-8 text-destructive mb-3" aria-hidden="true" />
        <p className="text-sm font-semibold">{t("history_error_title", "Couldn't load ticket history")}</p>
        <p className="mt-1 max-w-[260px] text-xs text-muted-foreground">
          {t("history_error_body", "Please check your connection and try again.")}
        </p>
        <button
          type="button"
          onClick={refetch}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-border/50 bg-card/50 px-4 h-9 text-xs font-medium hover:bg-muted/50"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {t("history_retry", "Retry")}
        </button>
      </div>
    );
  }

  if (tickets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border/40 bg-muted/30">
          <History className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
        </div>
        <h3 className="text-base font-semibold">{t("history_empty_title", "No saved tickets yet")}</h3>
        <p className="mt-1 max-w-[260px] text-xs text-muted-foreground">
          {t("history_empty_body", "Generated tickets and their results will appear here.")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {tickets.map((ticket) => (
          <TicketCard key={ticket.id} ticket={ticket} locale={i18n.language} />
        ))}
      </ul>
      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full h-10 rounded-xl border border-border/50 bg-card/50 text-xs font-medium hover:bg-muted/50 disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {t("history_load_more", "Load more")}
        </button>
      )}
    </div>
  );
}

export default TicketHistoryPanel;
