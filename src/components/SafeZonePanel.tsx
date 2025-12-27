import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, X, AlertTriangle, Shield, TrendingUp, Goal, Info, Flag, Swords } from "lucide-react";
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

interface SafeZonePanelProps {
  onClose: () => void;
}

type Mode = "O25" | "BTTS" | "CORNERS" | "FOULS";

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
  // O25 fields
  o25_home_10?: number;
  o25_away_10?: number;
  league_o25?: number;
  // BTTS fields
  btts_home_10?: number;
  btts_away_10?: number;
  league_btts?: number;
  // Corners fields
  mu_corners_home?: number;
  mu_corners_away?: number;
  mu_corners_total?: number;
  corners_for_home?: number;
  corners_against_home?: number;
  corners_for_away?: number;
  corners_against_away?: number;
  over_corners_rate_home?: number;
  over_corners_rate_away?: number;
  league_avg_corners?: number;
  corners_line?: number;
  // Fouls fields
  mu_fouls_home?: number;
  mu_fouls_away?: number;
  mu_fouls_total?: number;
  fouls_committed_home?: number;
  fouls_suffered_home?: number;
  fouls_committed_away?: number;
  fouls_suffered_away?: number;
  over_fouls_rate_home?: number;
  over_fouls_rate_away?: number;
  league_avg_fouls?: number;
  fouls_line?: number;
  league_avg_goals: number;
}

// Supported leagues grouped by country - matching BTTS Index / Card War style
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
  netherlands: [
    { id: 88, name: "Eredivisie" },
    { id: 89, name: "Eerste Divisie" },
  ],
  portugal: [
    { id: 94, name: "Primeira Liga" },
  ],
  belgium: [
    { id: 144, name: "Pro League" },
  ],
  turkey: [
    { id: 203, name: "Super Lig" },
  ],
  uefa: [
    { id: 2, name: "Champions League" },
    { id: 3, name: "Europa League" },
    { id: 848, name: "Conference League" },
  ],
};

const COUNTRY_KEYS = Object.keys(LEAGUES_BY_COUNTRY);

// Mode configurations
const MODE_CONFIG: Record<Mode, { icon: any; label: string; description: string }> = {
  O25: { icon: Goal, label: "safe_zone_over_25", description: "Over 2.5 Goals" },
  BTTS: { icon: TrendingUp, label: "safe_zone_btts", description: "BTTS" },
  CORNERS: { icon: Flag, label: "safe_zone_corners", description: "High Corners" },
  FOULS: { icon: Swords, label: "safe_zone_fouls", description: "High Fouls" },
};

export function SafeZonePanel({ onClose }: SafeZonePanelProps) {
  const { t } = useTranslation("common");
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode>("O25");
  const [selectedCountry, setSelectedCountry] = useState<string>("england");
  const [selectedLeagueId, setSelectedLeagueId] = useState<number>(39);
  const [results, setResults] = useState<SafeZoneFixture[]>([]);
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
    setGeneratedAt(null);
  };

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setResults([]);
    setGeneratedAt(null);
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("safe-zone", {
        body: {
          mode,
          league_ids: [selectedLeagueId],
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
          title: t('no_data_available', 'No Fixtures'),
          description: t('safe_zone_no_fixtures', 'No upcoming fixtures found for this league'),
        });
      } else {
        const modeLabels: Record<Mode, string> = {
          O25: "O2.5 goals",
          BTTS: "BTTS",
          CORNERS: "high corners",
          FOULS: "high fouls",
        };
        toast({
          title: t('ranking_generated', 'Rankings Generated'),
          description: `${data.fixtures.length} fixtures ranked by ${modeLabels[mode]} probability`,
        });
      }
    } catch (error: any) {
      console.error("Error fetching Safe Zone data:", error);
      toast({
        title: t('error', 'Error'),
        description: error.message || "Failed to generate rankings",
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

  const getDataQualityIcon = (quality: string) => {
    if (quality === "low") {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <AlertTriangle className="h-3 w-3 text-amber-500" />
            </TooltipTrigger>
            <TooltipContent>{t('safe_zone_low_sample', 'Low sample size - less reliable')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return null;
  };

  const getModeDescription = () => {
    switch (mode) {
      case "O25": return t('safe_zone_subtitle', 'Fixtures ranked by Over 2.5 or BTTS probability');
      case "BTTS": return t('safe_zone_subtitle', 'Fixtures ranked by Over 2.5 or BTTS probability');
      case "CORNERS": return t('safe_zone_corners_desc', 'Fixtures ranked by high corners probability');
      case "FOULS": return t('safe_zone_fouls_desc', 'Fixtures ranked by high fouls probability');
      default: return '';
    }
  };

  const getResultsHeader = () => {
    if (results.length === 0) return '';
    const fixture = results[0];
    switch (mode) {
      case "O25": return `Over 2.5`;
      case "BTTS": return `BTTS`;
      case "CORNERS": return `O${fixture.corners_line || 9.5} Corners`;
      case "FOULS": return `O${fixture.fouls_line || 25.5} Fouls`;
      default: return '';
    }
  };

  const renderTableHeaders = () => {
    switch (mode) {
      case "O25":
        return (
          <>
            <TableHead className="text-right w-16">P(&gt;2.5)</TableHead>
            <TableHead className="text-right w-20">xG</TableHead>
            <TableHead className="text-right w-24">O2.5%</TableHead>
          </>
        );
      case "BTTS":
        return (
          <>
            <TableHead className="text-right w-16">P(BTTS)</TableHead>
            <TableHead className="text-right w-20">xG</TableHead>
            <TableHead className="text-right w-24">BTTS%</TableHead>
          </>
        );
      case "CORNERS":
        return (
          <>
            <TableHead className="text-right w-16">{t('safe_zone_prob', 'Prob')}</TableHead>
            <TableHead className="text-right w-20">{t('safe_zone_xc', 'xCorners')}</TableHead>
            <TableHead className="text-right w-24">{t('safe_zone_over_rate', 'Over%')}</TableHead>
          </>
        );
      case "FOULS":
        return (
          <>
            <TableHead className="text-right w-16">{t('safe_zone_prob', 'Prob')}</TableHead>
            <TableHead className="text-right w-20">{t('safe_zone_xf', 'xFouls')}</TableHead>
            <TableHead className="text-right w-24">{t('safe_zone_over_rate', 'Over%')}</TableHead>
          </>
        );
      default:
        return null;
    }
  };

  const renderTableCells = (fixture: SafeZoneFixture) => {
    switch (mode) {
      case "O25":
        return (
          <>
            <TableCell className="text-right">
              <span className="font-bold tabular-nums text-base">
                {formatProbability(fixture.probability)}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
              {fixture.mu_home.toFixed(1)} - {fixture.mu_away.toFixed(1)}
            </TableCell>
            <TableCell className="text-right">
              <div className="text-xs tabular-nums">
                <span>
                  H:{Math.round((fixture.o25_home_10 || 0) * 100)}% / A:{Math.round((fixture.o25_away_10 || 0) * 100)}%
                </span>
              </div>
            </TableCell>
          </>
        );
      case "BTTS":
        return (
          <>
            <TableCell className="text-right">
              <span className="font-bold tabular-nums text-base">
                {formatProbability(fixture.probability)}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
              {fixture.mu_home.toFixed(1)} - {fixture.mu_away.toFixed(1)}
            </TableCell>
            <TableCell className="text-right">
              <div className="text-xs tabular-nums">
                <span>
                  H:{Math.round((fixture.btts_home_10 || 0) * 100)}% / A:{Math.round((fixture.btts_away_10 || 0) * 100)}%
                </span>
              </div>
            </TableCell>
          </>
        );
      case "CORNERS":
        return (
          <>
            <TableCell className="text-right">
              <span className="font-bold tabular-nums text-base">
                {formatProbability(fixture.probability)}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    {(fixture.mu_corners_total || 0).toFixed(1)}
                  </TooltipTrigger>
                  <TooltipContent>
                    H: {(fixture.mu_corners_home || 0).toFixed(1)} / A: {(fixture.mu_corners_away || 0).toFixed(1)}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </TableCell>
            <TableCell className="text-right">
              <div className="text-xs tabular-nums">
                <span>
                  H:{Math.round((fixture.over_corners_rate_home || 0) * 100)}% / A:{Math.round((fixture.over_corners_rate_away || 0) * 100)}%
                </span>
              </div>
            </TableCell>
          </>
        );
      case "FOULS":
        return (
          <>
            <TableCell className="text-right">
              <span className="font-bold tabular-nums text-base">
                {formatProbability(fixture.probability)}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    {(fixture.mu_fouls_total || 0).toFixed(1)}
                  </TooltipTrigger>
                  <TooltipContent>
                    H: {(fixture.mu_fouls_home || 0).toFixed(1)} / A: {(fixture.mu_fouls_away || 0).toFixed(1)}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </TableCell>
            <TableCell className="text-right">
              <div className="text-xs tabular-nums">
                <span>
                  H:{Math.round((fixture.over_fouls_rate_home || 0) * 100)}% / A:{Math.round((fixture.over_fouls_rate_away || 0) * 100)}%
                </span>
              </div>
            </TableCell>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <Card className="w-full shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            {t('safe_zone_title', 'Safe Zone')}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {getModeDescription()}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mode Toggle - 4 modes in 2x2 grid */}
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(MODE_CONFIG) as Mode[]).map((m) => {
            const config = MODE_CONFIG[m];
            const IconComponent = config.icon;
            return (
              <Button
                key={m}
                variant={mode === m ? "default" : "outline"}
                size="sm"
                className="gap-2"
                onClick={() => handleModeChange(m)}
              >
                <IconComponent className="h-4 w-4" />
                {t(config.label, config.description)}
              </Button>
            );
          })}
        </div>

        {/* Selectors - same style as BTTS Index */}
        <div className="grid grid-cols-2 gap-3">
          {/* Country Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t('btts_country', 'Country')}
            </label>
            <Select value={selectedCountry} onValueChange={handleCountryChange}>
              <SelectTrigger className="w-full bg-background">
                <SelectValue placeholder={t('btts_country', 'Country')} />
              </SelectTrigger>
              <SelectContent className="bg-popover border border-border z-50">
                {COUNTRY_KEYS.map((countryKey) => (
                  <SelectItem key={countryKey} value={countryKey}>
                    {countryKey.charAt(0).toUpperCase() + countryKey.slice(1)}
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
                setGeneratedAt(null);
              }}
            >
              <SelectTrigger className="w-full bg-background">
                <SelectValue placeholder={t('btts_league', 'League')} />
              </SelectTrigger>
              <SelectContent className="bg-popover border border-border z-50">
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
          <Button 
            onClick={handleGenerate} 
            disabled={loading} 
            className="flex-1 gap-2"
          >
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
                {results[0]?.league_name} • {results.length} fixtures • {getResultsHeader()}
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
                    <TableHead>{t('safe_zone_fixture', 'Fixture')}</TableHead>
                    {renderTableHeaders()}
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
                          <div className="font-medium text-sm flex items-center gap-1">
                            {fixture.home_team}
                            <span className="text-muted-foreground mx-1">vs</span>
                            {fixture.away_team}
                            {getDataQualityIcon(fixture.data_quality)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatTime(fixture.kickoff_at)}
                          </div>
                        </div>
                      </TableCell>
                      {renderTableCells(fixture)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Disclaimer */}
            <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 text-xs text-muted-foreground">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                {t('safe_zone_disclaimer', 'Probabilities are model-based estimates using team scoring/conceding averages and league stats. Not guarantees—always bet responsibly.')}
              </p>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && results.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm space-y-2">
            <Shield className="h-8 w-8 mx-auto opacity-50" />
            <p>{t('safe_zone_empty', 'Select a league and click "Show Ranking" to see fixtures ranked by probability.')}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
