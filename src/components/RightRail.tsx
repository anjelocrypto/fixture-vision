import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle, TrendingUp, Plus } from "lucide-react";
import { useEffect, useState } from "react";

interface TeamStats {
  goals: number;
  cards: number;
  offsides: number;
  corners: number;
  fouls: number;
}

interface SuggestedMarket {
  market: string;
  line: number;
  side: string;
  model_prob: number;
  book_prob: number;
  edge: number;
  odds: number;
  bookmaker: string;
  confidence?: string;
  normalized_sum?: number;
  computed_at?: string;
}

interface Analysis {
  home: TeamStats & { 
    team_id: number;
    sample_size: number;
    computed_at: string;
    name?: string;
    logo?: string;
  };
  away: TeamStats & { 
    team_id: number;
    sample_size: number;
    computed_at: string;
    name?: string;
    logo?: string;
  };
  combined: TeamStats & { sample_size: number };
  odds_available?: boolean;
}

interface RightRailProps {
  analysis: Analysis | null;
  loading: boolean;
  suggested_markets?: SuggestedMarket[];
  onAddToTicket?: (market: SuggestedMarket) => void;
}

function StatRow({ label, value }: { label: string; value: number }) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const duration = 200;
    const steps = 10;
    const increment = value / steps;
    let current = 0;

    const timer = setInterval(() => {
      current += increment;
      if (current >= value) {
        setDisplayValue(value);
        clearInterval(timer);
      } else {
        setDisplayValue(Math.round(current * 10) / 10);
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [value]);

  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0 min-w-0 gap-2">
      <span className="text-sm text-muted-foreground truncate">{label}</span>
      <span className="text-sm font-bold tabular-nums shrink-0">{displayValue.toFixed(1)}</span>
    </div>
  );
}

export function RightRail({ analysis, loading, suggested_markets = [], onAddToTicket }: RightRailProps) {
  const [addingMarket, setAddingMarket] = useState<string | null>(null);

  const handleAddMarket = (market: SuggestedMarket) => {
    setAddingMarket(`${market.market}-${market.line}`);
    onAddToTicket?.(market);
    setTimeout(() => setAddingMarket(null), 1000);
  };

  if (!analysis && !loading) {
    return (
      <div className="w-full sm:w-[380px] border-l border-border bg-card/30 backdrop-blur-sm p-4 sm:p-6">
        <Card className="p-4 sm:p-6 text-center">
          <p className="text-sm sm:text-base text-muted-foreground">
            Select a fixture and click <span className="text-primary font-medium">Analyse</span> to
            view AI predictions
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full sm:w-[380px] border-l border-border bg-card/30 backdrop-blur-sm p-4 sm:p-6 overflow-y-auto overflow-x-hidden">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : analysis ? (
        <div className="space-y-4 min-w-0">
          {/* Header */}
          <Card className="p-4 bg-primary/5 border-primary/20 min-w-0">
            <div className="flex items-center justify-between mb-3 min-w-0">
              <h3 className="text-lg font-semibold truncate">AI Analysis</h3>
              <Badge variant="outline" className="border-primary/30 text-primary shrink-0 ml-2">
                BETAI 0.2
              </Badge>
            </div>
            
            {/* Status Chips */}
            <div className="flex flex-wrap gap-2 min-w-0">
              {(analysis.home.sample_size < 5 || analysis.away.sample_size < 5) && (
                <div className="flex items-center gap-1 text-xs bg-amber-500/10 text-amber-500 px-2 py-1 rounded-full border border-amber-500/20">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Uncertainty</span>
                </div>
              )}
              {analysis.odds_available && (
                <div className="flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full border border-primary/20">
                  <TrendingUp className="h-3 w-3" />
                  <span>Odds Available</span>
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {new Date(analysis.home.computed_at).toLocaleTimeString()}
              </div>
            </div>
          </Card>

          {/* Suggested Markets */}
          {suggested_markets.length > 0 ? (
            <div className="space-y-3 min-w-0">
              <div className="flex items-center justify-between min-w-0">
                <h4 className="text-sm font-semibold truncate">Suggested Markets</h4>
                <Badge variant="secondary" className="text-xs shrink-0 ml-2">Value</Badge>
              </div>
              
              {suggested_markets.slice(0, 4).map((market, idx) => (
                <Card key={idx} className="p-3 bg-card/50 hover:bg-card transition-colors min-w-0">
                  <div className="space-y-2 min-w-0">
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <div className="text-sm font-medium capitalize truncate">
                            {market.market} {market.side} {market.line}
                          </div>
                          {market.normalized_sum && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0">
                              Σ={market.normalized_sum.toFixed(2)}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {market.bookmaker}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold whitespace-nowrap">@{market.odds.toFixed(2)}</div>
                        <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/20 whitespace-nowrap">
                          +{(market.edge * 100).toFixed(1)}%
                        </Badge>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-1.5 border-t text-xs gap-2 min-w-0">
                      <div className="text-muted-foreground truncate flex-1 min-w-0">
                        Model {(market.model_prob * 100).toFixed(0)}% vs Book {(market.book_prob * 100).toFixed(0)}%
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 gap-1 text-xs"
                        onClick={() => handleAddMarket(market)}
                        disabled={addingMarket === `${market.market}-${market.line}`}
                      >
                        <Plus className="h-3 w-3" />
                        {addingMarket === `${market.market}-${market.line}` ? "Added" : "Add"}
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : analysis?.odds_available && (
            <Card className="p-4 text-center text-sm text-muted-foreground">
              <p>No value opportunities found for this fixture.</p>
              <p className="text-xs mt-1">Model probabilities may be too close to bookmaker odds.</p>
            </Card>
          )}

          {/* Home Team */}
          <Card className="p-4 min-w-0">
            <div className="flex items-center gap-3 mb-4 min-w-0">
              {analysis.home.logo && <img src={analysis.home.logo} alt={analysis.home.name || 'Home'} className="w-8 h-8 shrink-0" />}
              <h4 className="font-semibold truncate">{analysis.home.name || `Team ${analysis.home.team_id}`}</h4>
            </div>
            <div className="space-y-1">
              <StatRow label="Goals" value={analysis.home.goals} />
              <StatRow label="Cards" value={analysis.home.cards} />
              <StatRow label="Offsides" value={analysis.home.offsides} />
              <StatRow label="Corners" value={analysis.home.corners} />
              <StatRow label="Fouls" value={analysis.home.fouls} />
            </div>
          </Card>

          {/* Away Team */}
          <Card className="p-4 min-w-0">
            <div className="flex items-center gap-3 mb-4 min-w-0">
              {analysis.away.logo && <img src={analysis.away.logo} alt={analysis.away.name || 'Away'} className="w-8 h-8 shrink-0" />}
              <h4 className="font-semibold truncate">{analysis.away.name || `Team ${analysis.away.team_id}`}</h4>
            </div>
            <div className="space-y-1">
              <StatRow label="Goals" value={analysis.away.goals} />
              <StatRow label="Cards" value={analysis.away.cards} />
              <StatRow label="Offsides" value={analysis.away.offsides} />
              <StatRow label="Corners" value={analysis.away.corners} />
              <StatRow label="Fouls" value={analysis.away.fouls} />
            </div>
          </Card>

          {/* Combined Stats */}
          <Card className="p-4 border-primary/30 min-w-0">
            <h4 className="font-semibold mb-3 text-primary truncate">Combined Stats</h4>
            <div className="space-y-1">
              <StatRow label="Goals" value={analysis.combined.goals} />
              <StatRow label="Cards" value={analysis.combined.cards} />
              <StatRow label="Offsides" value={analysis.combined.offsides} />
              <StatRow label="Corners" value={analysis.combined.corners} />
              <StatRow label="Fouls" value={analysis.combined.fouls} />
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
