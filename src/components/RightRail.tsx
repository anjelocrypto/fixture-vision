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
  home: {
    name: string;
    logo: string;
    stats: TeamStats & { sample_size: number };
  };
  away: {
    name: string;
    logo: string;
    stats: TeamStats & { sample_size: number };
  };
  combined: TeamStats;
  is_stale?: boolean;
  computed_at: string;
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
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-bold tabular-nums">{displayValue.toFixed(1)}</span>
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
      <div className="w-[380px] border-l border-border bg-card/30 backdrop-blur-sm p-6">
        <Card className="p-6 text-center">
          <p className="text-muted-foreground">
            Select a fixture and click <span className="text-primary font-medium">Analyse</span> to
            view AI predictions
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-[380px] border-l border-border bg-card/30 backdrop-blur-sm p-6 overflow-y-auto">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : analysis ? (
        <div className="space-y-4">
          {/* Header */}
          <Card className="p-4 bg-primary/5 border-primary/20">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">AI Analysis</h3>
              <Badge variant="outline" className="border-primary/30 text-primary">
                BETAI 0.2
              </Badge>
            </div>
            
            {/* Status Chips */}
            <div className="flex flex-wrap gap-2">
              {analysis.is_stale && (
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
                {new Date(analysis.computed_at).toLocaleTimeString()}
              </div>
            </div>
          </Card>

          {/* Suggested Markets */}
          {suggested_markets.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Suggested Markets</h4>
                <Badge variant="secondary" className="text-xs">Value</Badge>
              </div>
              
              {suggested_markets.slice(0, 4).map((market, idx) => (
                <Card key={idx} className="p-3 bg-card/50 hover:bg-card transition-colors">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-medium capitalize">
                            {market.market} {market.side} {market.line}
                          </div>
                          {market.normalized_sum && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                              Σ={market.normalized_sum.toFixed(2)}
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {market.bookmaker}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold">@{market.odds.toFixed(2)}</div>
                        <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/20">
                          +{(market.edge * 100).toFixed(1)}%
                        </Badge>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-1.5 border-t text-xs">
                      <div className="text-muted-foreground">
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
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-4">
              <img src={analysis.home.logo} alt={analysis.home.name} className="w-8 h-8" />
              <h4 className="font-semibold">{analysis.home.name}</h4>
            </div>
            <div className="space-y-1">
              <StatRow label="Goals" value={analysis.home.stats.goals} />
              <StatRow label="Cards" value={analysis.home.stats.cards} />
              <StatRow label="Offsides" value={analysis.home.stats.offsides} />
              <StatRow label="Corners" value={analysis.home.stats.corners} />
              <StatRow label="Fouls" value={analysis.home.stats.fouls} />
            </div>
          </Card>

          {/* Away Team */}
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-4">
              <img src={analysis.away.logo} alt={analysis.away.name} className="w-8 h-8" />
              <h4 className="font-semibold">{analysis.away.name}</h4>
            </div>
            <div className="space-y-1">
              <StatRow label="Goals" value={analysis.away.stats.goals} />
              <StatRow label="Cards" value={analysis.away.stats.cards} />
              <StatRow label="Offsides" value={analysis.away.stats.offsides} />
              <StatRow label="Corners" value={analysis.away.stats.corners} />
              <StatRow label="Fouls" value={analysis.away.stats.fouls} />
            </div>
          </Card>

          {/* Combined Stats */}
          <Card className="p-4 border-primary/30">
            <h4 className="font-semibold mb-3 text-primary">Combined Stats</h4>
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
