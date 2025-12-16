import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Users, X, AlertTriangle } from "lucide-react";
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

interface BTTSIndexPanelProps {
  onClose: () => void;
}

type Window = 5 | 10 | 15;

interface TeamBTTS {
  rank: number;
  team_id: number;
  team_name: string;
  btts_rate: number;
  btts_count: number;
  matches: number;
  sample_warning: string | null;
}

interface LeagueInfo {
  name: string;
  country: string;
}

// Supported leagues grouped by country (EN/ES/FR/IT/DE 1st + 2nd divisions)
const LEAGUES_BY_COUNTRY: Record<string, { id: number; name: string }[]> = {
  england: [
    { id: 39, name: "Premier League" },
    { id: 40, name: "Championship" },
  ],
  spain: [
    { id: 140, name: "La Liga" },
    { id: 141, name: "La Liga 2" },
  ],
  germany: [
    { id: 78, name: "Bundesliga" },
    { id: 79, name: "2. Bundesliga" },
  ],
  italy: [
    { id: 135, name: "Serie A" },
    { id: 136, name: "Serie B" },
  ],
  france: [
    { id: 61, name: "Ligue 1" },
    { id: 62, name: "Ligue 2" },
  ],
};

const COUNTRY_KEYS = Object.keys(LEAGUES_BY_COUNTRY);

export function BTTSIndexPanel({ onClose }: BTTSIndexPanelProps) {
  const { t } = useTranslation("common");
  const { toast } = useToast();

  const [window, setWindow] = useState<Window>(10);
  const [selectedCountry, setSelectedCountry] = useState<string>("england");
  const [selectedLeagueId, setSelectedLeagueId] = useState<number>(39);
  const [results, setResults] = useState<TeamBTTS[]>([]);
  const [leagueInfo, setLeagueInfo] = useState<LeagueInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const availableLeagues = LEAGUES_BY_COUNTRY[selectedCountry] || [];

  const handleCountryChange = (country: string) => {
    setSelectedCountry(country);
    const leagues = LEAGUES_BY_COUNTRY[country];
    if (leagues && leagues.length > 0) {
      setSelectedLeagueId(leagues[0].id);
    }
    setResults([]);
    setLeagueInfo(null);
    setGeneratedAt(null);
  };

  const handleWindowChange = (w: string) => {
    setWindow(parseInt(w) as Window);
    setResults([]);
    setLeagueInfo(null);
    setGeneratedAt(null);
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("btts-index", {
        body: {
          mode: "league_rankings",
          league_id: selectedLeagueId,
          window,
        },
      });

      if (error) throw error;

      if (!data || !data.teams) {
        throw new Error("Invalid response from server");
      }

      setResults(data.teams);
      setLeagueInfo(data.league);
      setGeneratedAt(data.generated_at);

      if (data.teams.length === 0) {
        toast({
          title: t('no_data_available', 'No data available'),
          description: t('btts_no_data_desc', 'No historical data found for this league'),
        });
      } else {
        toast({
          title: t('ranking_generated', 'Ranking generated'),
          description: t('btts_ranking_desc', '{{count}} teams ranked by BTTS rate', { count: data.teams.length }),
        });
      }
    } catch (error: any) {
      console.error("Error fetching BTTS data:", error);
      toast({
        title: t('error', 'Error'),
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

  // Get badge variant based on BTTS rate
  const getBTTSBadgeVariant = (rate: number): "destructive" | "default" | "secondary" | "outline" => {
    if (rate >= 70) return "destructive"; // High BTTS rate (red/hot)
    if (rate >= 50) return "default"; // Medium-high
    if (rate >= 30) return "secondary";
    return "outline"; // Low
  };

  return (
    <Card className="w-full shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            {t('btts_title', 'BTTS Index')}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('btts_subtitle', 'Teams ranked by Both Teams To Score percentage')}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Window Toggle */}
        <div className="flex gap-2">
          {[5, 10, 15].map((w) => (
            <Button
              key={w}
              variant={window === w ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => handleWindowChange(w.toString())}
            >
              {t('btts_last_n', 'Last {{n}}', { n: w })}
            </Button>
          ))}
        </div>

        {/* Selectors */}
        <div className="grid grid-cols-2 gap-3">
          {/* Country Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('btts_country', 'Country')}
            </label>
            <Select value={selectedCountry} onValueChange={handleCountryChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('btts_country', 'Country')} />
              </SelectTrigger>
              <SelectContent>
                {COUNTRY_KEYS.map((countryKey) => (
                  <SelectItem key={countryKey} value={countryKey}>
                    {t(`country_${countryKey}`, countryKey.charAt(0).toUpperCase() + countryKey.slice(1))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* League Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('btts_league', 'League')}
            </label>
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
                <SelectValue placeholder={t('btts_league', 'League')} />
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
                {t('generating', 'Generating...')}
              </>
            ) : (
              t('show_ranking', 'Show Ranking')
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
                {leagueInfo?.name} • {t('btts_teams_count', '{{count}} teams', { count: results.length })}
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
                    <TableHead>{t('btts_team', 'Team')}</TableHead>
                    <TableHead className="text-right w-20">{t('btts_rate', 'BTTS %')}</TableHead>
                    <TableHead className="text-right w-16">{t('btts_count', 'BTTS')}</TableHead>
                    <TableHead className="text-right w-16">{t('btts_matches', 'Games')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((team) => (
                    <TableRow key={team.team_id}>
                      <TableCell>
                        <Badge variant={getBTTSBadgeVariant(team.btts_rate)} className="w-8 justify-center">
                          {team.rank}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium truncate max-w-[140px]">
                        <div className="flex items-center gap-1">
                          {team.team_name}
                          {team.sample_warning && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t('btts_low_sample', 'Low sample size')}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-bold tabular-nums">
                        {team.btts_rate.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {team.btts_count}/{team.matches}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={team.matches < window ? "text-amber-500" : "text-muted-foreground"}>
                          {team.matches}/{window}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              {t('btts_footer', 'Teams at the top have the highest Both Teams To Score rate in their last {{n}} matches', { n: window })}
            </p>
          </div>
        )}

        {/* Empty State */}
        {!loading && results.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {t('btts_empty', 'Select a league and click "Show Ranking" to see BTTS rates for each team.')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
