import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, X, AlertTriangle, Shield, TrendingUp, Goal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface SafeZonePanelProps {
  onClose: () => void;
}

type Mode = "O25" | "BTTS";

interface SafeZoneFixture {
  fixture_id: number;
  league_id: number;
  league_name: string;
  kickoff_at: string;
  home_team_id: number;
  away_team_id: number;
  home_team: string;
  away_team: string;
  mode: Mode;
  probability: number;
  mu_home: number;
  mu_away: number;
  gf_home: number;
  ga_home: number;
  gf_away: number;
  ga_away: number;
  sample_home: number;
  sample_away: number;
  data_quality: "high" | "medium" | "low";
  o25_home_10?: number;
  o25_away_10?: number;
  league_o25?: number;
  btts_home_10?: number;
  btts_away_10?: number;
  league_btts?: number;
  league_avg_goals: number;
}

// Supported leagues grouped by country
const LEAGUES_BY_COUNTRY: Record<string, { id: number; name: string }[]> = {
  England: [
    { id: 39, name: "Premier League" },
    { id: 40, name: "Championship" },
  ],
  Spain: [
    { id: 140, name: "La Liga" },
    { id: 141, name: "La Liga 2" },
  ],
  Germany: [
    { id: 78, name: "Bundesliga" },
    { id: 79, name: "2. Bundesliga" },
  ],
  Italy: [
    { id: 135, name: "Serie A" },
    { id: 136, name: "Serie B" },
  ],
  France: [
    { id: 61, name: "Ligue 1" },
    { id: 62, name: "Ligue 2" },
  ],
  Other: [
    { id: 94, name: "Primeira Liga (PT)" },
    { id: 88, name: "Eredivisie (NL)" },
    { id: 144, name: "Pro League (BE)" },
    { id: 203, name: "Super Lig (TR)" },
  ],
  UEFA: [
    { id: 2, name: "Champions League" },
    { id: 3, name: "Europa League" },
    { id: 848, name: "Conference League" },
  ],
};

export function SafeZonePanel({ onClose }: SafeZonePanelProps) {
  const { t } = useTranslation("common");
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode>("O25");
  const [selectedLeagues, setSelectedLeagues] = useState<number[]>([39]); // Default: Premier League
  const [results, setResults] = useState<SafeZoneFixture[]>([]);
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const toggleLeague = (leagueId: number) => {
    setSelectedLeagues(prev => 
      prev.includes(leagueId)
        ? prev.filter(id => id !== leagueId)
        : [...prev, leagueId]
    );
    setResults([]);
    setGeneratedAt(null);
  };

  const selectAllInCountry = (country: string) => {
    const leagueIds = LEAGUES_BY_COUNTRY[country].map(l => l.id);
    const allSelected = leagueIds.every(id => selectedLeagues.includes(id));
    
    if (allSelected) {
      setSelectedLeagues(prev => prev.filter(id => !leagueIds.includes(id)));
    } else {
      setSelectedLeagues(prev => [...new Set([...prev, ...leagueIds])]);
    }
    setResults([]);
    setGeneratedAt(null);
  };

  const handleGenerate = async () => {
    if (selectedLeagues.length === 0) {
      toast({
        title: "Select Leagues",
        description: "Please select at least one league",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("safe-zone", {
        body: {
          mode,
          league_ids: selectedLeagues,
          matchday: "next",
          limit: 50,
        },
      });

      if (error) throw error;

      if (!data || !data.fixtures) {
        throw new Error("Invalid response from server");
      }

      setResults(data.fixtures);
      setGeneratedAt(data.meta?.generated_at || new Date().toISOString());

      if (data.fixtures.length === 0) {
        toast({
          title: "No Fixtures",
          description: "No upcoming fixtures found for selected leagues",
        });
      } else {
        toast({
          title: "Rankings Generated",
          description: `${data.fixtures.length} fixtures ranked by ${mode === "O25" ? "O2.5 goals" : "BTTS"} probability`,
        });
      }
    } catch (error: any) {
      console.error("Error fetching Safe Zone data:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to generate rankings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getProbBadgeVariant = (prob: number): "destructive" | "default" | "secondary" | "outline" => {
    if (prob >= 0.70) return "destructive"; // Hot
    if (prob >= 0.55) return "default";
    if (prob >= 0.40) return "secondary";
    return "outline";
  };

  const formatProbability = (prob: number) => `${Math.round(prob * 100)}%`;

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, { 
      weekday: "short",
      month: "short", 
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Card className="w-full shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Safe Zone
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Fixtures ranked by O2.5 goals or BTTS probability
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mode Toggle */}
        <div className="flex gap-2">
          <Button
            variant={mode === "O25" ? "default" : "outline"}
            size="sm"
            className="flex-1 gap-2"
            onClick={() => { setMode("O25"); setResults([]); }}
          >
            <Goal className="h-4 w-4" />
            Over 2.5 Goals
          </Button>
          <Button
            variant={mode === "BTTS" ? "default" : "outline"}
            size="sm"
            className="flex-1 gap-2"
            onClick={() => { setMode("BTTS"); setResults([]); }}
          >
            <TrendingUp className="h-4 w-4" />
            BTTS
          </Button>
        </div>

        {/* League Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Select Leagues</Label>
          <div className="max-h-[200px] overflow-y-auto space-y-3 border rounded-md p-3">
            {Object.entries(LEAGUES_BY_COUNTRY).map(([country, leagues]) => (
              <div key={country} className="space-y-1">
                <div 
                  className="text-xs font-semibold text-muted-foreground uppercase cursor-pointer hover:text-foreground"
                  onClick={() => selectAllInCountry(country)}
                >
                  {country}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {leagues.map(league => (
                    <div key={league.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`league-${league.id}`}
                        checked={selectedLeagues.includes(league.id)}
                        onCheckedChange={() => toggleLeague(league.id)}
                      />
                      <label
                        htmlFor={`league-${league.id}`}
                        className="text-xs cursor-pointer truncate"
                      >
                        {league.name}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">
            {selectedLeagues.length} league(s) selected
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button 
            onClick={handleGenerate} 
            disabled={loading || selectedLeagues.length === 0} 
            className="flex-1 gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Shield className="h-4 w-4" />
                Generate Rankings
              </>
            )}
          </Button>
          {results.length > 0 && (
            <Button
              onClick={handleGenerate}
              disabled={loading}
              variant="outline"
              size="icon"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Results Table */}
        {results.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-muted-foreground">
                {results.length} fixtures • {mode === "O25" ? "Over 2.5 Goals" : "BTTS"}
              </span>
              {generatedAt && (
                <span className="text-xs text-muted-foreground">
                  {new Date(generatedAt).toLocaleTimeString()}
                </span>
              )}
            </div>

            <div className="rounded-md border max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Fixture</TableHead>
                    <TableHead className="text-right w-20">
                      {mode === "O25" ? "P(>2.5)" : "P(BTTS)"}
                    </TableHead>
                    <TableHead className="text-right w-20">μH / μA</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((fixture, idx) => (
                    <TableRow key={fixture.fixture_id}>
                      <TableCell>
                        <Badge variant={getProbBadgeVariant(fixture.probability)} className="w-8 justify-center">
                          {idx + 1}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <div className="font-medium text-xs truncate max-w-[160px] flex items-center gap-1">
                            {fixture.home_team} vs {fixture.away_team}
                            {fixture.data_quality === "low" && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                                  </TooltipTrigger>
                                  <TooltipContent>Low sample size</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {fixture.league_name} • {formatTime(fixture.kickoff_at)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {mode === "O25" 
                              ? `O2.5: H ${Math.round((fixture.o25_home_10 || 0) * 100)}% / A ${Math.round((fixture.o25_away_10 || 0) * 100)}%`
                              : `BTTS: H ${Math.round((fixture.btts_home_10 || 0) * 100)}% / A ${Math.round((fixture.btts_away_10 || 0) * 100)}%`
                            }
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-bold tabular-nums text-sm">
                          {formatProbability(fixture.probability)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                        {fixture.mu_home.toFixed(1)} / {fixture.mu_away.toFixed(1)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Disclaimer */}
            <p className="text-[10px] text-muted-foreground text-center px-2">
              Probabilities are model-based estimates using team scoring/conceding averages and league stats. 
              Not guarantees—always bet responsibly.
            </p>
          </div>
        )}

        {/* Empty State */}
        {!loading && results.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm space-y-2">
            <Shield className="h-8 w-8 mx-auto opacity-50" />
            <p>Select leagues and click "Generate Rankings" to see fixtures ranked by probability.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
