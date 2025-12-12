import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, ShieldAlert, Target, X } from "lucide-react";
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

interface WhoConcedesPanelProps {
  onClose: () => void;
}

type Mode = 'concedes' | 'scores';

interface TeamRanking {
  rank: number;
  team_id: number;
  team_name: string;
  avg_value: number;
  total_value: number;
  matches_used: number;
  // Backward compatibility
  avg_conceded?: number;
  total_conceded?: number;
  avg_scored?: number;
  total_scored?: number;
}

interface LeagueInfo {
  id: number;
  name: string;
  country: string;
}

// Supported leagues grouped by country
const LEAGUES_BY_COUNTRY: Record<string, { id: number; name: string }[]> = {
  England: [
    { id: 39, name: "Premier League" },
    { id: 40, name: "Championship" },
    { id: 41, name: "League One" },
    { id: 42, name: "League Two" },
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
  Netherlands: [
    { id: 88, name: "Eredivisie" },
    { id: 89, name: "Eerste Divisie" },
  ],
};

const COUNTRIES = Object.keys(LEAGUES_BY_COUNTRY);

export function WhoConcedesPanel({ onClose }: WhoConcedesPanelProps) {
  const { t } = useTranslation(["common"]);
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode>('concedes');
  const [selectedCountry, setSelectedCountry] = useState<string>("England");
  const [selectedLeagueId, setSelectedLeagueId] = useState<number>(39); // Premier League default
  const [results, setResults] = useState<TeamRanking[]>([]);
  const [leagueInfo, setLeagueInfo] = useState<LeagueInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const availableLeagues = LEAGUES_BY_COUNTRY[selectedCountry] || [];

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setResults([]);
    setLeagueInfo(null);
    setGeneratedAt(null);
  };

  const handleCountryChange = (country: string) => {
    setSelectedCountry(country);
    // Auto-select first league of the country
    const leagues = LEAGUES_BY_COUNTRY[country];
    if (leagues && leagues.length > 0) {
      setSelectedLeagueId(leagues[0].id);
    }
    // Clear results when changing country
    setResults([]);
    setLeagueInfo(null);
    setGeneratedAt(null);
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("who-concedes", {
        body: { 
          league_id: selectedLeagueId,
          max_matches: 10,
          mode,
        },
      });

      if (error) throw error;

      if (!data || !data.rankings) {
        throw new Error("Invalid response from server");
      }

      setResults(data.rankings);
      setLeagueInfo(data.league);
      setGeneratedAt(data.generated_at);

      if (data.rankings.length === 0) {
        toast({
          title: t('common:no_data_available', 'No data available'),
          description: `No historical data found for ${data.league?.name || "this league"}`,
        });
      } else {
        const modeLabel = data.mode === 'scores' ? 'scoring' : 'conceding';
        toast({
          title: t('common:ranking_generated', 'Ranking generated'),
          description: `${data.rankings.length} teams ranked for ${data.league?.name} (${modeLabel})`,
        });
      }
    } catch (error: any) {
      console.error("Error fetching Who Concedes/Scores data:", error);
      toast({
        title: t('common:error', 'Error'),
        description: error.message || "Failed to generate ranking",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    if (selectedLeagueId) {
      handleGenerate();
    }
  };

  // Get color class based on rank
  const getRankBadgeVariant = (rank: number): "destructive" | "secondary" | "outline" => {
    if (rank <= 3) return "destructive"; // Top 3 (worst defense or best attack)
    if (rank <= 6) return "secondary";
    return "outline";
  };

  return (
    <Card className="w-full shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            {mode === 'concedes' ? (
              <ShieldAlert className="h-5 w-5 text-destructive" />
            ) : (
              <Target className="h-5 w-5 text-primary" />
            )}
            {t('common:who_concedes_title', 'Who Concedes / Scores?')}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('common:who_concedes_subtitle', 'Teams ranked by average goals conceded or scored (last 10 matches, all competitions)')}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mode Toggle */}
        <div className="flex gap-2">
          <Button
            variant={mode === 'concedes' ? 'default' : 'outline'}
            size="sm"
            className="flex-1 gap-2"
            onClick={() => handleModeChange('concedes')}
          >
            <ShieldAlert className="h-4 w-4" />
            {t('common:who_concedes_mode_concedes', 'Concedes')}
          </Button>
          <Button
            variant={mode === 'scores' ? 'default' : 'outline'}
            size="sm"
            className="flex-1 gap-2"
            onClick={() => handleModeChange('scores')}
          >
            <Target className="h-4 w-4" />
            {t('common:who_concedes_mode_scores', 'Scores')}
          </Button>
        </div>

        {/* Selectors */}
        <div className="grid grid-cols-2 gap-3">
          {/* Country Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Country</label>
            <Select value={selectedCountry} onValueChange={handleCountryChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select country" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((country) => (
                  <SelectItem key={country} value={country}>
                    {country}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* League Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">League</label>
            <Select 
              value={selectedLeagueId.toString()} 
              onValueChange={(v) => {
                setSelectedLeagueId(parseInt(v));
                setResults([]);
                setLeagueInfo(null);
                setGeneratedAt(null);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select league" />
              </SelectTrigger>
              <SelectContent>
                {availableLeagues.map((league) => (
                  <SelectItem key={league.id} value={league.id.toString()}>
                    {league.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button onClick={handleGenerate} disabled={loading} className="flex-1 gap-2">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('common:generating', 'Generating...')}
              </>
            ) : (
              t('common:show_ranking', 'Show Ranking')
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

        {/* Results Table */}
        {results.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-muted-foreground">
                {leagueInfo?.name} • {results.length} teams
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
                    <TableHead>Team</TableHead>
                    <TableHead className="text-right w-20">Avg</TableHead>
                    <TableHead className="text-right w-16">Total</TableHead>
                    <TableHead className="text-right w-16">Used</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((team) => (
                    <TableRow key={team.team_id}>
                      <TableCell>
                        <Badge variant={getRankBadgeVariant(team.rank)} className="w-8 justify-center">
                          {team.rank}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium truncate max-w-[140px]">
                        {team.team_name}
                      </TableCell>
                      <TableCell className="text-right font-bold tabular-nums">
                        {team.avg_value.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {team.total_value}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={team.matches_used < 10 ? "text-amber-500" : "text-muted-foreground"}>
                          {team.matches_used}/10
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              {mode === 'concedes' 
                ? t('common:who_concedes_footer_concedes', 'Teams at the top concede the most goals • Based on last 10 matches across all competitions')
                : t('common:who_concedes_footer_scores', 'Teams at the top score the most goals • Based on last 10 matches across all competitions')
              }
            </p>
          </div>
        )}

        {/* Empty State */}
        {!loading && results.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {t('common:who_concedes_empty', 'Select a league and click "Show Ranking" to see which teams concede or score the most goals.')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
