import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AddToTicketButton } from "@/components/AddToTicketButton";
import { TicketLeg } from "@/stores/useTicket";

interface TeamTotalsPanelProps {
  onClose: () => void;
}

interface TeamTotalsCandidate {
  id: number;
  fixture_id: number;
  league_id: number;
  team_id: number;
  team_context: "home" | "away";
  line: number;
  season_scoring_rate: number;
  opponent_season_conceding_rate: number;
  opponent_recent_conceded_2plus: number;
  recent_sample_size: number;
  rules_passed: boolean;
  utc_kickoff: string;
  computed_at: string;
  fixtures?: {
    id: number;
    teams_home: any;
    teams_away: any;
  };
  leagues?: {
    name: string;
  };
}

export function TeamTotalsPanel({ onClose }: TeamTotalsPanelProps) {
  const { t } = useTranslation(["common"]);
  const { toast } = useToast();
  const [position, setPosition] = useState<"home" | "away">("home");
  const [results, setResults] = useState<TeamTotalsCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const now = new Date();
      const in120h = new Date(now.getTime() + 120 * 60 * 60 * 1000);

      const { data, error } = await supabase
        .from("v_team_totals_prematch")
        .select(
          `
          *,
          fixtures!inner(
            id,
            teams_home,
            teams_away
          ),
          leagues!inner(
            name
          )
        `
        )
        .eq("team_context", position)
        .gte("utc_kickoff", now.toISOString())
        .lte("utc_kickoff", in120h.toISOString())
        .order("utc_kickoff", { ascending: true })
        .limit(100);

      if (error) throw error;

      setResults((data as any[]) || []);

      if (!data || data.length === 0) {
        toast({
          title: "No candidates found",
          description: `No ${position === "home" ? "Home" : "Away"} O1.5 candidates match the criteria. Try the other side or check fixtures closer to the weekend.`,
        });
      } else {
        toast({
          title: "Results loaded",
          description: `Found ${data.length} ${position === "home" ? "Home" : "Away"} O1.5 candidates`,
        });
      }
    } catch (error: any) {
      console.error("Error fetching team totals:", error);
      toast({
        title: "Error",
        description: "Failed to fetch candidates. Please try again.",
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

  const copyPickToClipboard = (candidate: TeamTotalsCandidate) => {
    const fixture = candidate.fixtures;
    if (!fixture) return;

    const teamName = candidate.team_context === "home" 
      ? fixture.teams_home?.name 
      : fixture.teams_away?.name;

    const text = `${teamName} to score over 1.5 goals (model) — ${fixture.teams_home?.name} vs ${fixture.teams_away?.name}`;
    
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: "Pick copied to clipboard",
    });
  };

  return (
    <Card className="w-full shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Target className="h-5 w-5" />
            Team Totals (O1.5)
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Model-only predictions (no odds displayed)
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Position Selector */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Position</label>
          <ToggleGroup
            type="single"
            value={position}
            onValueChange={(value) => value && setPosition(value as "home" | "away")}
            className="justify-start"
          >
            <ToggleGroupItem value="home" className="flex-1">
              Home O1.5
            </ToggleGroupItem>
            <ToggleGroupItem value="away" className="flex-1">
              Away O1.5
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            Click Generate after changing position
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button onClick={handleGenerate} disabled={loading} className="flex-1 gap-2">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              "Generate"
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
              {results.length} candidates
            </div>
            {results.map((candidate) => {
              const fixture = candidate.fixtures;
              const league = candidate.leagues;
              if (!fixture) return null;

              const kickoffDate = new Date(candidate.utc_kickoff);
              const teamName =
                candidate.team_context === "home"
                  ? fixture.teams_home?.name
                  : fixture.teams_away?.name;

              // Create TicketLeg for AddToTicketButton
              const leg: TicketLeg = {
                id: `${candidate.fixture_id}-team-total-${candidate.team_context}`,
                fixtureId: candidate.fixture_id,
                homeTeam: fixture.teams_home?.name || "Home",
                awayTeam: fixture.teams_away?.name || "Away",
                kickoffUtc: candidate.utc_kickoff,
                market: "goals" as any, // team_total displayed as goals O1.5
                side: candidate.team_context,
                line: "1.5",
                odds: 0, // Model only, no odds
                bookmaker: "model",
                rulesVersion: "team_totals_v1",
                isLive: false,
                source: "filterizer" as any, // Use existing source type
              };

              return (
                <Card key={candidate.id} className="p-3">
                  <div className="space-y-2">
                    {/* League & Kickoff */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{league?.name}</span>
                      <span>
                        {kickoffDate.toLocaleDateString()}{" "}
                        {kickoffDate.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    {/* Teams */}
                    <div className="text-sm font-medium">
                      {fixture.teams_home?.name} vs {fixture.teams_away?.name}
                    </div>

                    {/* Pick Badge */}
                    <Badge variant="default" className="w-fit">
                      {candidate.team_context === "home" ? "Home" : "Away"} O1.5
                    </Badge>

                    {/* Reason Chips */}
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="text-xs">
                        Scorer GPG: {candidate.season_scoring_rate.toFixed(2)}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        Opp Concede GPG:{" "}
                        {candidate.opponent_season_conceding_rate.toFixed(2)}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        Last 5: {candidate.opponent_recent_conceded_2plus}/
                        {candidate.recent_sample_size} conceded 2+
                      </Badge>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyPickToClipboard(candidate)}
                      >
                        Copy Pick
                      </Button>
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
            Click Generate to find {position === "home" ? "Home" : "Away"} O1.5
            candidates
          </div>
        )}
      </CardContent>
    </Card>
  );
}
