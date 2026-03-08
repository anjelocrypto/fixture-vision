import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, X, AlertTriangle, Shield, TrendingUp, Goal, Info, Flag, Swords } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
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
  o25_home_10?: number;
  o25_away_10?: number;
  league_o25?: number;
  btts_home_10?: number;
  btts_away_10?: number;
  league_btts?: number;
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

const LEAGUES_BY_COUNTRY: Record<string, { id: number; name: string }[]> = {
  england: [{ id: 39, name: "Premier League" }, { id: 40, name: "Championship" }],
  spain: [{ id: 140, name: "La Liga" }, { id: 141, name: "La Liga 2" }],
  germany: [{ id: 78, name: "Bundesliga" }, { id: 79, name: "2. Bundesliga" }],
  italy: [{ id: 135, name: "Serie A" }, { id: 136, name: "Serie B" }],
  france: [{ id: 61, name: "Ligue 1" }, { id: 62, name: "Ligue 2" }],
  netherlands: [{ id: 88, name: "Eredivisie" }, { id: 89, name: "Eerste Divisie" }],
  portugal: [{ id: 94, name: "Primeira Liga" }],
  belgium: [{ id: 144, name: "Pro League" }],
  turkey: [{ id: 203, name: "Super Lig" }],
  uefa: [{ id: 2, name: "Champions League" }, { id: 3, name: "Europa League" }, { id: 848, name: "Conference League" }],
};

const COUNTRY_KEYS = Object.keys(LEAGUES_BY_COUNTRY);

const MODE_CONFIG: Record<Mode, { icon: any; label: string; short: string }> = {
  O25: { icon: Goal, label: "safe_zone_over_25", short: "O2.5" },
  BTTS: { icon: TrendingUp, label: "safe_zone_btts", short: "BTTS" },
  CORNERS: { icon: Flag, label: "safe_zone_corners", short: "Corners" },
  FOULS: { icon: Swords, label: "safe_zone_fouls", short: "Fouls" },
};

export function SafeZonePanel({ onClose }: SafeZonePanelProps) {
  const { t } = useTranslation("common");
  const { toast } = useToast();
  const isMobile = useIsMobile();

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
    if (leagues && leagues.length > 0) setSelectedLeagueId(leagues[0].id);
    setResults([]); setGeneratedAt(null);
  };

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    setResults([]); setGeneratedAt(null);
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("safe-zone", {
        body: { mode, league_ids: [selectedLeagueId], matchday: "next", limit: 50 },
      });
      if (error) throw error;
      if (!data || !data.fixtures) throw new Error("Invalid response from server");
      setResults(data.fixtures);
      setGeneratedAt(data.meta?.generated_at || new Date().toISOString());
      if (data.fixtures.length === 0) {
        toast({ title: t('no_data_available', 'No Fixtures'), description: t('safe_zone_no_fixtures', 'No upcoming fixtures found for this league') });
      } else {
        toast({ title: t('ranking_generated', 'Rankings Generated'), description: `${data.fixtures.length} fixtures ranked` });
      }
    } catch (error: any) {
      console.error("Error fetching Safe Zone data:", error);
      toast({ title: t('error', 'Error'), description: error.message || "Failed to generate rankings", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const formatProbability = (prob: number) => `${Math.round(prob * 100)}%`;

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const getProbColor = (prob: number) => {
    if (prob >= 0.70) return "text-red-400";
    if (prob >= 0.55) return "text-primary";
    return "text-muted-foreground";
  };

  const getProbBadgeVariant = (prob: number): "destructive" | "default" | "secondary" | "outline" => {
    if (prob >= 0.70) return "destructive";
    if (prob >= 0.55) return "default";
    if (prob >= 0.40) return "secondary";
    return "outline";
  };

  const getMobileStats = (fixture: SafeZoneFixture) => {
    switch (mode) {
      case "O25":
        return [
          { label: "xG", value: `${fixture.mu_home.toFixed(1)}–${fixture.mu_away.toFixed(1)}` },
          { label: "O2.5%", value: `${((fixture.o25_home_10 || 0) * 100).toFixed(0)}/${((fixture.o25_away_10 || 0) * 100).toFixed(0)}` },
        ];
      case "BTTS":
        return [{ label: "xG", value: `${fixture.mu_home.toFixed(1)}–${fixture.mu_away.toFixed(1)}` }];
      case "CORNERS":
        return [{ label: "xC", value: `${(fixture.mu_corners_total || (fixture.mu_home + fixture.mu_away)).toFixed(1)}` }];
      case "FOULS":
        return [{ label: "xF", value: `${(fixture.mu_fouls_total || (fixture.mu_home + fixture.mu_away)).toFixed(1)}` }];
      default:
        return [];
    }
  };

  const getResultsHeader = () => {
    if (results.length === 0) return '';
    const fixture = results[0];
    switch (mode) {
      case "O25": return "Over 2.5";
      case "BTTS": return "BTTS";
      case "CORNERS": return `O${fixture.corners_line || 9.5} Corners`;
      case "FOULS": return `O${fixture.fouls_line || 25.5} Fouls`;
      default: return '';
    }
  };

  const renderTableHeaders = () => {
    switch (mode) {
      case "O25":
        return (<><TableHead className="text-right w-16">P(&gt;2.5)</TableHead><TableHead className="text-right w-20">xG</TableHead><TableHead className="text-right w-24">O2.5%</TableHead></>);
      case "BTTS":
        return (<><TableHead className="text-right w-16">P(BTTS)</TableHead><TableHead className="text-right w-20">xG</TableHead><TableHead className="text-right w-24">BTTS%</TableHead></>);
      case "CORNERS":
        return (<><TableHead className="text-right w-16">{t('safe_zone_prob', 'Prob')}</TableHead><TableHead className="text-right w-20">xCorners</TableHead><TableHead className="text-right w-24">Over%</TableHead></>);
      case "FOULS":
        return (<><TableHead className="text-right w-16">{t('safe_zone_prob', 'Prob')}</TableHead><TableHead className="text-right w-20">xFouls</TableHead><TableHead className="text-right w-24">Over%</TableHead></>);
      default: return null;
    }
  };

  const renderTableCells = (fixture: SafeZoneFixture) => {
    switch (mode) {
      case "O25":
        return (<>
          <TableCell className="text-right"><span className="font-bold tabular-nums text-base">{formatProbability(fixture.probability)}</span></TableCell>
          <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{fixture.mu_home.toFixed(1)} - {fixture.mu_away.toFixed(1)}</TableCell>
          <TableCell className="text-right text-xs tabular-nums">H:{Math.round((fixture.o25_home_10 || 0) * 100)}% / A:{Math.round((fixture.o25_away_10 || 0) * 100)}%</TableCell>
        </>);
      case "BTTS":
        return (<>
          <TableCell className="text-right"><span className="font-bold tabular-nums text-base">{formatProbability(fixture.probability)}</span></TableCell>
          <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{fixture.mu_home.toFixed(1)} - {fixture.mu_away.toFixed(1)}</TableCell>
          <TableCell className="text-right text-xs tabular-nums">H:{Math.round((fixture.btts_home_10 || 0) * 100)}% / A:{Math.round((fixture.btts_away_10 || 0) * 100)}%</TableCell>
        </>);
      case "CORNERS":
        return (<>
          <TableCell className="text-right"><span className="font-bold tabular-nums text-base">{formatProbability(fixture.probability)}</span></TableCell>
          <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
            <TooltipProvider><Tooltip><TooltipTrigger>{(fixture.mu_corners_total || 0).toFixed(1)}</TooltipTrigger>
            <TooltipContent>H: {(fixture.mu_corners_home || 0).toFixed(1)} / A: {(fixture.mu_corners_away || 0).toFixed(1)}</TooltipContent></Tooltip></TooltipProvider>
          </TableCell>
          <TableCell className="text-right text-xs tabular-nums">H:{Math.round((fixture.over_corners_rate_home || 0) * 100)}% / A:{Math.round((fixture.over_corners_rate_away || 0) * 100)}%</TableCell>
        </>);
      case "FOULS":
        return (<>
          <TableCell className="text-right"><span className="font-bold tabular-nums text-base">{formatProbability(fixture.probability)}</span></TableCell>
          <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
            <TooltipProvider><Tooltip><TooltipTrigger>{(fixture.mu_fouls_total || 0).toFixed(1)}</TooltipTrigger>
            <TooltipContent>H: {(fixture.mu_fouls_home || 0).toFixed(1)} / A: {(fixture.mu_fouls_away || 0).toFixed(1)}</TooltipContent></Tooltip></TooltipProvider>
          </TableCell>
          <TableCell className="text-right text-xs tabular-nums">H:{Math.round((fixture.over_fouls_rate_home || 0) * 100)}% / A:{Math.round((fixture.over_fouls_rate_away || 0) * 100)}%</TableCell>
        </>);
      default: return null;
    }
  };

  return (
    <div className="w-full rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm overflow-hidden shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/30">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-primary/15 flex items-center justify-center">
            <Shield className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-sm">{t('safe_zone_title', 'Safe Zone')}</h2>
            <p className="text-[10px] text-muted-foreground leading-tight">
              {t('safe_zone_subtitle', 'Fixtures ranked by probability')}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 active:scale-90 transition-all">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Mode Toggle - 2x2 grid */}
        <div className="grid grid-cols-4 gap-1">
          {(Object.keys(MODE_CONFIG) as Mode[]).map((m) => {
            const config = MODE_CONFIG[m];
            const IconComponent = config.icon;
            const isActive = mode === m;
            return (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                className={`h-9 rounded-xl text-[10px] sm:text-xs font-medium flex flex-col items-center justify-center gap-0.5 transition-all active:scale-[0.96] ${
                  isActive
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "bg-muted/40 border border-border/50 text-muted-foreground"
                }`}
              >
                <IconComponent className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span className="leading-none">{config.short}</span>
              </button>
            );
          })}
        </div>

        {/* Selectors */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{t('btts_country', 'Country')}</span>
            <Select value={selectedCountry} onValueChange={handleCountryChange}>
              <SelectTrigger className="h-9 text-xs rounded-xl bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover border border-border z-50">
                {COUNTRY_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>{t(`country_${k}`, k.charAt(0).toUpperCase() + k.slice(1))}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{t('btts_league', 'League')}</span>
            <Select value={selectedLeagueId.toString()} onValueChange={(v) => { setSelectedLeagueId(parseInt(v)); setResults([]); setGeneratedAt(null); }}>
              <SelectTrigger className="h-9 text-xs rounded-xl bg-background"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover border border-border z-50">
                {availableLeagues.map((l) => (
                  <SelectItem key={l.id} value={l.id.toString()}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Generate */}
        <div className="flex gap-2">
          <Button onClick={handleGenerate} disabled={loading} size="sm" className="flex-1 h-10 rounded-xl text-xs font-semibold active:scale-[0.97] transition-transform">
            {loading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{t('generating', 'Generating...')}</> : t('show_ranking', 'Show Ranking')}
          </Button>
          {results.length > 0 && (
            <Button onClick={handleGenerate} disabled={loading} variant="outline" size="icon" className="h-10 w-10 rounded-xl active:scale-[0.95]">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          )}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">
                {results[0]?.league_name} · {results.length} fixtures · {getResultsHeader()}
              </span>
              {generatedAt && <span className="text-[10px] text-muted-foreground">{new Date(generatedAt).toLocaleTimeString()}</span>}
            </div>

            {isMobile ? (
              <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-0.5">
                {results.map((fixture, idx) => {
                  const stats = getMobileStats(fixture);
                  const prob = fixture.probability;
                  return (
                    <div
                      key={fixture.fixture_id}
                      className={`p-2.5 rounded-xl border transition-colors ${
                        prob >= 0.70 ? "bg-destructive/5 border-destructive/20" : prob >= 0.55 ? "bg-primary/5 border-primary/20" : "bg-muted/20 border-border/40"
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        {/* Rank */}
                        <div className="w-7 h-7 rounded-lg bg-muted/60 flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-[11px] font-bold text-muted-foreground">{idx + 1}</span>
                        </div>

                        {/* Match Info */}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-xs leading-tight flex items-center gap-1 flex-wrap">
                            <span className="truncate">{fixture.home_team}</span>
                            <span className="text-muted-foreground text-[10px]">vs</span>
                            <span className="truncate">{fixture.away_team}</span>
                            {fixture.data_quality === "low" && (
                              <AlertTriangle className="h-2.5 w-2.5 text-amber-500 flex-shrink-0" />
                            )}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{formatTime(fixture.kickoff_at)}</p>
                          {/* Stats chips */}
                          <div className="flex gap-1.5 mt-1.5">
                            {stats.map((s, i) => (
                              <span key={i} className="inline-flex items-center gap-0.5 text-[10px] bg-muted/50 rounded-md px-1.5 py-0.5">
                                <span className="text-muted-foreground">{s.label}:</span>
                                <span className="tabular-nums font-medium text-foreground">{s.value}</span>
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Probability */}
                        <div className="text-right shrink-0">
                          <p className={`font-bold tabular-nums text-base ${getProbColor(prob)}`}>{formatProbability(prob)}</p>
                          <div className="w-10 h-1.5 rounded-full bg-muted/60 mt-1 overflow-hidden ml-auto">
                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(prob * 100, 100)}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-border/40 max-h-[400px] overflow-y-auto">
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
                        <TableCell><Badge variant={getProbBadgeVariant(fixture.probability)} className="w-8 justify-center">{idx + 1}</Badge></TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            <div className="font-medium text-sm flex items-center gap-1">
                              {fixture.home_team} <span className="text-muted-foreground mx-1">vs</span> {fixture.away_team}
                              {fixture.data_quality === "low" && (
                                <TooltipProvider><Tooltip><TooltipTrigger><AlertTriangle className="h-3 w-3 text-amber-500" /></TooltipTrigger><TooltipContent>{t('safe_zone_low_sample', 'Low sample size')}</TooltipContent></Tooltip></TooltipProvider>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">{formatTime(fixture.kickoff_at)}</div>
                          </div>
                        </TableCell>
                        {renderTableCells(fixture)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Disclaimer */}
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-muted/30 text-[10px] text-muted-foreground border border-border/30">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <p>{t('safe_zone_disclaimer', 'Model-based estimates. Not guarantees—always bet responsibly.')}</p>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && results.length === 0 && (
          <div className="text-center py-8 space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center mx-auto">
              <Shield className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <p className="text-xs text-muted-foreground px-4">
              {t('safe_zone_empty', 'Select a league and click "Show Ranking" to see fixtures ranked by probability.')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
