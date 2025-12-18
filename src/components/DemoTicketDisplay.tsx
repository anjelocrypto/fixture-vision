import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Trophy, Sparkles } from "lucide-react";
import { DemoTicket } from "@/components/DemoTicketCreatorDialog";

interface DemoTicketDisplayProps {
  ticket: DemoTicket;
  onSignUpClick: () => void;
  onGenerateAnother: () => void;
}

export function DemoTicketDisplay({ ticket, onSignUpClick, onGenerateAnother }: DemoTicketDisplayProps) {
  const { legs, totalOdds, result } = ticket;

  return (
    <div className="space-y-4">
      {/* Ticket Header */}
      <Card className="p-4 bg-green-500/10 border-green-500/30">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-green-500" />
            <span className="font-semibold">
              Demo Ticket ({legs.length} legs)
            </span>
          </div>
          <Badge className="bg-green-500">
            WON
          </Badge>
        </div>
        
        <div className="grid grid-cols-3 gap-4 text-center mt-4">
          <div>
            <div className="text-xs text-muted-foreground">Total Odds</div>
            <div className="text-xl font-bold text-primary">{totalOdds.toFixed(2)}x</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">All Legs</div>
            <div className="text-xl font-bold text-green-500">
              {result.totalLegs}/{result.totalLegs} ✓
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Return ($10 stake)</div>
            <div className="text-xl font-bold text-green-500">
              ${result.potentialReturn.toFixed(2)}
            </div>
          </div>
        </div>
      </Card>

      {/* Legs */}
      <div className="space-y-2">
        {legs.map((leg, idx) => (
          <Card 
            key={`${leg.fixtureId}-${leg.market}-${idx}`}
            className="p-3 border-l-4 border-l-green-500 bg-green-500/5"
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">
                    {leg.homeTeam} vs {leg.awayTeam}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="secondary" className="capitalize text-xs">
                    {leg.market} {leg.side} {leg.line}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    @ {leg.odds.toFixed(2)}
                  </span>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Result</div>
                  <div className="font-semibold">{leg.result.actual}</div>
                </div>
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-green-500/20 text-green-500">
                  <Check className="h-4 w-4" />
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onGenerateAnother}>
          <Sparkles className="h-4 w-4 mr-2" />
          Generate Another
        </Button>
      </div>

      {/* CTA */}
      <Card className="p-4 border-dashed border-primary/40 bg-primary/5 text-center">
        <p className="text-sm text-muted-foreground mb-2">
          This winning ticket uses verified historical data. Want AI tickets for today's matches?
        </p>
        <button 
          onClick={onSignUpClick}
          className="text-primary font-medium hover:underline"
        >
          Create account for live AI Tickets →
        </button>
      </Card>
    </div>
  );
}
