import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, TrendingUp, Target, AlertCircle, Sparkles, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AddToTicketButton } from "./AddToTicketButton";
import { TicketLeg as MyTicketLeg } from "@/stores/useTicket";
import { GeminiAnalysis } from "./GeminiAnalysis";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";

interface TicketLeg {
  fixture_id: number;
  league?: string;
  kickoff?: string;
  home_team: string;
  away_team: string;
  pick: string;
  market: string;
  line?: number;
  side?: string;
  bookmaker: string;
  odds: number;
  model_prob?: number;
  book_prob?: number;
  edge?: number;
  reason?: string;
}

interface TicketData {
  mode: string;
  legs: TicketLeg[];
  total_odds: number;
  estimated_win_prob?: number | null;
  notes?: string;
  generated_at?: string;
  used_live?: boolean;
  fallback_to_prematch?: boolean;
  target_min?: number;
  target_max?: number;
  within_band?: boolean;
  suggestions?: string[];
}

interface TicketDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: TicketData | null;
  loading: boolean;
}

export function TicketDrawer({ open, onOpenChange, ticket, loading }: TicketDrawerProps) {
  const { toast } = useToast();
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);

  const copyTicket = () => {
    if (!ticket) return;

    const text = ticket.legs
      .map((leg, i) => {
        const edgeText = leg.edge ? `\n   Edge: +${(leg.edge * 100).toFixed(1)}%` : "";
        return `${i + 1}. ${leg.home_team} vs ${leg.away_team}\n   ${leg.pick} @ ${leg.odds.toFixed(2)} (${leg.bookmaker})${edgeText}`;
      })
      .join("\n\n");

    const winProbText = ticket.estimated_win_prob 
      ? `\nEst. Win Probability: ${ticket.estimated_win_prob.toFixed(1)}%` 
      : "";

    const fullText = `TICKET AI ${ticket.mode.toUpperCase()} TICKET\n\n${text}\n\nTotal Odds: ${ticket.total_odds.toFixed(2)}${winProbText}`;

    navigator.clipboard.writeText(fullText);
    toast({
      title: "Ticket copied!",
      description: "Betting ticket copied to clipboard",
    });
  };

  const analyzeWithGemini = async () => {
    if (!ticket) return;

    setAnalyzing(true);
    setAnalysis(null);

    try {
      const { data, error } = await supabase.functions.invoke('analyze-ticket', {
        body: { ticket }
      });

      if (error) throw error;

      if (data?.analysis) {
        setAnalysis(data.analysis);
        toast({
          title: "Analysis complete!",
          description: "Gemini has analyzed your ticket",
        });
      } else {
        throw new Error('No analysis data received');
      }
    } catch (error) {
      console.error('Error analyzing ticket:', error);
      toast({
        title: "Analysis failed",
        description: error instanceof Error ? error.message : "Failed to analyze ticket",
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
    }
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
            {/* Target vs Result (if target specified) */}
            {ticket.target_min !== undefined && ticket.target_max !== undefined && (
              <div className={`rounded-lg border p-4 ${ticket.within_band === false ? 'bg-destructive/5 border-destructive/30' : 'bg-primary/5 border-primary/30'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium">Target Range</div>
                  <div className="text-sm font-bold">{ticket.target_min}–{ticket.target_max}x</div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Result</div>
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-bold">{ticket.total_odds.toFixed(2)}x</div>
                    {ticket.within_band === false ? (
                      <Badge variant="destructive" className="text-xs">❌ Outside</Badge>
                    ) : (
                      <Badge variant="default" className="text-xs bg-green-600">✅ Within</Badge>
                    )}
                  </div>
                </div>
                
                {/* Suggestions for near-miss */}
                {ticket.within_band === false && ticket.suggestions && (
                  <div className="mt-3 pt-3 border-t space-y-1">
                    <div className="text-xs font-medium text-muted-foreground">Suggestions:</div>
                    {ticket.suggestions.map((suggestion, idx) => (
                      <div key={idx} className="text-xs text-muted-foreground flex gap-1">
                        <span className="text-primary">•</span>
                        <span>{suggestion}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {/* Header Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-card border rounded-lg p-3">
                <div className="text-xs text-muted-foreground">Mode</div>
                <div className="text-lg font-bold capitalize">{ticket.mode}</div>
              </div>
              <div className="bg-card border rounded-lg p-3">
                <div className="text-xs text-muted-foreground">Total Odds</div>
                <div className={`text-lg font-bold ${ticket.within_band === false ? 'text-destructive' : 'text-primary'}`}>
                  {ticket.total_odds.toFixed(2)}
                </div>
              </div>
              <div className="bg-card border rounded-lg p-3">
                <div className="text-xs text-muted-foreground">Win Prob</div>
                <div className="text-lg font-bold text-green-600">
                  {ticket.estimated_win_prob 
                    ? `${ticket.estimated_win_prob.toFixed(1)}%`
                    : "—"}
                </div>
              </div>
            </div>

            {/* Legs */}
            <div className="space-y-3">
              <div className="text-sm font-medium">Selections ({ticket.legs.length} legs)</div>
              {ticket.legs.map((leg, index) => {
                // Parse the pick to extract side and line (e.g., "Over 2.5" -> side: "over", line: 2.5)
                const pickLower = leg.pick.toLowerCase();
                const side = pickLower.includes('over') ? 'over' : pickLower.includes('under') ? 'under' : 'over';
                const lineMatch = leg.pick.match(/(\d+\.?\d*)/);
                const line = lineMatch ? parseFloat(lineMatch[1]) : (leg.line || 2.5);
                
                return (
                  <div
                    key={`${leg.fixture_id}-${index}`}
                    className="bg-card border rounded-lg p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 flex-1">
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
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-primary capitalize">
                          {leg.market} {leg.pick}
                        </div>
                        <div className="text-xs text-muted-foreground">{leg.bookmaker}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold">@{leg.odds.toFixed(2)}</div>
                        {leg.edge && (
                          <div className="flex items-center gap-1 text-xs text-green-600">
                            <TrendingUp className="h-3 w-3" />
                            +{(leg.edge * 100).toFixed(1)}% edge
                          </div>
                        )}
                      </div>
                    </div>

                    {leg.reason && (
                      <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
                        <Target className="h-3 w-3" />
                        {leg.reason}
                      </div>
                    )}

                    {/* Add to My Ticket Button */}
                    <div className="pt-2 border-t">
                      <AddToTicketButton
                        leg={{
                          id: `${leg.fixture_id}-${leg.market}-${side}-${line}`,
                          fixtureId: leg.fixture_id,
                          leagueId: 0, // Not available in generated ticket
                          countryCode: undefined,
                          homeTeam: leg.home_team,
                          awayTeam: leg.away_team,
                          kickoffUtc: leg.kickoff || new Date().toISOString(),
                          market: leg.market as MyTicketLeg['market'],
                          side: side as 'over' | 'under',
                          line: line,
                          odds: leg.odds,
                          bookmaker: leg.bookmaker,
                          rulesVersion: 'v2_combined_matrix_v1',
                          combinedAvg: undefined,
                          isLive: ticket.used_live || false,
                          source: 'ticket_creator',
                        }}
                        size="sm"
                        variant="outline"
                      />
                    </div>
                  </div>
                );
              })}
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
              <Button onClick={copyTicket} className="flex-1 gap-2" variant="outline">
                <Copy className="h-4 w-4" />
                Copy Ticket
              </Button>
              <Button 
                onClick={analyzeWithGemini} 
                className="flex-1 gap-2"
                disabled={analyzing}
              >
                {analyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Analyze with Gemini
                  </>
                )}
              </Button>
            </div>

            {/* Gemini Analysis */}
            {analysis && (
              <GeminiAnalysis 
                overallSummary={analysis.overall_summary}
                matches={analysis.matches}
              />
            )}
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
