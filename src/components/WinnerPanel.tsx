import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AddToTicketButton } from "@/components/AddToTicketButton";
import { TicketLeg } from "@/stores/useTicket";
import { InfoTooltip } from "@/components/shared/InfoTooltip";

interface WinnerPanelProps {
  onClose: () => void;
}

interface OutcomeSelection {
  id: number;
  fixture_id: number;
  league_id: number;
  utc_kickoff: string;
  outcome: string;
  odds: number;
  bookmaker: string;
  model_prob: number;
  edge_pct: number;
  market_type: string;
  fixtures?: {
    id: number;
    teams_home: any;
    teams_away: any;
  };
  leagues?: {
    name: string;
  };
}

type SortOption = "edge" | "odds" | "probability";

export function WinnerPanel({ onClose }: WinnerPanelProps) {
  const { t } = useTranslation(['winner']);
  const { toast } = useToast();
  const [outcome, setOutcome] = useState<"home" | "away">("home");
  const [minOdds, setMinOdds] = useState([1.4]);
  const [minProbability, setMinProbability] = useState([50]);
  const [sortBy, setSortBy] = useState<SortOption>("edge");
  const [results, setResults] = useState<OutcomeSelection[]>([]);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const in72h = new Date(now.getTime() + 72 * 60 * 60 * 1000);
      const minProbDecimal = minProbability[0] / 100;

      // Determine sort order
      let orderBy = "edge_pct.desc,odds.desc";
      if (sortBy === "odds") {
        orderBy = "odds.desc,edge_pct.desc";
      } else if (sortBy === "probability") {
        orderBy = "model_prob.desc,edge_pct.desc";
      }

      // Query pre-match view (automatically filters out live/finished matches)
      const { data, error } = await supabase
        .from("v_best_outcome_prices_prematch")
        .select(`
          *,
          fixtures!inner(
            id,
            teams_home,
            teams_away
          ),
          leagues!inner(
            name
          )
        `)
        .eq("market_type", "1x2")
        .eq("outcome", outcome)
        .gte("odds", minOdds[0])
        .gte("model_prob", minProbDecimal)
        .gte("utc_kickoff", now.toISOString())
        .lte("utc_kickoff", in72h.toISOString())
        .order(orderBy.split(",")[0].split(".")[0], { ascending: orderBy.includes("asc") })
        .limit(200);

      if (error) throw error;

      setResults(data || []);
      
      if (!data || data.length === 0) {
        toast({
          title: t('winner:no_matches_title'),
          description: t('winner:no_matches_description'),
        });
      } else {
        toast({
          title: t('winner:results_loaded'),
          description: t('winner:results_count', { count: data.length }),
        });
      }
    } catch (error: any) {
      console.error("Error fetching winner selections:", error);
      toast({
        title: "Error",
        description: "Failed to fetch selections. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    if (results.length > 0) {
      handleGenerate();
    }
  };

  return (
    <Card className="w-full shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            {t('winner:title')}
            <InfoTooltip
              label="Winner (1X2)"
              description="Find best value home and away win picks based on our models."
              bullets={[
                "Select home or away win outcome",
                "Filter by minimum odds and probability",
                "Sort by edge, odds, or probability",
                "Add strong value picks to your ticket"
              ]}
            />
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Outcome Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('winner:outcome')}</label>
          <ToggleGroup
            type="single"
            value={outcome}
            onValueChange={(value) => value && setOutcome(value as "home" | "away")}
            className="justify-start"
          >
            <ToggleGroupItem value="home" className="flex-1">
              {t('winner:home_win')}
            </ToggleGroupItem>
            <ToggleGroupItem value="away" className="flex-1">
              {t('winner:away_win')}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Min Odds Slider */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium">{t('winner:minimum_odds')}</label>
            <Badge variant="secondary">{minOdds[0].toFixed(2)}</Badge>
          </div>
          <Slider
            value={minOdds}
            onValueChange={setMinOdds}
            min={1.2}
            max={10}
            step={0.1}
            className="w-full"
          />
        </div>

        {/* Min Probability Slider */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium">{t('winner:minimum_probability')}</label>
            <Badge variant="secondary">{minProbability[0]}%</Badge>
          </div>
          <Slider
            value={minProbability}
            onValueChange={setMinProbability}
            min={0}
            max={100}
            step={1}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            {t('winner:probability_note')}
          </p>
        </div>

        {/* Sort By */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('winner:sort_by')}</label>
          <ToggleGroup
            type="single"
            value={sortBy}
            onValueChange={(value) => value && setSortBy(value as SortOption)}
            className="justify-start"
          >
            <ToggleGroupItem value="edge" className="flex-1">
              {t('winner:sort_edge')}
            </ToggleGroupItem>
            <ToggleGroupItem value="odds" className="flex-1">
              {t('winner:sort_odds')}
            </ToggleGroupItem>
            <ToggleGroupItem value="probability" className="flex-1">
              {t('winner:sort_probability')}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleGenerate}
            disabled={loading}
            className="flex-1 gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('winner:loading')}
              </>
            ) : (
              t('winner:generate_results')
            )}
          </Button>
          {results.length > 0 && (
            <Button
              onClick={handleRefresh}
              disabled={loading}
              variant="outline"
              size="icon"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Results List */}
        {results.length > 0 && (
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            <div className="text-sm font-medium text-muted-foreground">
              {results.length} {t('winner:results')}
            </div>
            {results.map((selection) => {
              const fixture = selection.fixtures;
              const league = selection.leagues;
              if (!fixture) return null;

              const kickoffDate = new Date(selection.utc_kickoff);
              const displayOutcome = selection.outcome === "home" ? "1 (Home)" : "2 (Away)";
              
              // Create TicketLeg for AddToTicketButton
              const leg: TicketLeg = {
                id: `${selection.fixture_id}-1x2-${selection.outcome}`,
                fixtureId: selection.fixture_id,
                homeTeam: fixture.teams_home?.name || "Home",
                awayTeam: fixture.teams_away?.name || "Away",
                kickoffUtc: selection.utc_kickoff,
                market: "1x2",
                side: selection.outcome as "home" | "away",
                line: "",
                odds: selection.odds,
                bookmaker: selection.bookmaker,
                rulesVersion: "winner_v1",
                isLive: false,
                source: "winner",
              };

              return (
                <Card key={selection.id} className="p-3">
                  <div className="space-y-2">
                    {/* League & Kickoff */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{league?.name}</span>
                      <span>{kickoffDate.toLocaleDateString()} {kickoffDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    {/* Teams */}
                    <div className="text-sm font-medium">
                      {fixture.teams_home?.name} vs {fixture.teams_away?.name}
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">{t('winner:stats_outcome')}</div>
                        <div className="font-semibold">{displayOutcome}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">{t('winner:stats_odds')}</div>
                        <div className="font-semibold">{selection.odds.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">{t('winner:stats_probability')}</div>
                        <div className="font-semibold">{(selection.model_prob * 100).toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">{t('winner:stats_edge')}</div>
                        <div className={`font-semibold ${selection.edge_pct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {(selection.edge_pct * 100).toFixed(1)}%
                        </div>
                      </div>
                    </div>

                    {/* Bookmaker & Add Button */}
                    <div className="flex items-center justify-between pt-2">
                      <div className="text-xs text-muted-foreground">
                        {t('winner:via_bookmaker', { bookmaker: selection.bookmaker })}
                      </div>
                      <AddToTicketButton leg={leg} size="sm" variant="default" />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {!loading && results.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {t('winner:empty_state')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
