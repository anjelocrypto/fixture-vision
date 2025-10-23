import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, TrendingUp, Target, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TicketLeg {
  fixture_id: number;
  league: string;
  kickoff: string;
  home_team: string;
  away_team: string;
  pick: string;
  market: string;
  line: number;
  side: string;
  bookmaker: string;
  odds: number;
  model_prob: number;
  book_prob: number;
  edge: number;
  reason: string;
}

interface TicketData {
  mode: string;
  legs: TicketLeg[];
  total_odds: number;
  estimated_win_prob: number;
  notes: string;
  generated_at: string;
}

interface TicketDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: TicketData | null;
  loading: boolean;
}

export function TicketDrawer({ open, onOpenChange, ticket, loading }: TicketDrawerProps) {
  const { toast } = useToast();

  const copyTicket = () => {
    if (!ticket) return;

    const text = ticket.legs
      .map((leg, i) => 
        `${i + 1}. ${leg.home_team} vs ${leg.away_team}\n   ${leg.pick} @ ${leg.odds.toFixed(2)} (${leg.bookmaker})\n   Edge: +${(leg.edge * 100).toFixed(1)}%`
      )
      .join("\n\n");

    const fullText = `TICKET AI ${ticket.mode.toUpperCase()} TICKET\n\n${text}\n\nTotal Odds: ${ticket.total_odds.toFixed(2)}\nEst. Win Probability: ${(ticket.estimated_win_prob * 100).toFixed(1)}%`;

    navigator.clipboard.writeText(fullText);
    toast({
      title: "Ticket copied!",
      description: "Betting ticket copied to clipboard",
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Generated Ticket
          </SheetTitle>
          <SheetDescription>
            AI-powered betting selections based on value analysis
          </SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="mt-8 space-y-4">
            <div className="h-20 bg-muted animate-pulse rounded-lg" />
            <div className="h-20 bg-muted animate-pulse rounded-lg" />
            <div className="h-20 bg-muted animate-pulse rounded-lg" />
          </div>
        )}

        {!loading && ticket && (
          <div className="mt-6 space-y-6">
            {/* Header Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-card border rounded-lg p-3">
                <div className="text-xs text-muted-foreground">Mode</div>
                <div className="text-lg font-bold capitalize">{ticket.mode}</div>
              </div>
              <div className="bg-card border rounded-lg p-3">
                <div className="text-xs text-muted-foreground">Total Odds</div>
                <div className="text-lg font-bold text-primary">{ticket.total_odds.toFixed(2)}</div>
              </div>
              <div className="bg-card border rounded-lg p-3">
                <div className="text-xs text-muted-foreground">Win Prob</div>
                <div className="text-lg font-bold text-green-600">
                  {(ticket.estimated_win_prob * 100).toFixed(0)}%
                </div>
              </div>
            </div>

            {/* Legs */}
            <div className="space-y-3">
              <div className="text-sm font-medium">Selections ({ticket.legs.length} legs)</div>
              {ticket.legs.map((leg, index) => (
                <div
                  key={`${leg.fixture_id}-${index}`}
                  className="bg-card border rounded-lg p-4 space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">
                        {leg.home_team} vs {leg.away_team}
                      </div>
                      <div className="text-xs text-muted-foreground">{leg.league}</div>
                    </div>
                    <Badge variant="outline" className="ml-2">
                      #{index + 1}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t">
                    <div>
                      <div className="text-sm font-semibold text-primary capitalize">
                        {leg.market} {leg.pick}
                      </div>
                      <div className="text-xs text-muted-foreground">{leg.bookmaker}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold">@{leg.odds.toFixed(2)}</div>
                      <div className="flex items-center gap-1 text-xs text-green-600">
                        <TrendingUp className="h-3 w-3" />
                        +{(leg.edge * 100).toFixed(1)}% edge
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
                    <Target className="h-3 w-3" />
                    {leg.reason}
                  </div>
                </div>
              ))}
            </div>

            {/* Notes */}
            {ticket.notes && (
              <div className="bg-muted/50 rounded-lg p-3 flex gap-2">
                <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="text-xs text-muted-foreground">{ticket.notes}</div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button onClick={copyTicket} className="flex-1 gap-2">
                <Copy className="h-4 w-4" />
                Copy Ticket
              </Button>
            </div>
          </div>
        )}

        {!loading && !ticket && (
          <div className="mt-8 text-center text-muted-foreground">
            <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Generate a ticket to see selections</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
