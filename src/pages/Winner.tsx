import { useState, useEffect } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { TrendingUp, TrendingDown, Trophy, Target } from "lucide-react";
import { useAccess } from "@/hooks/useAccess";
import { PaywallGate } from "@/components/PaywallGate";
import { ScrollArea } from "@/components/ui/scroll-area";

interface OutcomeSelection {
  id: string;
  fixture_id: number;
  league_id: number;
  outcome: string;
  bookmaker: string;
  odds: number;
  model_prob: number;
  edge_pct: number;
  utc_kickoff: string;
  // Joined data
  home_team?: string;
  away_team?: string;
  league_name?: string;
  league_logo?: string;
  country_name?: string;
}

const Winner = () => {
  const { toast } = useToast();
  const { hasAccess, isWhitelisted, isAdmin } = useAccess();
  
  const [outcome, setOutcome] = useState<"1" | "2">("1");
  const [minOdds, setMinOdds] = useState(1.50);
  const [minProbability, setMinProbability] = useState(60);
  const [results, setResults] = useState<OutcomeSelection[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<"edge" | "odds" | "prob">("edge");

  const fetchResults = async () => {
    setLoading(true);
    try {
      const outcomeValue = outcome === "1" ? "home" : "away";
      const minProbDecimal = minProbability / 100;
      const now = new Date();
      const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);

      // Query outcome_selections with fixtures joined for team names
      const { data, error } = await supabase
        .from("outcome_selections")
        .select(`
          *,
          fixtures!inner(
            teams_home,
            teams_away
          ),
          leagues(
            name,
            logo,
            countries(name)
          )
        `)
        .eq("market_type", "1x2")
        .eq("outcome", outcomeValue)
        .gte("odds", minOdds)
        .gte("model_prob", minProbDecimal)
        .gte("utc_kickoff", now.toISOString())
        .lte("utc_kickoff", in72h.toISOString())
        .order("edge_pct", { ascending: false })
        .limit(500);

      if (error) {
        console.error("Query error:", error);
        toast({
          title: "Error fetching results",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      // Dedupe to best odds per fixture (client-side since we can't use DISTINCT ON with joins)
      const fixtureMap = new Map<number, any>();
      (data || []).forEach((row: any) => {
        const existing = fixtureMap.get(row.fixture_id);
        if (!existing || row.odds > existing.odds) {
          fixtureMap.set(row.fixture_id, {
            ...row,
            home_team: row.fixtures?.teams_home?.name || "Home",
            away_team: row.fixtures?.teams_away?.name || "Away",
            league_name: row.leagues?.name,
            league_logo: row.leagues?.logo,
            country_name: row.leagues?.countries?.name,
          });
        }
      });

      setResults(Array.from(fixtureMap.values()));
    } catch (err) {
      console.error("Fetch error:", err);
      toast({
        title: "Error",
        description: "Failed to fetch results",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResults();
  }, [outcome, minOdds, minProbability]);

  const sortedResults = [...results].sort((a, b) => {
    if (sortBy === "edge") return (b.edge_pct || 0) - (a.edge_pct || 0);
    if (sortBy === "odds") return (b.odds || 0) - (a.odds || 0);
    if (sortBy === "prob") return (b.model_prob || 0) - (a.model_prob || 0);
    return 0;
  });

  if (!hasAccess && !isWhitelisted && !isAdmin) {
    return (
      <PaywallGate feature="Winner Predictions">
        <div />
      </PaywallGate>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader />

      <div className="flex-1 container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold flex items-center gap-2 mb-2">
            <Trophy className="h-8 w-8 text-primary" />
            Winner Predictions
          </h1>
          <p className="text-muted-foreground">
            1X2 market selections powered by API-Football predictions
          </p>
        </div>

        {/* Controls */}
        <Card className="p-6 mb-6">
          <div className="space-y-6">
            {/* Outcome selector */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Outcome</Label>
              <div className="flex gap-2">
                <Button
                  variant={outcome === "1" ? "default" : "outline"}
                  onClick={() => setOutcome("1")}
                  className="flex-1 gap-2"
                >
                  <TrendingUp className="h-4 w-4" />
                  1 (Home Win)
                </Button>
                <Button
                  variant={outcome === "2" ? "default" : "outline"}
                  onClick={() => setOutcome("2")}
                  className="flex-1 gap-2"
                >
                  <TrendingDown className="h-4 w-4" />
                  2 (Away Win)
                </Button>
              </div>
            </div>

            {/* Min Odds */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label className="text-sm font-medium">Minimum Odds</Label>
                <Badge variant="secondary">{minOdds.toFixed(2)}</Badge>
              </div>
              <Slider
                value={[minOdds]}
                onValueChange={([value]) => setMinOdds(value)}
                min={1.20}
                max={10.00}
                step={0.01}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1.20</span>
                <span>10.00</span>
              </div>
            </div>

            {/* Min Probability */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label className="text-sm font-medium">Minimum Probability</Label>
                <Badge variant="secondary">{minProbability}%</Badge>
              </div>
              <Slider
                value={[minProbability]}
                onValueChange={([value]) => setMinProbability(value)}
                min={0}
                max={100}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>0%</span>
                <span>100%</span>
              </div>
            </div>

            {/* Sort controls */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Sort By</Label>
              <div className="flex gap-2">
                <Button
                  variant={sortBy === "edge" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSortBy("edge")}
                >
                  Edge
                </Button>
                <Button
                  variant={sortBy === "odds" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSortBy("odds")}
                >
                  Odds
                </Button>
                <Button
                  variant={sortBy === "prob" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSortBy("prob")}
                >
                  Probability
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Results */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">
              Results <Badge variant="outline">{sortedResults.length}</Badge>
            </h2>
            <Button
              onClick={fetchResults}
              disabled={loading}
              variant="outline"
              size="sm"
            >
              {loading ? "Loading..." : "Refresh"}
            </Button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="p-4 animate-pulse">
                  <div className="h-20 bg-muted rounded" />
                </Card>
              ))}
            </div>
          ) : sortedResults.length === 0 ? (
            <Card className="p-12 text-center">
              <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                No matches found with these criteria. Try adjusting your filters.
              </p>
            </Card>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="space-y-2 pr-4">
                {sortedResults.map((result) => (
                  <Card key={result.id} className="p-4 hover:bg-accent/50 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          {result.league_logo && (
                            <img
                              src={result.league_logo}
                              alt=""
                              className="w-5 h-5 object-contain"
                            />
                          )}
                          <Badge variant="outline" className="text-xs">
                            {result.league_name || `League ${result.league_id}`}
                          </Badge>
                          {result.country_name && (
                            <span className="text-xs text-muted-foreground">
                              {result.country_name}
                            </span>
                          )}
                        </div>
                        <div className="font-medium mb-1">
                          {result.home_team || "Home"} vs {result.away_team || "Away"}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {format(new Date(result.utc_kickoff), "MMM dd, HH:mm")}
                        </div>
                      </div>

                      <div className="text-right space-y-2">
                        <div>
                          <div className="text-2xl font-bold text-primary">
                            {result.odds.toFixed(2)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {result.bookmaker}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Badge
                            variant={result.edge_pct > 0 ? "default" : "secondary"}
                          >
                            {result.edge_pct > 0 ? "+" : ""}
                            {(result.edge_pct * 100).toFixed(1)}% edge
                          </Badge>
                          <Badge variant="outline">
                            {(result.model_prob * 100).toFixed(0)}% prob
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  );
};

export default Winner;
